import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
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
import { ExecutionLog } from '../database/entities/execution-log.entity';
import { User } from '../database/entities/user.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { Project } from '../database/entities/project.entity';
import { CodeBuildService } from '../codebuild/codebuild.service';

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
  ) {}

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
        .andWhere('execution.createdAt >= :oneDayAgo', { oneDayAgo })
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
