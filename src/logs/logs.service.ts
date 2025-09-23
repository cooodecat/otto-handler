import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
          error,
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
    metadata?: any,
  ): Promise<void> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
    });

    if (!execution) {
      throw new NotFoundException(`Execution ${executionId} not found`);
    }

    execution.status = status;
    if (metadata) {
      execution.metadata = { ...(execution.metadata as object), ...metadata };
    }

    if (
      status === ExecutionStatus.SUCCESS ||
      status === ExecutionStatus.FAILED
    ) {
      execution.completedAt = new Date();
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
}
