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
    @Inject(forwardRef(() => PipelineService))
    private readonly pipelineService: PipelineService,
    @InjectRepository(Execution)
    private executionRepository: Repository<Execution>,
    @InjectRepository(Pipeline)
    private pipelineRepository: Repository<Pipeline>,
  ) {
    this.useEventBridge = this.configService.get<boolean>(
      'USE_EVENTBRIDGE',
      false,
    );
    this.logger.log(
      `EventBridge integration: ${this.useEventBridge ? 'Enabled' : 'Disabled'}`,
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

      // buildId로 기존 실행 찾기 - 동일한 빌드의 연속된 이벤트는 같은 execution 사용
      const execution = await this.findExecutionByBuildId(buildId);

      if (!execution) {
        if (buildStatus === 'IN_PROGRESS') {
          await this.createNewExecution(buildId, projectName, event);
        } else {
          this.logger.warn(
            `No execution found for build ${buildId}, status: ${buildStatus}`,
          );
        }
        return;
      }

      await this.updateExecutionStatus(execution, buildStatus, detail);

      const logEvent = this.createLogEvent(execution, event);
      await this.broadcastLogEvent(execution.executionId, logEvent);

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

      const execution = this.executionRepository.create({
        awsBuildId: buildId,
        status: ExecutionStatus.RUNNING,
        executionType: ExecutionType.BUILD, // CodeBuild는 항상 build 타입
        startedAt: new Date(event.time),
        metadata: {
          source: 'eventbridge',
          projectName,
          region: event.region,
          account: event.account,
        },
      });

      await this.executionRepository.save(execution);
      this.logger.log(
        `Created execution ${execution.executionId} for build ${buildId}`,
      );
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
    } catch (error) {
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

  private getLogLevel(status: string): string {
    switch (status) {
      case 'SUCCEEDED':
        return 'info';
      case 'FAILED':
      case 'STOPPED':
        return 'error';
      default:
        return 'debug';
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

  private async broadcastLogEvent(
    executionId: string,
    logEvent: any,
  ): Promise<void> {
    try {
      this.logsGateway.broadcastLogs(executionId, [logEvent]);
      this.logger.debug(`Broadcast log event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast log event for execution ${executionId}:`,
        error,
      );
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

      if (this.useEventBridge) {
        // Stop polling will be handled by CloudWatch service if enabled
      }

      const finalEvent = {
        executionId: execution.executionId,
        type: 'execution-complete',
        status,
        completedAt: new Date().toISOString(),
      };

      this.logsGateway.broadcastLogs(execution.executionId, [finalEvent]);

      // 🚀 빌드 성공 시 자동 배포 트리거
      if (status === 'SUCCEEDED') {
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
   * 빌드 성공 후 자동 배포 트리거
   * execution.awsBuildId를 통해 pipeline을 찾고 배포 시작
   */
  private async triggerDeploymentAfterBuild(execution: Execution): Promise<void> {
    try {
      this.logger.log(`🚀 빌드 성공! 자동 배포 트리거 시작: buildId=${execution.awsBuildId}`);

      // awsBuildId로 pipeline 찾기 (빌드 시 pipeline 정보가 CodeBuild에 전달됨)
      // 하지만 execution에 pipelineId가 직접 저장되어 있지 않으므로, 
      // buildId에서 pipelineId를 추출하거나 metadata에서 찾아야 함
      
      const projectName = execution.metadata?.projectName;
      if (!projectName) {
        this.logger.warn(`프로젝트 이름을 찾을 수 없습니다: execution=${execution.executionId}`);
        return;
      }

      // 프로젝트 이름에서 userId와 projectId 추출
      // 예: "otto-user123-proj456" -> userId="user123", projectId="proj456"
      const nameMatch = projectName.match(/^otto-(.+)-(.+)$/);
      if (!nameMatch) {
        this.logger.warn(`프로젝트 이름 형식이 잘못되었습니다: ${projectName}`);
        return;
      }

      const [, userId, projectId] = nameMatch;
      this.logger.log(`   📋 추출된 정보: userId=${userId}, projectId=${projectId}`);

      // 해당 프로젝트의 가장 최근 파이프라인 찾기 (ecrImageUri가 있는 것)
      const pipeline = await this.pipelineRepository
        .createQueryBuilder('pipeline')
        .leftJoinAndSelect('pipeline.project', 'project')
        .where('project.userId = :userId', { userId })
        .andWhere('project.projectId = :projectId', { projectId })
        .andWhere('pipeline.ecrImageUri IS NOT NULL')
        .orderBy('pipeline.updatedAt', 'DESC')
        .getOne();

      if (!pipeline) {
        this.logger.warn(`배포할 파이프라인을 찾을 수 없습니다: userId=${userId}, projectId=${projectId}`);
        return;
      }

      this.logger.log(`   ✅ 파이프라인 발견: ${pipeline.pipelineId}`);

      // 자동 배포 시작
      this.logger.log(`   🚀 자동 배포 시작...`);
      const deploymentResult = await this.pipelineService.deployAfterBuildSuccess(
        pipeline.pipelineId,
        userId,
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
        error: error.message,
        timestamp: new Date().toISOString(),
      };
      this.logsGateway.broadcastLogs(execution.executionId, [errorEvent]);
    }
  }

  isEventBridgeEnabled(): boolean {
    return this.useEventBridge;
  }
}
