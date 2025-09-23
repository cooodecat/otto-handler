import { Injectable, Logger } from '@nestjs/common';
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
    private readonly logStorageService: LogStorageService,
    private readonly cloudwatchService: CloudwatchService,
    @InjectRepository(Execution)
    private executionRepository: Repository<Execution>,
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
    } catch (error: unknown) {
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
        const phase = detail['current-phase'];
        const phaseStatus = detail['current-phase-status'] as string;
        this.logger.log(
          `Phase change event - Phase: ${phase}, Status: ${phaseStatus}`,
        );

        // Phase change 이벤트는 무시하고 State change 이벤트만 처리
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
            } catch (error: unknown) {
              const errorObj = error as { message?: string; stack?: string };
              this.logger.error(
                `Failed to start CloudWatch polling for ${executionId}: ${errorObj.message || 'Unknown error'}`,
                errorObj.stack,
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

      if (
        buildStatus === 'SUCCEEDED' ||
        buildStatus === 'FAILED' ||
        buildStatus === 'STOPPED'
      ) {
        this.finalizeExecution(execution, buildStatus);
      }
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
      } catch (error: unknown) {
        const errorObj = error as { message?: string };
        this.logger.error(
          `Failed to start CloudWatch polling: ${errorObj.message || 'Unknown error'}`,
        );
      }
    } catch (error: unknown) {
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

      execution.status = statusMap[status] || execution.status;

      if (detail['additional-information']?.['end-time']) {
        execution.completedAt = new Date(
          detail['additional-information']['end-time'],
        );
      }

      if (detail['current-phase']) {
        execution.metadata = {
          ...execution.metadata,
          currentPhase: detail['current-phase'],
          currentPhaseContext: detail['current-phase-context'],
        };
      }

      await this.executionRepository.save(execution);
      this.logger.debug(
        `Updated execution ${execution.executionId} status to ${execution.status}`,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to update execution ${execution.executionId}:`,
        error,
      );
      throw error;
    }
  }

  private createLogEvent(execution: Execution, event: EventBridgeEvent): any {
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
    logEvent: { message: string; level: LogLevel; [key: string]: any },
  ): Promise<void> {
    try {
      const logData = {
        executionId: execution.executionId,
        timestamp: new Date(event.time),
        message: logEvent.message,
        level: logEvent.level,
      };

      await this.logStorageService.saveLogs([logData]);
      this.logger.debug(
        `Saved log to database for execution ${execution.executionId}`,
      );
    } catch (error: unknown) {
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

  private broadcastLogEvent(executionId: string): void {
    try {
      // Events are now broadcasted through LogBufferService event emitter
      this.logger.debug(`Log event ready for execution ${executionId}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to process log event for execution ${executionId}:`,
        error,
      );
    }
  }

  private broadcastStatusEvent(
    executionId: string,
    statusEvent: { status: string; [key: string]: any },
  ): void {
    try {
      // Status broadcasts now handled through status change methods
      this.logsGateway.broadcastStatusChange(executionId, statusEvent.status);
      this.logger.debug(`Broadcast status event for execution ${executionId}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to broadcast status event for execution ${executionId}:`,
        error,
      );
    }
  }

  private finalizeExecution(execution: Execution, status: string): void {
    try {
      this.logger.log(
        `Finalizing execution ${execution.executionId} with status ${status}`,
      );

      // Stop CloudWatch polling
      this.cloudwatchService.stopPolling(execution.executionId);
      this.logger.log(
        `Stopped CloudWatch polling for execution ${execution.executionId}`,
      );

      this.logsGateway.broadcastExecutionComplete(
        execution.executionId,
        status,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to finalize execution ${execution.executionId}:`,
        error,
      );
    }
  }

  isEventBridgeEnabled(): boolean {
    return this.useEventBridge;
  }
}
