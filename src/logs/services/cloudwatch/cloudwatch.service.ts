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

  isPolling(executionId: string): boolean {
    return this.pollers.has(executionId);
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

  /**
   * Fetch all logs at once and save to database (for recovery)
   */
  async fetchAndSaveAllLogs(
    executionId: string,
    logGroupName: string,
    logStreamName: string,
  ): Promise<number> {
    this.logger.log(
      `Fetching all logs for execution ${executionId}
      - Log Group: ${logGroupName}
      - Log Stream: ${logStreamName}`,
    );

    const execution = await this.executionRepository.findOne({
      where: { executionId },
    });

    if (!execution) {
      this.logger.error(`Execution ${executionId} not found in database`);
      throw new Error(`Execution ${executionId} not found`);
    }

    this.logger.log(
      `Found execution: ${JSON.stringify({
        executionId: execution.executionId,
        status: execution.status,
        awsBuildId: execution.awsBuildId,
        logStreamName: execution.logStreamName,
      })}`,
    );

    let nextToken: string | undefined;
    let totalLogsSaved = 0;
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loops

    try {
      while (attempts < maxAttempts) {
        attempts++;

        const input = {
          logGroupName,
          logStreamName,
          nextToken,
          startFromHead: !nextToken,
        };

        this.logger.log(
          `Fetching logs attempt ${attempts}/${maxAttempts}, nextToken: ${nextToken ? 'present' : 'null'}`,
        );

        const command = new GetLogEventsCommand(input);
        const response = await this.client.send(command);

        this.logger.log(
          `CloudWatch response: ${response.events?.length || 0} events, nextToken: ${response.nextForwardToken ? 'present' : 'null'}`,
        );

        if (response.events && response.events.length > 0) {
          const logs: LogEvent[] = response.events.map((event) => {
            const { phase, step, stepOrder } = this.parseLogPhaseAndStep(
              event.message!,
            );
            return {
              executionId,
              timestamp: new Date(event.timestamp!),
              message: event.message!,
              level: this.detectLogLevel(event.message!),
              phase,
              step,
              stepOrder,
            };
          });

          // Save to database
          await this.logStorage.saveLogs(logs);
          totalLogsSaved += logs.length;

          this.logger.log(
            `Saved ${logs.length} logs for execution ${executionId} (total: ${totalLogsSaved})`,
          );
        }

        // Check if there are more logs
        if (
          response.nextForwardToken === nextToken ||
          !response.nextForwardToken
        ) {
          // No more logs
          break;
        }

        nextToken = response.nextForwardToken;
      }

      this.logger.log(
        `Finished fetching logs for execution ${executionId}. Total saved: ${totalLogsSaved}`,
      );

      return totalLogsSaved;
    } catch (error) {
      this.logger.error(
        `Failed to fetch logs for execution ${executionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      if (error instanceof Error) {
        this.logger.error(
          `Error details: ${JSON.stringify({
            name: error.name,
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n'),
          })}`,
        );
      }
      throw error;
    }
  }

  /**
   * Auto-recover logs for executions that are complete but have no logs
   */
  async autoRecoverLogsForExecution(execution: Execution): Promise<number> {
    try {
      // Check if execution already has logs
      const existingLogCount = await this.logStorage.getExecutionLogCount(
        execution.executionId,
      );

      if (existingLogCount > 0) {
        this.logger.debug(
          `Execution ${execution.executionId} already has ${existingLogCount} logs, skipping recovery`,
        );
        return existingLogCount;
      }

      // Determine CloudWatch log group
      let logGroupName: string;
      const logStreamName: string =
        execution.logStreamName || execution.executionId;

      // First, try to use the cloudwatchLogGroup from the project entity
      if (execution.project?.cloudwatchLogGroup) {
        logGroupName = execution.project.cloudwatchLogGroup;
      } else {
        // Build log group name based on environment pattern
        const nodeEnv = process.env.NODE_ENV || 'development';
        const environment =
          nodeEnv === 'production' ? 'production' : 'development';

        // Pattern: /aws/codebuild/otto/{environment}/{userId}/{projectId}
        if (execution.userId && execution.projectId) {
          logGroupName = `/aws/codebuild/otto/${environment}/${execution.userId}/${execution.projectId}`;
        } else if (execution.projectId) {
          // Fallback without userId
          logGroupName = `/aws/codebuild/otto/${environment}/${execution.projectId}`;
        } else {
          this.logger.warn(
            `Cannot determine log group for execution ${execution.executionId}: missing projectId`,
          );
          return 0;
        }
      }

      this.logger.log(
        `Auto-recovering logs for execution ${execution.executionId} from ${logGroupName}/${logStreamName}`,
      );

      // Attempt to fetch and save logs
      const recoveredCount = await this.fetchAndSaveAllLogs(
        execution.executionId,
        logGroupName,
        logStreamName,
      );

      if (recoveredCount > 0) {
        this.logger.log(
          `Successfully auto-recovered ${recoveredCount} logs for execution ${execution.executionId}`,
        );
      }

      return recoveredCount;
    } catch (error) {
      this.logger.error(
        `Failed to auto-recover logs for execution ${execution.executionId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      // Don't throw - auto-recovery is best-effort
      return 0;
    }
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
