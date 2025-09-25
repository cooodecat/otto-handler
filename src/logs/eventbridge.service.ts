import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis/redis.service';
import { LogsGateway } from './logs.gateway';
import {
  Execution,
  ExecutionStatus,
  ExecutionType,
} from '../database/entities/execution.entity';
import { LogsService } from './logs.service';
import { ConfigService } from '@nestjs/config';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { LogLevel } from '../database/entities/execution-log.entity';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { Pipeline } from '../database/entities/pipeline.entity';
import { PipelineService } from '../pipeline/pipeline.service';

export interface EventBridgeEvent {
  id: string;
  version: string;
  account: string;
  time: string;
  region: string;
  source: string;
  resources: string[];
  'detail-type': string;
  detail: CodeBuildDetail;
}

export interface CodeBuildDetail {
  'build-status': 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'STOPPED';
  'build-id': string;
  'project-name': string;
  'current-phase'?: string;
  'current-phase-context'?: string;
  'additional-information'?: {
    'build-complete'?: boolean;
    'build-number'?: number;
    initiator?: string;
    'start-time'?: string;
    'end-time'?: string;
    environment?: {
      'environment-variables'?: Array<{
        name: string;
        value: string;
        type?: string;
      }>;
    };
    logs?: {
      'group-name'?: string;
      'stream-name'?: string;
      'deep-link'?: string;
    };
  };
}

@Injectable()
export class EventBridgeService {
  private readonly logger = new Logger(EventBridgeService.name);
  private readonly useEventBridge: boolean;

  constructor(
    private readonly redisService: RedisService,
    private readonly logsGateway: LogsGateway,
    private readonly logsService: LogsService,
    private readonly configService: ConfigService,
    private readonly logStorage: LogStorageService,
    private readonly cloudwatchService: CloudwatchService,
    @Inject(forwardRef(() => PipelineService))
    private readonly pipelineService: PipelineService,
    @InjectRepository(Execution)
    private executionRepository: Repository<Execution>,
    @InjectRepository(Pipeline)
    private pipelineRepository: Repository<Pipeline>,
  ) {
    const envValue = this.configService.get<string>('USE_EVENTBRIDGE', 'false');
    this.useEventBridge = envValue === 'true';
    this.logger.log(
      `EventBridge integration: ${this.useEventBridge ? 'Enabled' : 'Disabled'} (USE_EVENTBRIDGE=${envValue})`,
    );
  }

  async checkDuplicate(eventId: string): Promise<boolean> {
    try {
      const isNew = await this.redisService.checkDuplicate(eventId);
      if (!isNew) {
        this.logger.debug(`Duplicate event detected: ${eventId}`);
      }
      return isNew;
    } catch (error) {
      this.logger.error(
        `Failed to check duplicate for event ${eventId}:`,
        error,
      );
      return true;
    }
  }

  async processEvent(event: EventBridgeEvent): Promise<void> {
    const { id: eventId, detail } = event;

    try {
      // 이벤트 ID로 중복 체크 (네트워크 재시도 방지)
      const isDuplicate = !(await this.checkDuplicate(eventId));
      if (isDuplicate) {
        this.logger.debug(`Skipping duplicate event: ${eventId}`);
        return;
      }

      await this.redisService.saveEventHistory(eventId, event);

      const buildId = detail['build-id'];
      const buildStatus = detail['build-status'];
      const projectName = detail['project-name'];

      this.logger.log(
        `Processing EventBridge event: ${eventId}, Build: ${buildId}, Status: ${buildStatus}`,
      );

      // Debug: Check if this is a Phase Change event
      if (
        !buildStatus &&
        event['detail-type'] === 'CodeBuild Build Phase Change'
      ) {
        // Use proper type casting for phase change events
        interface PhaseChangeDetail extends CodeBuildDetail {
          'current-phase'?: string;
          'completed-phase'?: string;
          'current-phase-status'?: string;
          'completed-phase-status'?: string;
        }
        const phaseDetail = detail as PhaseChangeDetail;
        const phase =
          phaseDetail['current-phase'] || phaseDetail['completed-phase'] || '';
        const phaseStatus =
          phaseDetail['current-phase-status'] ||
          phaseDetail['completed-phase-status'] ||
          '';
        this.logger.log(
          `Phase change event - Phase: ${phase}, Status: ${phaseStatus}`,
        );

        // Phase change 이벤트에서도 execution 찾아서 CloudWatch 폴링 확인
        const phaseExecution = await this.findExecutionByBuildId(buildId);
        if (
          phaseExecution &&
          !this.cloudwatchService.isPolling(phaseExecution.executionId)
        ) {
          this.logger.log(
            `Starting CloudWatch polling for phase change event - Execution: ${phaseExecution.executionId}`,
          );
          try {
            await this.cloudwatchService.startPolling(phaseExecution);
          } catch (error) {
            this.logger.error(
              `Failed to start CloudWatch polling: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
          }
        }

        // Phase 정보를 WebSocket으로 전송
        if (phaseExecution) {
          const phaseEvent = {
            executionId: phaseExecution.executionId,
            type: 'phase-change',
            phase: String(phase || ''),
            status: String(phaseStatus || ''),
            timestamp: new Date().toISOString(),
          };
          this.logsGateway.server
            .to(`execution:${phaseExecution.executionId}`)
            .emit('phase:update', phaseEvent);
        }

        return;
      }

      // buildId로 기존 실행 찾기 - 동일한 빌드의 연속된 이벤트는 같은 execution 사용
      let execution = await this.findExecutionByBuildId(buildId);

      if (!execution) {
        if (buildStatus === 'IN_PROGRESS') {
          // buildId에서 UUID 추출하여 executionId로 사용된 execution이 있는지 확인
          const executionId = buildId.split(':').pop();
          execution = await this.executionRepository.findOne({
            where: { executionId },
          });

          if (execution) {
            // CodeBuild 서비스에서 이미 생성한 execution이 있으면 awsBuildId와 logStreamName 업데이트
            this.logger.log(
              `Found pre-created execution ${executionId}, updating build info and starting CloudWatch polling`,
            );

            // logStreamName이 없으면 설정
            if (!execution.logStreamName) {
              execution.logStreamName = executionId;
            }

            execution.awsBuildId = buildId;
            await this.executionRepository.save(execution);

            // CloudWatch 폴링 시작
            try {
              this.logger.log(
                `Attempting to start CloudWatch polling for execution ${executionId}`,
              );
              await this.cloudwatchService.startPolling(execution);
              this.logger.log(
                `Successfully started CloudWatch polling for existing execution ${executionId}`,
              );
            } catch (error) {
              this.logger.error(
                `Failed to start CloudWatch polling for ${executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error instanceof Error ? error.stack : undefined,
              );
            }
          } else {
            // 정말로 새로운 execution이면 생성
            await this.createNewExecution(buildId, projectName, event);
            return;
          }
        } else {
          this.logger.warn(
            `No execution found for build ${buildId}, status: ${buildStatus}`,
          );
          return;
        }
      }

      await this.updateExecutionStatus(execution, buildStatus, detail);

      // EventBridge 상태 변경 이벤트는 로그로 저장하지 않음
      // CloudWatch 폴링을 통해 실제 빌드 로그를 가져옴

      // Status 변경만 WebSocket으로 브로드캐스트
      const statusEvent = {
        executionId: execution.executionId,
        type: 'status-change',
        status: buildStatus,
        timestamp: new Date().toISOString(),
      };
      this.broadcastStatusEvent(execution.executionId, statusEvent);
      const logEvent = this.createLogEvent(execution, event) as unknown;
      this.broadcastLogEvent(execution.executionId, logEvent);

      if (
        buildStatus === 'SUCCEEDED' ||
        buildStatus === 'FAILED' ||
        buildStatus === 'STOPPED'
      ) {
        await this.finalizeExecution(execution, buildStatus);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process EventBridge event ${eventId}:`,
        error,
      );
      throw error;
    }
  }

  private async findExecutionByBuildId(
    buildId: string,
  ): Promise<Execution | null> {
    try {
      const execution = await this.executionRepository.findOne({
        where: { awsBuildId: buildId },
        relations: ['project'],
      });
      return execution;
    } catch (error) {
      this.logger.error(
        `Failed to find execution for build ${buildId}:`,
        error,
      );
      return null;
    }
  }

  private async createNewExecution(
    buildId: string,
    projectName: string,
    event: EventBridgeEvent,
  ): Promise<void> {
    try {
      this.logger.log(
        `Creating new execution for build ${buildId}, project: ${projectName}`,
      );

      // Extract metadata from environment variables in build detail
      const additionalInfo = event.detail['additional-information'];
      const environment = additionalInfo?.environment;

      // 환경변수에서 사용자 컨텍스트 추출
      let projectId = '';
      let userId = '';
      let pipelineId = '';

      if (environment?.['environment-variables']) {
        const envVars = environment['environment-variables'];
        for (const envVar of envVars) {
          if (envVar.name === 'OTTO_USER_ID') {
            userId = envVar.value;
          } else if (envVar.name === 'OTTO_PROJECT_ID') {
            projectId = envVar.value;
          } else if (envVar.name === 'OTTO_PIPELINE_ID') {
            pipelineId = envVar.value;
          } else if (envVar.name === 'PIPELINE_ID') {
            pipelineId = pipelineId || envVar.value; // fallback
          }
        }
      }

      // Fallback: Extract from project name if not found in env vars
      if (!projectId) {
        const parts = projectName.split('-');
        if (parts.length >= 4) {
          projectId = parts[2];
        }
      }

      if (!userId) {
        this.logger.warn(
          `EventBridge execution missing userId context for ${buildId}`,
        );
        userId = 'eventbridge-user'; // Default fallback
      }

      // Extract log stream name from build ID
      const logStreamName = buildId.split(':').pop(); // Get UUID part

      const execution = this.executionRepository.create({
        awsBuildId: buildId,
        status: ExecutionStatus.RUNNING,
        executionType: ExecutionType.BUILD,
        startedAt: new Date(event.time),
        projectId: projectId || 'unknown',
        userId: userId,
        pipelineId: pipelineId || '',
        logStreamName: logStreamName, // CloudWatch 로그 스트림명 설정
        metadata: {
          source: 'eventbridge',
          projectName,
          region: event.region,
          account: event.account,
          logGroup: additionalInfo?.logs?.['group-name'],
          logStream: additionalInfo?.logs?.['stream-name'] || logStreamName,
        },
      });

      await this.executionRepository.save(execution);
      this.logger.log(
        `Created execution ${execution.executionId} for build ${buildId} with logStream ${logStreamName}`,
      );

      // Start CloudWatch polling for actual build logs
      try {
        await this.cloudwatchService.startPolling(execution);
        this.logger.log(
          `Started CloudWatch polling for execution ${execution.executionId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to start CloudWatch polling: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create execution for build ${buildId}:`,
        error,
      );
      throw error;
    }
  }

  private async updateExecutionStatus(
    execution: Execution,
    status: string,
    detail: CodeBuildDetail,
  ): Promise<void> {
    try {
      const statusMap: Record<string, ExecutionStatus> = {
        IN_PROGRESS: ExecutionStatus.RUNNING,
        SUCCEEDED: ExecutionStatus.SUCCESS,
        FAILED: ExecutionStatus.FAILED,
        STOPPED: ExecutionStatus.FAILED,
      };

      const newStatus = statusMap[status] || execution.status;

      const metadata: Record<string, unknown> = {};

      if (detail['current-phase']) {
        metadata.currentPhase = detail['current-phase'];
        metadata.currentPhaseContext = detail['current-phase-context'];
      }

      // EventBridge 이벤트에서 environment variables 추출하여 metadata에 저장
      this.logger.log(
        `🔍 Debug: additional-information 존재 여부: ${!!detail['additional-information']}`,
      );
      this.logger.log(
        `🔍 Debug: environment 존재 여부: ${!!detail['additional-information']?.environment}`,
      );

      const envVars =
        detail['additional-information']?.environment?.[
          'environment-variables'
        ];
      this.logger.log(
        `🔍 Debug: environment-variables 개수: ${envVars ? envVars.length : 0}`,
      );

      if (envVars && Array.isArray(envVars)) {
        // 모든 환경변수 로그 출력
        this.logger.log(`🔍 Debug: 전체 환경변수 목록:`);
        envVars.forEach((v, i) => {
          this.logger.log(`  ${i + 1}. ${v.name} = ${v.value}`);
        });

        const ottoUserId = envVars.find(
          (v) => v.name === 'OTTO_USER_ID',
        )?.value;
        const ottoProjectId = envVars.find(
          (v) => v.name === 'OTTO_PROJECT_ID',
        )?.value;
        const pipelineId = envVars.find((v) => v.name === 'PIPELINE_ID')?.value;

        this.logger.log(
          `🔍 Debug: 추출된 값들 - userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
        );

        if (ottoUserId && ottoProjectId && pipelineId) {
          metadata.ottoUserId = ottoUserId;
          metadata.ottoProjectId = ottoProjectId;
          metadata.pipelineId = pipelineId;
          metadata.projectName = detail['project-name']; // 기존 project name 유지

          this.logger.log(
            `   ✅ Environment Variables 추출 성공: userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
          );
        } else {
          this.logger.warn(
            `⚠️ 필요한 Environment Variables를 찾을 수 없습니다`,
          );
        }
      } else {
        this.logger.warn(`⚠️ environment-variables를 찾을 수 없습니다`);
      }

      // Use logsService.updateExecutionStatus to handle duration calculation and metadata update
      await this.logsService.updateExecutionStatus(
        execution.executionId,
        newStatus,
        metadata,
      );
      this.logger.debug(
        `Updated execution ${execution.executionId} status to ${newStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update execution ${execution.executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private createLogEvent(
    execution: Execution,
    event: EventBridgeEvent,
  ): {
    executionId: string;
    timestamp: string;
    type: string;
    level: LogLevel;
    message: string;
    metadata: {
      buildId: string;
      status: string;
      phase?: string;
      phaseContext?: string;
      projectName: string;
      source: string;
    };
  } {
    const { detail } = event;

    return {
      executionId: execution.executionId,
      timestamp: new Date(event.time).toISOString(),
      type: 'build-status-change',
      level: this.getLogLevel(detail['build-status']),
      message: this.formatLogMessage(detail),
      metadata: {
        buildId: detail['build-id'],
        status: detail['build-status'],
        phase: detail['current-phase'],
        phaseContext: detail['current-phase-context'],
        projectName: detail['project-name'],
        source: 'eventbridge',
      },
    };
  }

  private getLogLevel(status: string): LogLevel {
    switch (status) {
      case 'SUCCEEDED':
        return LogLevel.INFO;
      case 'FAILED':
      case 'STOPPED':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  private async saveLogToDatabase(
    execution: Execution,
    event: EventBridgeEvent,
    logEvent: {
      message: string;
      level: LogLevel;
      executionId: string;
      timestamp: string;
      type: string;
      metadata: any;
    },
  ): Promise<void> {
    try {
      const logData = {
        executionId: execution.executionId,
        timestamp: new Date(event.time),
        message: logEvent.message,
        level: logEvent.level,
      };

      await this.logStorage.saveLogs([logData]);
      this.logger.debug(
        `Saved log to database for execution ${execution.executionId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to save log to database for execution ${execution.executionId}:`,
        error,
      );
    }
  }

  private formatLogMessage(detail: CodeBuildDetail): string {
    const status = detail['build-status'];
    const phase = detail['current-phase'];
    const projectName = detail['project-name'];

    if (phase) {
      return `[${projectName}] Build ${status}: ${phase}`;
    }
    return `[${projectName}] Build ${status}`;
  }

  private broadcastLogEvent(executionId: string, logEvent: unknown): void {
    try {
      // Broadcast the log event through the gateway
      this.logsGateway.broadcastLogs(executionId, [logEvent]);
      this.logger.debug(`Broadcast log event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process log event for execution ${executionId}:`,
        error,
      );
    }
  }

  private broadcastStatusEvent(
    executionId: string,
    statusEvent: {
      executionId: string;
      type: string;
      status: string;
      timestamp: string;
    },
  ): void {
    try {
      // Normalize AWS CodeBuild statuses to internal ExecutionStatus for frontend
      const normalized = this.mapBuildStatusToExecutionStatus(
        statusEvent.status,
      );
      // Status broadcasts now handled through status change methods
      this.logsGateway.broadcastStatusChange(executionId, normalized);
      this.logger.debug(`Broadcast status event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast status event for execution ${executionId}:`,
        error,
      );
    }
  }

  private mapBuildStatusToExecutionStatus(status: string): ExecutionStatus {
    switch (status) {
      case 'IN_PROGRESS':
        return ExecutionStatus.RUNNING;
      case 'SUCCEEDED':
        return ExecutionStatus.SUCCESS;
      case 'FAILED':
      case 'STOPPED':
        return ExecutionStatus.FAILED;
      default:
        // Fallback to PENDING when unknown
        return ExecutionStatus.PENDING;
    }
  }

  private async finalizeExecution(
    execution: Execution,
    status: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Finalizing execution ${execution.executionId} with status ${status}`,
      );

      // Stop CloudWatch polling
      this.cloudwatchService.stopPolling(execution.executionId);
      this.logger.log(
        `Stopped CloudWatch polling for execution ${execution.executionId}`,
      );

      const finalEvent = {
        executionId: execution.executionId,
        type: 'execution-complete',
        status,
        completedAt: new Date().toISOString(),
      };

      this.logsGateway.broadcastExecutionComplete(
        execution.executionId,
        status,
      );
      this.logsGateway.broadcastLogs(execution.executionId, [finalEvent]);

      // 🚀 빌드 성공 시 자동 배포 트리거
      if (status === 'SUCCEEDED') {
        // Check if logs need recovery (SUCCESS but no logs)
        await this.checkAndRecoverLogs(execution);

        await this.triggerDeploymentAfterBuild(execution);
      }
    } catch (error) {
      this.logger.error(
        `Failed to finalize execution ${execution.executionId}:`,
        error,
      );
    }
  }

  /**
   * Check if execution has logs and attempt recovery if needed
   */
  private async checkAndRecoverLogs(execution: Execution): Promise<void> {
    try {
      // Small delay to ensure CloudWatch logs are available
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get execution with project relation
      const fullExecution = await this.executionRepository.findOne({
        where: { executionId: execution.executionId },
        relations: ['project'],
      });

      if (!fullExecution) {
        return;
      }

      // Check log count
      const logCount = await this.logStorage.getExecutionLogCount(
        execution.executionId,
      );

      if (logCount === 0) {
        this.logger.log(
          `Execution ${execution.executionId} completed successfully but has no logs. Attempting auto-recovery...`,
        );

        const recoveredCount =
          await this.cloudwatchService.autoRecoverLogsForExecution(
            fullExecution,
          );

        if (recoveredCount > 0) {
          this.logger.log(
            `✅ Auto-recovered ${recoveredCount} logs for execution ${execution.executionId}`,
          );

          // Broadcast recovered logs to connected clients
          const recoveredLogs = await this.logStorage.getExecutionLogs(
            execution.executionId,
            1000,
            0,
          );

          if (recoveredLogs.length > 0) {
            this.logsGateway.broadcastLogs(
              execution.executionId,
              recoveredLogs,
            );
          }
        }
      } else {
        this.logger.debug(
          `Execution ${execution.executionId} already has ${logCount} logs`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check/recover logs for execution ${execution.executionId}:`,
        error,
      );
      // Don't throw - this is best-effort
    }
  }

  /**
   * 빌드 성공 후 자동 배포 트리거
   * execution.awsBuildId를 통해 pipeline을 찾고 배포 시작
   */
  private async triggerDeploymentAfterBuild(
    execution: Execution,
  ): Promise<void> {
    try {
      this.logger.log(
        `🚀 빌드 성공! 자동 배포 트리거 시작: buildId=${execution.awsBuildId}`,
      );

      // Environment Variables에서 추출한 정보 우선 사용
      const ottoUserId = execution.metadata?.ottoUserId as string | undefined;
      const ottoProjectId = execution.metadata?.ottoProjectId as
        | string
        | undefined;
      const pipelineId = execution.metadata?.pipelineId as string | undefined;

      if (ottoUserId && ottoProjectId && pipelineId) {
        // Environment Variables에서 추출한 정확한 정보 사용
        this.logger.log(
          `   📋 Environment Variables 정보 사용: userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
        );

        // 직접 파이프라인 ID로 조회
        const pipeline = await this.pipelineRepository.findOne({
          where: { pipelineId },
          relations: ['project'],
        });

        if (pipeline) {
          this.logger.log(`✅ 파이프라인 발견: ${pipeline.pipelineId}`);
          await this.pipelineService.deployAfterBuildSuccess(
            pipelineId,
            ottoUserId,
          );
          this.logger.log(`🎉 자동 배포 트리거 완료: ${pipelineId}`);
          return;
        } else {
          this.logger.warn(`파이프라인을 찾을 수 없습니다: ${pipelineId}`);
        }
      }

      // 폴백: 기존 방식 (프로젝트 이름 파싱)
      const projectName = execution.metadata?.projectName as string | undefined;
      if (!projectName) {
        this.logger.warn(
          `프로젝트 이름과 Environment Variables 모두 없습니다: execution=${execution.executionId}`,
        );
        return;
      }

      // 프로젝트 이름에서 userId와 projectId 추출 (구 방식 - 오류 있음)
      const nameMatch = projectName.match(
        /^otto-(development|production)-(.+?)-build$/,
      );
      if (!nameMatch) {
        this.logger.warn(`프로젝트 이름 형식이 잘못되었습니다: ${projectName}`);
        return;
      }

      const [, environment, projectId] = nameMatch as [string, string, string];
      this.logger.log(
        `   📋 프로젝트명 파싱 정보: environment=${environment}, projectId=${projectId}`,
      );

      // 해당 프로젝트의 가장 최근 파이프라인 찾기 (ecrImageUri가 있는 것)
      // 폴백 방식: projectId만으로 검색 (userId를 모르므로)
      const pipeline = await this.pipelineRepository
        .createQueryBuilder('pipeline')
        .leftJoinAndSelect('pipeline.project', 'project')
        .where('project.projectId = :projectId', { projectId })
        .andWhere('pipeline.ecrImageUri IS NOT NULL')
        .orderBy('pipeline.updatedAt', 'DESC')
        .getOne();

      if (!pipeline) {
        this.logger.warn(
          `배포할 파이프라인을 찾을 수 없습니다: projectId=${projectId} (폴백 방식)`,
        );
        return;
      }

      this.logger.log(`   ✅ 파이프라인 발견: ${pipeline.pipelineId}`);

      // 자동 배포 시작 (project에서 userId 가져옴)
      this.logger.log(`   🚀 자동 배포 시작...`);
      const deploymentResult =
        await this.pipelineService.deployAfterBuildSuccess(
          pipeline.pipelineId,
          pipeline.project.userId,
        );

      this.logger.log(`🎉 자동 배포 완료!`);
      this.logger.log(`   🌐 배포 URL: https://${deploymentResult.deployUrl}`);
      this.logger.log(`   🔗 ECS 서비스: ${deploymentResult.ecsServiceArn}`);

      // 배포 완료 이벤트 브로드캐스트
      const deployEvent = {
        executionId: execution.executionId,
        type: 'deployment-complete',
        deployUrl: deploymentResult.deployUrl,
        ecsServiceArn: deploymentResult.ecsServiceArn,
        timestamp: new Date().toISOString(),
      };
      this.logsGateway.broadcastLogs(execution.executionId, [deployEvent]);
    } catch (error) {
      this.logger.error(`❌ 자동 배포 실패: ${error}`);

      // 배포 실패 이벤트 브로드캐스트
      const errorEvent = {
        executionId: execution.executionId,
        type: 'deployment-failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      this.logsGateway.broadcastLogs(execution.executionId, [errorEvent]);
    }
  }

  isEventBridgeEnabled(): boolean {
    return this.useEventBridge;
  }
}
