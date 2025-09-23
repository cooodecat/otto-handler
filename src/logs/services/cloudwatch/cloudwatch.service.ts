import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  GetLogEventsCommandInput,
  GetLogEventsCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs';
import {
  Execution,
  ExecutionStatus,
} from '../../../database/entities/execution.entity';
import { Project } from '../../../database/entities/project.entity';
import { LogBufferService } from '../log-buffer/log-buffer.service';
import { LogStorageService } from '../log-storage/log-storage.service';
import { LogLevel } from '../../../database/entities/execution-log.entity';

interface LogEvent {
  executionId: string;
  timestamp: Date;
  message: string;
  level: LogLevel;
  phase?: string;
  step?: string;
  stepOrder?: number;
}

@Injectable()
export class CloudwatchService {
  private readonly logger = new Logger(CloudwatchService.name);
  private client: CloudWatchLogsClient;
  private pollers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Execution)
    private readonly executionRepository: Repository<Execution>,
    private readonly logBuffer: LogBufferService,
    private readonly logStorage: LogStorageService,
  ) {
    this.client = new CloudWatchLogsClient({
      region: this.configService.get<string>('AWS_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });
  }

  async startPolling(execution: Execution): Promise<void> {
    this.logger.log(
      `Starting CloudWatch polling for execution ${execution.executionId}`,
    );

    this.logger.log(
      `Looking up project ${execution.projectId} for CloudWatch config`,
    );

    const project = await this.projectRepository.findOne({
      where: { projectId: execution.projectId },
    });

    if (!project?.cloudwatchLogGroup) {
      this.logger.error(
        `CloudWatch log group not found for project ${execution.projectId}`,
      );
      throw new Error(
        `CloudWatch log group not found for project ${execution.projectId}`,
      );
    }

    if (!execution.logStreamName) {
      this.logger.error(
        `Log stream name not found for execution ${execution.executionId}`,
      );
      throw new Error(
        `Log stream name not found for execution ${execution.executionId}`,
      );
    }

    this.logger.log(
      `CloudWatch config found - LogGroup: ${project.cloudwatchLogGroup}, LogStream: ${execution.logStreamName}`,
    );

    let nextToken: string | undefined;
    let retryCount = 0;
    const maxRetries = 5;

    const pollInterval = setInterval(() => {
      (async () => {
        try {
          const input: GetLogEventsCommandInput = {
            logGroupName: project.cloudwatchLogGroup || undefined,
            logStreamName: execution.logStreamName,
            nextToken,
            startFromHead: !nextToken,
          };

          const command = new GetLogEventsCommand(input);
          const response: GetLogEventsCommandOutput =
            await this.client.send(command);

          if (response.events && response.events.length > 0) {
            const logs: LogEvent[] = response.events.map((event) => {
              const { phase, step, stepOrder } = this.parseLogPhaseAndStep(
                event.message!,
              );
              return {
                executionId: execution.executionId,
                timestamp: new Date(event.timestamp!),
                message: event.message!,
                level: this.detectLogLevel(event.message!),
                phase,
                step,
                stepOrder,
              };
            });

            // DB에 저장
            await this.logStorage.saveLogs(logs);

            // 버퍼에 추가 (실시간 전송용)
            this.logBuffer.addLogs(execution.executionId, logs);

            // LogBufferService will emit events for WebSocket broadcasting
            this.logger.debug(
              `Added ${logs.length} logs to buffer for execution ${execution.executionId}`,
            );
          }

          nextToken = response.nextForwardToken;
          retryCount = 0; // 성공 시 재시도 카운터 리셋

          // 실행 완료 확인
          const updatedExecution = await this.executionRepository.findOne({
            where: { executionId: execution.executionId },
          });

          if (
            updatedExecution?.status === ExecutionStatus.SUCCESS ||
            updatedExecution?.status === ExecutionStatus.FAILED
          ) {
            this.logger.log(
              `Execution ${execution.executionId} completed with status: ${updatedExecution.status}`,
            );
            this.stopPolling(execution.executionId);
          }
        } catch (error) {
          retryCount++;
          this.logger.error(
            `Polling error for ${execution.executionId} (retry ${retryCount}/${maxRetries}):`,
            error as Error,
          );

          if (retryCount >= maxRetries) {
            this.logger.error(
              `Max retries reached for ${execution.executionId}. Stopping polling.`,
            );
            this.stopPolling(execution.executionId);
          }
        }
      })().catch((error: Error) => {
        this.logger.error(
          `Unhandled error in polling interval: ${error.message}`,
        );
      });
    }, 1000); // 1초마다 폴링

    this.pollers.set(execution.executionId, pollInterval);
    this.logger.log(`Started polling for execution ${execution.executionId}`);
  }

  stopPolling(executionId: string): void {
    const poller = this.pollers.get(executionId);
    if (poller) {
      clearInterval(poller);
      this.pollers.delete(executionId);
      this.logger.log(`Stopped polling for execution ${executionId}`);
    }
  }

  stopAllPolling(): void {
    this.pollers.forEach((poller, executionId) => {
      clearInterval(poller);
      this.logger.log(`Stopped polling for execution ${executionId}`);
    });
    this.pollers.clear();
  }

  private detectLogLevel(message: string): LogLevel {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('fail')) {
      return LogLevel.ERROR;
    }
    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
      return LogLevel.WARNING;
    }
    return LogLevel.INFO;
  }

  private parseLogPhaseAndStep(message: string): {
    phase?: string;
    step?: string;
    stepOrder?: number;
  } {
    let phase: string | undefined;
    let step: string | undefined;
    let stepOrder: number | undefined;

    // Check for phase transitions using patterns
    if (/Phase complete:\s+(\w+)/i.test(message)) {
      const match = message.match(/Phase complete:\s+(\w+)/i);
      if (match) phase = match[1];
    } else if (/Entering phase\s+(\w+)/i.test(message)) {
      const match = message.match(/Entering phase\s+(\w+)/i);
      if (match) phase = match[1];
    } else if (/Running command\s+(.*)/i.test(message)) {
      const match = message.match(/Running command\s+(.*)/i);
      if (match) step = 'Running: ' + match[1].substring(0, 50);
    }

    // Check for phase markers
    if (message.includes('DOWNLOAD_SOURCE')) {
      phase = 'DOWNLOAD_SOURCE';
      step = 'Downloading source code';
      stepOrder = 1;
    } else if (message.includes('INSTALL')) {
      phase = 'INSTALL';
      step = 'Installing dependencies';
      stepOrder = 2;
    } else if (message.includes('PRE_BUILD')) {
      phase = 'PRE_BUILD';
      step = 'Pre-build setup';
      stepOrder = 3;
    } else if (message.includes('BUILD')) {
      phase = 'BUILD';
      step = 'Building application';
      stepOrder = 4;
    } else if (message.includes('POST_BUILD')) {
      phase = 'POST_BUILD';
      step = 'Post-build tasks';
      stepOrder = 5;
    } else if (message.includes('UPLOAD_ARTIFACTS')) {
      phase = 'UPLOAD_ARTIFACTS';
      step = 'Uploading artifacts';
      stepOrder = 6;
    } else if (message.includes('FINALIZING')) {
      phase = 'FINALIZING';
      step = 'Finalizing build';
      stepOrder = 7;
    }

    // Extract specific step from "Running command" messages
    const runningCommandMatch = message.match(/Running command\s+(.*)/);
    if (runningCommandMatch) {
      step = runningCommandMatch[1].trim();
    }

    return { phase, step, stepOrder };
  }
}
