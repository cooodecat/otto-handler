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
import { Execution } from '../../../database/entities/execution.entity';
import { Project } from '../../../database/entities/project.entity';
import { LogBufferService } from '../log-buffer/log-buffer.service';
import { LogStorageService } from '../log-storage/log-storage.service';
import { LogLevel } from '../../../database/entities/execution-log.entity';

interface LogEvent {
  executionId: string;
  timestamp: Date;
  message: string;
  level: LogLevel;
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
    // Mock implementation for development
    if (this.configService.get<boolean>('USE_MOCK_DATA', false)) {
      this.logger.log(
        `[MOCK] Starting polling for execution ${execution.executionId}`,
      );
      return;
    }
    const project = await this.projectRepository.findOne({
      where: { projectId: execution.projectId },
    });

    if (!project?.cloudwatchLogGroup) {
      throw new Error(
        `CloudWatch log group not found for project ${execution.projectId}`,
      );
    }

    if (!execution.logStreamName) {
      throw new Error(
        `Log stream name not found for execution ${execution.executionId}`,
      );
    }

    let nextToken: string | undefined;
    let retryCount = 0;
    const maxRetries = 5;

    const pollInterval = setInterval(async () => {
      try {
        const input: GetLogEventsCommandInput = {
          logGroupName: project.cloudwatchLogGroup,
          logStreamName: execution.logStreamName,
          nextToken,
          startFromHead: !nextToken,
        };

        const command = new GetLogEventsCommand(input);
        const response: GetLogEventsCommandOutput =
          await this.client.send(command);

        if (response.events && response.events.length > 0) {
          const logs: LogEvent[] = response.events.map((event) => ({
            executionId: execution.executionId,
            timestamp: new Date(event.timestamp!),
            message: event.message!,
            level: this.detectLogLevel(event.message!),
          }));

          // DB에 저장
          await this.logStorage.saveLogs(logs);

          // 버퍼에 추가 (실시간 전송용)
          this.logBuffer.addLogs(execution.executionId, logs);

          // TODO: WebSocket 브로드캐스트 (Phase 3에서 구현)
          // this.logsGateway.broadcastLogs(execution.executionId, logs);
        }

        nextToken = response.nextForwardToken;
        retryCount = 0; // 성공 시 재시도 카운터 리셋

        // 실행 완료 확인
        const updatedExecution = await this.executionRepository.findOne({
          where: { executionId: execution.executionId },
        });

        if (
          updatedExecution?.status === 'success' ||
          updatedExecution?.status === 'failed'
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
          error,
        );

        if (retryCount >= maxRetries) {
          this.logger.error(
            `Max retries reached for ${execution.executionId}. Stopping polling.`,
          );
          this.stopPolling(execution.executionId);
        }
      }
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
}
