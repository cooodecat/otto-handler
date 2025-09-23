import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis/redis.service';
import { LogsGateway } from './logs.gateway';
import { Execution, ExecutionStatus } from '../database/entities/execution.entity';
import { LogsService } from './logs.service';
import { ConfigService } from '@nestjs/config';

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
    'initiator'?: string;
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
    @InjectRepository(Execution)
    private executionRepository: Repository<Execution>,
  ) {
    this.useEventBridge = this.configService.get<boolean>('USE_EVENTBRIDGE', false);
    this.logger.log(`EventBridge integration: ${this.useEventBridge ? 'Enabled' : 'Disabled'}`);
  }

  async checkDuplicate(eventId: string): Promise<boolean> {
    try {
      const isNew = await this.redisService.checkDuplicate(eventId);
      if (!isNew) {
        this.logger.debug(`Duplicate event detected: ${eventId}`);
      }
      return isNew;
    } catch (error) {
      this.logger.error(`Failed to check duplicate for event ${eventId}:`, error);
      return true;
    }
  }

  async processEvent(event: EventBridgeEvent): Promise<void> {
    const { id: eventId, detail } = event;

    try {
      const isDuplicate = !(await this.checkDuplicate(eventId));
      if (isDuplicate) {
        this.logger.debug(`Skipping duplicate event: ${eventId}`);
        return;
      }

      await this.redisService.saveEventHistory(eventId, event);

      const buildId = detail['build-id'];
      const buildStatus = detail['build-status'];
      const projectName = detail['project-name'];

      this.logger.log(`Processing EventBridge event: ${eventId}, Build: ${buildId}, Status: ${buildStatus}`);

      const execution = await this.findExecutionByBuildId(buildId);
      
      if (!execution) {
        if (buildStatus === 'IN_PROGRESS') {
          await this.createNewExecution(buildId, projectName, event);
        } else {
          this.logger.warn(`No execution found for build ${buildId}, status: ${buildStatus}`);
        }
        return;
      }

      await this.updateExecutionStatus(execution, buildStatus, detail);

      const logEvent = this.createLogEvent(execution, event);
      await this.broadcastLogEvent(execution.executionId, logEvent);

      if (buildStatus === 'SUCCEEDED' || buildStatus === 'FAILED' || buildStatus === 'STOPPED') {
        await this.finalizeExecution(execution, buildStatus);
      }

    } catch (error) {
      this.logger.error(`Failed to process EventBridge event ${eventId}:`, error);
      throw error;
    }
  }

  private async findExecutionByBuildId(buildId: string): Promise<Execution | null> {
    try {
      const execution = await this.executionRepository.findOne({
        where: { awsBuildId: buildId },
        relations: ['project'],
      });
      return execution;
    } catch (error) {
      this.logger.error(`Failed to find execution for build ${buildId}:`, error);
      return null;
    }
  }

  private async createNewExecution(
    buildId: string,
    projectName: string,
    event: EventBridgeEvent,
  ): Promise<void> {
    try {
      this.logger.log(`Creating new execution for build ${buildId}, project: ${projectName}`);
      
      const execution = this.executionRepository.create({
        awsBuildId: buildId,
        status: ExecutionStatus.RUNNING,
        startedAt: new Date(event.time),
        metadata: {
          source: 'eventbridge',
          projectName,
          region: event.region,
          account: event.account,
        },
      });

      await this.executionRepository.save(execution);
      this.logger.log(`Created execution ${execution.executionId} for build ${buildId}`);
    } catch (error) {
      this.logger.error(`Failed to create execution for build ${buildId}:`, error);
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
        'IN_PROGRESS': ExecutionStatus.RUNNING,
        'SUCCEEDED': ExecutionStatus.SUCCESS,
        'FAILED': ExecutionStatus.FAILED,
        'STOPPED': ExecutionStatus.FAILED,
      };

      execution.status = statusMap[status] || execution.status;
      
      if (detail['additional-information']?.['end-time']) {
        execution.completedAt = new Date(detail['additional-information']['end-time']);
      }

      if (detail['current-phase']) {
        execution.metadata = {
          ...execution.metadata,
          currentPhase: detail['current-phase'],
          currentPhaseContext: detail['current-phase-context'],
        };
      }

      await this.executionRepository.save(execution);
      this.logger.debug(`Updated execution ${execution.executionId} status to ${execution.status}`);
    } catch (error) {
      this.logger.error(`Failed to update execution ${execution.executionId}:`, error);
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

  private async broadcastLogEvent(executionId: string, logEvent: any): Promise<void> {
    try {
      this.logsGateway.broadcastLogs(executionId, [logEvent]);
      this.logger.debug(`Broadcast log event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(`Failed to broadcast log event for execution ${executionId}:`, error);
    }
  }

  private async finalizeExecution(execution: Execution, status: string): Promise<void> {
    try {
      this.logger.log(`Finalizing execution ${execution.executionId} with status ${status}`);
      
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
    } catch (error) {
      this.logger.error(`Failed to finalize execution ${execution.executionId}:`, error);
    }
  }

  isEventBridgeEnabled(): boolean {
    return this.useEventBridge;
  }
}