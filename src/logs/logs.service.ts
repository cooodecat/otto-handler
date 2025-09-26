import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogStorageService } from './services/log-storage/log-storage.service';
import {
  Execution,
  ExecutionStatus,
  ExecutionType,
} from '../database/entities/execution.entity';
import {
  ExecutionLog,
  LogLevel,
} from '../database/entities/execution-log.entity';
import { User } from '../database/entities/user.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { Project } from '../database/entities/project.entity';
import { CodeBuildService } from '../codebuild/codebuild.service';
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  FilterLogEventsCommandInput,
} from '@aws-sdk/client-cloudwatch-logs';

interface RegisterExecutionDto {
  pipelineId: string;
  projectId: string;
  userId: string;
  executionType: ExecutionType;
  awsBuildId?: string;
  awsDeploymentId?: string;
  logStreamName?: string;
  metadata?: {
    branch?: string;
    commitId?: string;
    triggeredBy?: string;
    [key: string]: any;
  };
}

interface ExecutionQueryDto {
  userId?: string;
  pipelineId?: string;
  projectId?: string;
  status?: ExecutionStatus;
  executionType?: ExecutionType;
  limit?: number;
  offset?: number;
}

interface LogQueryDto {
  limit?: number;
  offset?: number;
  level?: string;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly cloudwatchClient: CloudWatchLogsClient;

  constructor(
    @InjectRepository(Execution)
    private readonly executionRepository: Repository<Execution>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly cloudwatchService: CloudwatchService,
    private readonly logBuffer: LogBufferService,
    private readonly logStorage: LogStorageService,
    @Inject(forwardRef(() => CodeBuildService))
    private readonly codeBuildService: CodeBuildService,
    private readonly configService: ConfigService,
  ) {
    this.cloudwatchClient = new CloudWatchLogsClient({
      region: this.configService.get<string>('AWS_REGION') || 'ap-northeast-2',
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        )!,
      },
    });
  }

  async registerExecution(dto: RegisterExecutionDto): Promise<Execution> {
    const execution = new Execution();
    execution.pipelineId = dto.pipelineId;
    execution.projectId = dto.projectId;
    execution.userId = dto.userId;
    execution.executionType = dto.executionType;
    execution.awsBuildId = dto.awsBuildId;
    execution.awsDeploymentId = dto.awsDeploymentId;
    execution.logStreamName = dto.logStreamName;
    execution.metadata = dto.metadata;
    execution.status = ExecutionStatus.PENDING;

    const savedExecution = await this.executionRepository.save(execution);

    // CloudWatch 폴링 시작 (로그 스트림이 있는 경우)
    if (dto.logStreamName) {
      try {
        await this.cloudwatchService.startPolling(savedExecution);
      } catch (error) {
        this.logger.error(
          `Failed to start polling for execution ${savedExecution.executionId}:`,
          error as Error,
        );
      }
    }

    this.logger.log(`Registered execution ${savedExecution.executionId}`);
    return savedExecution;
  }

  async getExecutions(query: ExecutionQueryDto): Promise<Execution[]> {
    const queryBuilder =
      this.executionRepository.createQueryBuilder('execution');

    if (query.userId) {
      queryBuilder.andWhere('execution.userId = :userId', {
        userId: query.userId,
      });
    }
    if (query.pipelineId) {
      queryBuilder.andWhere('execution.pipelineId = :pipelineId', {
        pipelineId: query.pipelineId,
      });
    }
    if (query.projectId) {
      queryBuilder.andWhere('execution.projectId = :projectId', {
        projectId: query.projectId,
      });
    }
    if (query.status) {
      queryBuilder.andWhere('execution.status = :status', {
        status: query.status,
      });
    }
    if (query.executionType) {
      queryBuilder.andWhere('execution.executionType = :executionType', {
        executionType: query.executionType,
      });
    }

    queryBuilder
      .leftJoinAndSelect('execution.pipeline', 'pipeline')
      .leftJoinAndSelect('execution.project', 'project')
      .orderBy('execution.startedAt', 'DESC');

    if (query.offset) {
      queryBuilder.skip(query.offset);
    }
    if (query.limit) {
      queryBuilder.take(query.limit);
    }

    return queryBuilder.getMany();
  }

  async getExecutionById(
    executionId: string,
    userId?: string,
  ): Promise<Execution> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
      relations: ['pipeline', 'project', 'user'],
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    if (userId && execution.userId !== userId) {
      throw new ForbiddenException('Access denied to this execution');
    }

    return execution;
  }

  async updateExecutionStatus(
    executionId: string,
    status: ExecutionStatus,
    metadata?: unknown,
  ): Promise<void> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    execution.status = status;
    if (metadata) {
      execution.metadata = {
        ...(execution.metadata as object),
        ...(metadata as object),
      };
    }

    if (
      status === ExecutionStatus.SUCCESS ||
      status === ExecutionStatus.FAILED
    ) {
      execution.completedAt = new Date();

      // Calculate duration
      if (execution.startedAt) {
        const durationMs =
          execution.completedAt.getTime() - execution.startedAt.getTime();
        execution.duration = Math.floor(durationMs / 1000); // Duration in seconds
      }

      // 폴링 중지
      this.cloudwatchService.stopPolling(executionId);
    }

    await this.executionRepository.save(execution);
    this.logger.log(`Updated execution ${executionId} status to ${status}`);
  }

  async getExecutionLogs(
    executionId: string,
    query: LogQueryDto,
  ): Promise<ExecutionLog[]> {
    // First try to get logs from database
    const dbLogs = await this.logStorage.getExecutionLogs(
      executionId,
      query.limit,
      query.offset,
    );

    // If no logs in database, try buffer
    if (dbLogs.length === 0) {
      const bufferLogs = this.logBuffer.getRecentLogs(executionId, query.limit);
      // Convert buffer logs to ExecutionLog format if needed
      return bufferLogs.map((log) => ({
        ...log,
        executionId,
        createdAt: log.timestamp || new Date(),
      })) as ExecutionLog[];
    }

    return dbLogs;
  }

  /**
   * Get combined logs for an execution (build + deploy logs from all sources)
   */
  async getCombinedExecutionLogs(
    executionId: string,
    query: LogQueryDto,
  ): Promise<ExecutionLog[]> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
      relations: ['project', 'pipeline'],
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    const allLogs: ExecutionLog[] = [];

    // 1. Get build logs from database/buffer (existing logic)
    const buildLogs = await this.getExecutionLogs(executionId, query);
    allLogs.push(...buildLogs);

    // 2. Get deploy logs from ECS CloudWatch
    // Try to find related deploy execution or use current execution if it has ECS logs
    if (execution.pipelineId) {
      try {
        let deployExecution = execution;

        // If this is a BUILD execution, find the corresponding DEPLOY execution
        if (execution.executionType === ExecutionType.BUILD) {
          const deployExec = await this.executionRepository.findOne({
            where: {
              pipelineId: execution.pipelineId,
              executionType: ExecutionType.DEPLOY,
            },
            order: { startedAt: 'DESC' }, // Get the most recent deploy
          });

          if (deployExec) {
            deployExecution = deployExec;
          }
        }

        // Get ECS logs if we have a deploy execution with logStreamName
        if (deployExecution.logStreamName) {
          const ecsLogs = await this.getEcsLogsForExecution(deployExecution);
          allLogs.push(...ecsLogs);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch ECS logs for execution ${executionId}: ${error}`,
        );
      }
    }

    // Sort by timestamp
    allLogs.sort((a, b) => {
      const timeA = a.timestamp?.getTime() || a.createdAt?.getTime() || 0;
      const timeB = b.timestamp?.getTime() || b.createdAt?.getTime() || 0;
      return timeA - timeB;
    });

    // Apply limit if specified
    if (query.limit) {
      return allLogs.slice(0, query.limit);
    }

    return allLogs;
  }

  /**
   * Get ECS logs for a specific execution using its logStreamName
   */
  private async getEcsLogsForExecution(
    execution: Execution,
  ): Promise<ExecutionLog[]> {
    if (!execution.pipelineId || !execution.logStreamName) {
      return [];
    }

    const logGroupName = `/ecs/otto-pipelines/${execution.pipelineId}`;

    // Use the execution-specific log stream name
    const logStreamName = execution.logStreamName;

    this.logger.log(
      `Fetching ECS logs for execution ${execution.executionId} from ${logGroupName}/${logStreamName}`,
    );

    try {
      const filterParams: FilterLogEventsCommandInput = {
        logGroupName,
        logStreamNames: [logStreamName], // Filter by specific stream
        limit: 1000,
      };

      const command = new FilterLogEventsCommand(filterParams);
      const response = await this.cloudwatchClient.send(command);

      const ecsLogs: ExecutionLog[] = (response.events || []).map((event) => {
        const log = new ExecutionLog();
        log.executionId = execution.executionId;
        log.timestamp = new Date(event.timestamp!);
        log.message = event.message || '';
        log.level = LogLevel.INFO; // Default to INFO, you can enhance this logic
        log.phase = 'DEPLOY';
        log.step = 'ECS_SERVICE';
        log.stepOrder = 1000; // Put deploy logs after build logs
        log.createdAt = new Date(event.timestamp!);
        return log;
      });

      this.logger.log(
        `Retrieved ${ecsLogs.length} ECS logs for execution ${execution.executionId}`,
      );
      return ecsLogs;
    } catch (error) {
      this.logger.error(
        `Failed to fetch ECS logs for execution ${execution.executionId}:`,
        error as Error,
      );
      return [];
    }
  }

  getBufferedLogs(executionId: string, limit?: number): unknown[] {
    return this.logBuffer.getRecentLogs(executionId, limit);
  }

  async checkAccess(userId: string, executionId: string): Promise<boolean> {
    // Development mode: allow access to all executions for testing
    if (process.env.NODE_ENV === 'development') {
      this.logger.log(
        `Development mode: Allowing access to execution ${executionId} for user ${userId}`,
      );
      return true;
    }

    const execution = await this.executionRepository.findOne({
      where: { executionId },
      relations: ['project'],
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    // 실행 소유자이거나 프로젝트 소유자인 경우 접근 허용
    return (
      execution.userId === userId ||
      (execution.project && execution.project.userId === userId)
    );
  }

  async getHistoricalLogs(
    executionId: string,
    limit: number,
  ): Promise<ExecutionLog[]> {
    // In development mode with test executions, return empty array if no logs found
    if (
      process.env.NODE_ENV === 'development' &&
      executionId.startsWith('test-')
    ) {
      try {
        return await this.logStorage.getExecutionLogs(executionId, limit);
      } catch {
        this.logger.warn(
          `No historical logs for test execution ${executionId}`,
        );
        return [];
      }
    }
    return this.logStorage.getExecutionLogs(executionId, limit);
  }

  clearExecutionBuffer(executionId: string): void {
    this.logBuffer.clearBuffer(executionId);
    this.logger.log(`Cleared buffer for execution ${executionId}`);
  }

  getBufferStats(): Record<string, unknown> {
    return {
      buffers: this.logBuffer.getBufferStats(),
      totalLogs: this.logBuffer.getTotalBufferedLogs(),
    };
  }

  /**
   * Check for stale executions and update their status
   * Runs every minute via cron job
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkStaleExecutions(): Promise<void> {
    try {
      const staleThresholdMinutes = 5; // Consider stale after 5 minutes of no updates
      const now = new Date();
      const staleTime = new Date(
        now.getTime() - staleThresholdMinutes * 60 * 1000,
      );

      // Find running executions that haven't been updated recently
      const staleExecutions = await this.executionRepository.find({
        where: {
          status: ExecutionStatus.RUNNING,
          updatedAt: LessThan(staleTime),
        },
      });

      if (staleExecutions.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${staleExecutions.length} potentially stale executions`,
      );

      for (const execution of staleExecutions) {
        try {
          // Check if execution has awsBuildId
          if (!execution.awsBuildId) {
            this.logger.warn(
              `Execution ${execution.executionId} has no AWS Build ID`,
            );
            continue;
          }

          // Check actual status from AWS CodeBuild
          const buildStatus = await this.codeBuildService.getBuildStatus(
            execution.awsBuildId,
          );

          this.logger.log(
            `Execution ${execution.executionId} AWS status: ${buildStatus.buildStatus}`,
          );

          // Map AWS status to our status
          let newStatus: ExecutionStatus | null = null;
          const metadata: any = {};

          switch (buildStatus.buildStatus) {
            case 'SUCCEEDED':
              newStatus = ExecutionStatus.SUCCESS;
              break;
            case 'FAILED':
            case 'STOPPED':
            case 'TIMED_OUT':
              newStatus = ExecutionStatus.FAILED;
              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              metadata.failureReason = `Build ${buildStatus.buildStatus.toLowerCase()}`;
              break;
            case 'IN_PROGRESS':
              // Still running, update the timestamp to prevent repeated checks
              execution.updatedAt = new Date();
              await this.executionRepository.save(execution);
              this.logger.log(
                `Execution ${execution.executionId} is still running, updated timestamp`,
              );
              continue;
            default:
              this.logger.warn(
                `Unknown build status ${buildStatus.buildStatus} for execution ${execution.executionId}`,
              );
              continue;
          }

          // Check if logs exist before updating status to SUCCESS
          if (newStatus === ExecutionStatus.SUCCESS) {
            const logCount = await this.logStorage.getExecutionLogCount(
              execution.executionId,
            );

            this.logger.log(
              `Execution ${execution.executionId} has ${logCount} logs`,
            );

            // If no logs found, try to fetch from CloudWatch
            if (logCount === 0) {
              this.logger.log(
                `No logs found for successful execution ${execution.executionId}, attempting to fetch from CloudWatch`,
              );

              // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
              metadata.logsRecovered = false;

              // Check if we have log stream info from build status
              if (buildStatus.logs?.streamName && buildStatus.logs?.groupName) {
                try {
                  // Fetch all logs at once and save to database
                  const recoveredCount =
                    await this.cloudwatchService.fetchAndSaveAllLogs(
                      execution.executionId,
                      buildStatus.logs.groupName,
                      buildStatus.logs.streamName,
                    );

                  if (recoveredCount > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.logsRecovered = true;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.logsRecoveredCount = recoveredCount;
                    this.logger.log(
                      `Successfully recovered ${recoveredCount} logs for execution ${execution.executionId}`,
                    );
                  } else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.warning =
                      'Build succeeded but no logs could be retrieved';
                    this.logger.warn(
                      `Could not recover logs for execution ${execution.executionId}`,
                    );
                  }
                } catch (logError) {
                  this.logger.error(
                    `Failed to recover logs for execution ${execution.executionId}: ${
                      logError instanceof Error
                        ? logError.message
                        : 'Unknown error'
                    }`,
                  );
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  metadata.warning = 'Build succeeded but log recovery failed';
                }
              } else if (execution.logStreamName) {
                // Try with execution's stored log stream info
                try {
                  const logGroupName = `/aws/codebuild/${execution.projectId}`;
                  const recoveredCount =
                    await this.cloudwatchService.fetchAndSaveAllLogs(
                      execution.executionId,
                      logGroupName,
                      execution.logStreamName,
                    );

                  if (recoveredCount > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.logsRecovered = true;
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.logsRecoveredCount = recoveredCount;
                    this.logger.log(
                      `Successfully recovered ${recoveredCount} logs for execution ${execution.executionId}`,
                    );
                  } else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    metadata.warning = 'Build succeeded but no logs found';
                  }
                } catch (logError) {
                  this.logger.error(
                    `Failed to recover logs: ${logError instanceof Error ? logError.message : 'Unknown'}`,
                  );
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                  metadata.warning = 'Build succeeded but log recovery failed';
                }
              } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                metadata.warning =
                  'Build succeeded but no log stream information available';
                this.logger.warn(
                  `No log stream info for execution ${execution.executionId}`,
                );
              }
            }
          }

          // Update execution status if changed
          if (newStatus && newStatus !== execution.status) {
            await this.updateExecutionStatus(execution.executionId, newStatus, {
              ...metadata,
              updatedBy: 'heartbeat',
              checkedAt: new Date().toISOString(),
            });

            this.logger.log(
              `Updated stale execution ${execution.executionId} from RUNNING to ${newStatus}`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to check execution ${execution.executionId}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to check stale executions: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Scheduled task to recover missing logs for successful executions
   * Runs every 5 minutes to check recent successful executions without logs
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverMissingLogs(): Promise<void> {
    try {
      this.logger.debug('Starting scheduled task: Recover missing logs');

      // Find successful executions from the last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const successfulExecutions = await this.executionRepository
        .createQueryBuilder('execution')
        .leftJoinAndSelect('execution.project', 'project')
        .where('execution.status = :status', {
          status: ExecutionStatus.SUCCESS,
        })
        .andWhere('execution.started_at >= :oneDayAgo', { oneDayAgo })
        .getMany();

      let recoveredCount = 0;

      for (const execution of successfulExecutions) {
        try {
          // Check if execution has logs
          const logCount = await this.logStorage.getExecutionLogCount(
            execution.executionId,
          );

          if (logCount === 0 && execution.logStreamName) {
            this.logger.log(
              `Found successful execution ${execution.executionId} without logs, attempting recovery`,
            );

            const recovered =
              await this.cloudwatchService.autoRecoverLogsForExecution(
                execution,
              );

            if (recovered > 0) {
              recoveredCount++;
              this.logger.log(
                `✅ Recovered ${recovered} logs for execution ${execution.executionId}`,
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Failed to recover logs for execution ${execution.executionId}:`,
            error,
          );
        }
      }

      if (recoveredCount > 0) {
        this.logger.log(
          `Scheduled task completed: Recovered logs for ${recoveredCount} executions`,
        );
      }
    } catch (error) {
      this.logger.error('Failed to run scheduled log recovery:', error);
    }
  }

  /**
   * Get ECS deployment logs for a pipeline
   */
  async getEcsDeploymentLogs(
    pipelineId: string,
    userId?: string,
    options: {
      limit?: number;
      startTime?: Date;
      endTime?: Date;
    } = {},
  ): Promise<{
    logs: Array<{
      timestamp: string;
      message: string;
      level: string;
      streamName: string;
    }>;
    logGroupName: string;
    hasMore: boolean;
  }> {
    try {
      // Verify user has access to this pipeline
      const pipeline = await this.pipelineRepository.findOne({
        where: { pipelineId },
        relations: ['project'],
      });

      if (!pipeline) {
        throw new NotFoundException(`Pipeline ${pipelineId} not found`);
      }

      if (userId && pipeline.project?.userId !== userId) {
        throw new ForbiddenException('Access denied to this pipeline');
      }

      // ECS log group naming: /ecs/otto-pipelines/{pipelineId}
      const logGroupName = `/ecs/otto-pipelines/${pipelineId}`;

      this.logger.log(
        `Fetching ECS logs for pipeline ${pipelineId} from ${logGroupName}`,
      );

      // Create filter parameters
      const filterParams: FilterLogEventsCommandInput = {
        logGroupName,
        limit: Math.min(options.limit || 1000, 10000), // AWS limit is 10,000
        startTime: options.startTime?.getTime(),
        endTime: options.endTime?.getTime(),
        // Sort by timestamp descending to get most recent logs first
      };

      const command = new FilterLogEventsCommand(filterParams);
      const response = await this.cloudwatchClient.send(command);

      // Transform AWS log events to our format
      const logs = (response.events || []).map((event) => ({
        timestamp: new Date(event.timestamp!).toISOString(),
        message: event.message || '',
        level: this.detectEcsLogLevel(event.message || ''),
        streamName: event.logStreamName || 'unknown',
      }));

      this.logger.log(
        `Retrieved ${logs.length} ECS logs for pipeline ${pipelineId}`,
      );

      return {
        logs,
        logGroupName,
        hasMore:
          !!response.nextToken && logs.length === (options.limit || 1000),
      };
    } catch (error) {
      this.logger.error(
        `Failed to fetch ECS logs for pipeline ${pipelineId}:`,
        error as Error,
      );

      // Handle specific AWS errors
      if ((error as Error).name === 'ResourceNotFoundException') {
        return {
          logs: [],
          logGroupName: `/ecs/otto-pipelines/${pipelineId}`,
          hasMore: false,
        };
      }

      throw error;
    }
  }

  /**
   * Detect log level from ECS log message
   */
  private detectEcsLogLevel(message: string): string {
    const lowerMessage = message.toLowerCase();

    if (
      lowerMessage.includes('error') ||
      lowerMessage.includes('failed') ||
      lowerMessage.includes('exception') ||
      lowerMessage.includes('fatal')
    ) {
      return 'ERROR';
    }

    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
      return 'WARNING';
    }

    if (
      lowerMessage.includes('info') ||
      lowerMessage.includes('starting') ||
      lowerMessage.includes('listening') ||
      lowerMessage.includes('server')
    ) {
      return 'INFO';
    }

    if (lowerMessage.includes('debug') || lowerMessage.includes('trace')) {
      return 'DEBUG';
    }

    // Default to INFO for HTTP requests and general messages
    return 'INFO';
  }

  /**
   * Get ECS runtime logs for a specific execution with filtering
   */
  async getEcsRuntimeLogsByExecution(
    executionId: string,
    userId: string,
    options: {
      limit?: number;
      containerName?: string;
      streamPrefix?: string;
      startTime?: Date;
      endTime?: Date;
    } = {},
  ): Promise<{
    logs: Array<{
      timestamp: string;
      message: string;
      level: string;
      streamName: string;
      containerName?: string;
    }>;
    logGroupName: string;
    hasMore: boolean;
    totalStreams: number;
  }> {
    const execution = await this.getExecutionById(executionId, userId);

    if (!execution?.pipelineId) {
      throw new NotFoundException('Pipeline not found for execution');
    }

    const logGroupName = `/ecs/otto-pipelines/${execution.pipelineId}`;
    
    try {
      // First, discover actual log streams that match this execution
      const matchingStreams = await this.discoverExecutionLogStreams(
        logGroupName,
        executionId,
        options.containerName
      );

      if (matchingStreams.length === 0) {
        this.logger.warn(
          `No matching log streams found for execution ${executionId} in ${logGroupName}`
        );
        return {
          logs: [],
          logGroupName,
          hasMore: false,
          totalStreams: 0,
        };
      }

      this.logger.log(
        `Found ${matchingStreams.length} matching streams for execution ${executionId}: ${matchingStreams.join(', ')}`
      );

      const filterParams: FilterLogEventsCommandInput = {
        logGroupName,
        logStreamNames: matchingStreams, // Use discovered stream names
        limit: Math.min(options.limit || 1000, 10000),
        startTime: options.startTime?.getTime(),
        endTime: options.endTime?.getTime(),
      };

      const command = new FilterLogEventsCommand(filterParams);
      const response = await this.cloudwatchClient.send(command);

      const logs = (response.events || [])
        .map((event) => {
          const message = event.message || '';
          const streamName = event.logStreamName || 'unknown';
          
          // Extract container name from stream name
          // Stream format: {executionId}/{containerName}/{containerInstanceId}
          const containerName = this.extractContainerNameFromStream(streamName);
          
          return {
            timestamp: new Date(event.timestamp || Date.now()).toISOString(),
            message,
            level: this.detectEcsLogLevel(message),
            streamName,
            containerName,
          };
        })
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      return {
        logs,
        logGroupName,
        hasMore: !!response.nextToken,
        totalStreams: matchingStreams.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get ECS runtime logs for execution ${executionId}`,
        error,
      );

      if (error.name === 'ResourceNotFoundException') {
        return {
          logs: [],
          logGroupName,
          hasMore: false,
          totalStreams: 0,
        };
      }

      throw error;
    }
  }

  /**
   * Discover actual log streams that match a specific execution
   */
  private async discoverExecutionLogStreams(
    logGroupName: string,
    executionId: string,
    containerName?: string,
  ): Promise<string[]> {
    try {
      const { DescribeLogStreamsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
      
      // Get all log streams in the log group with prefix matching execution
      const command = new DescribeLogStreamsCommand({
        logGroupName,
        logStreamNamePrefix: executionId, // Now using executionId directly as prefix
        orderBy: 'LastEventTime',
        descending: true,
        limit: 50, // Reasonable limit for streams per execution
      });

      const response = await this.cloudwatchClient.send(command);
      const streams = response.logStreams || [];

      let matchingStreams = streams
        .filter(stream => {
          const streamName = stream.logStreamName || '';
          // Must start with {executionId}
          if (!streamName.startsWith(`${executionId}`)) {
            return false;
          }
          // If container name specified, stream must contain it
          if (containerName && !streamName.includes(containerName)) {
            return false;
          }
          return true;
        })
        .map(stream => stream.logStreamName!)
        .filter(Boolean);

      this.logger.log(
        `Discovered ${matchingStreams.length} streams for execution ${executionId}: ${matchingStreams.join(', ')}`
      );

      return matchingStreams;
    } catch (error) {
      this.logger.error(
        `Failed to discover log streams for execution ${executionId} in ${logGroupName}`,
        error,
      );
      return [];
    }
  }

  /**
   * Extract container name from ECS log stream name
   * Stream format: {executionId}/{containerName}/{containerInstanceId}
   */
  private extractContainerNameFromStream(streamName: string): string | undefined {
    const parts = streamName.split('/');
    if (parts.length >= 2) {
      return parts[1]; // containerName
    }
    return undefined;
  }

  /**
   * Manually trigger stale execution check (for testing)
   */
  async checkStaleExecutionsManually(): Promise<{
    checked: number;
    updated: number;
  }> {
    const staleThresholdMinutes = 5;
    const now = new Date();
    const staleTime = new Date(
      now.getTime() - staleThresholdMinutes * 60 * 1000,
    );

    const staleExecutions = await this.executionRepository.find({
      where: {
        status: ExecutionStatus.RUNNING,
        updatedAt: LessThan(staleTime),
      },
    });

    let updatedCount = 0;

    for (const execution of staleExecutions) {
      try {
        if (!execution.awsBuildId) continue;

        const buildStatus = await this.codeBuildService.getBuildStatus(
          execution.awsBuildId,
        );

        if (buildStatus.buildStatus !== 'IN_PROGRESS') {
          const newStatus =
            buildStatus.buildStatus === 'SUCCEEDED'
              ? ExecutionStatus.SUCCESS
              : ExecutionStatus.FAILED;

          await this.updateExecutionStatus(execution.executionId, newStatus, {
            updatedBy: 'manual-check',
            previousStatus: 'RUNNING',
            awsStatus: buildStatus.buildStatus,
          });

          updatedCount++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to check execution ${execution.executionId}`,
          error,
        );
      }
    }

    return {
      checked: staleExecutions.length,
      updated: updatedCount,
    };
  }
}
