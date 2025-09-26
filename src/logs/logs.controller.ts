import {
  Controller,
  HttpCode,
  HttpStatus,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import {
  TypedParam,
  TypedException,
  TypedRoute,
  TypedQuery,
  TypedBody,
} from '@nestia/core';
import { LogsService } from './logs.service';
import { AuthGuard } from '../common/decorator';
import { CommonErrorResponseDto } from '../common/dtos';
import {
  ExecutionStatus,
  Execution,
  ExecutionType,
} from '../database/entities/execution.entity';
import type { IRequestType } from '../common/type';

@Controller('/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  /**
   * @tag logs
   * @summary Get ECS deployment logs for a pipeline
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid pipeline ID',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Pipeline not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/ecs/:pipelineId')
  async getEcsLogs(
    @TypedParam('pipelineId') pipelineId: string,
    @TypedQuery()
    query: {
      limit?: number;
      startTime?: string;
      endTime?: string;
    },
    @Req() req: IRequestType,
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
    const result = await this.logsService.getEcsDeploymentLogs(
      pipelineId,
      req.user.userId,
      {
        limit: query.limit || 1000,
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
      },
    );

    return {
      logs: result.logs,
      logGroupName: result.logGroupName,
      hasMore: result.hasMore || false,
    };
  }

  /**
   * @tag logs
   * @summary Get ECS deployment logs by execution ID
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution ID',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/ecs/execution/:executionId')
  async getEcsLogsByExecution(
    @TypedParam('executionId') executionId: string,
    @TypedQuery()
    query: {
      limit?: number;
    },
    @Req() req: IRequestType,
  ): Promise<{
    logs: Array<{
      timestamp: string;
      message: string;
      level: string;
      phase: string | null;
      step: string | null;
      executionType: string;
    }>;
    hasMore: boolean;
  }> {
    // Access control check
    const hasAccess = await this.logsService.checkAccess(
      req.user.userId,
      executionId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this execution');
    }

    // Get all logs for this execution (both build and deploy)
    const logs = await this.logsService.getCombinedExecutionLogs(executionId, {
      limit: query.limit || 1000,
    });

    return {
      logs: logs.map((log) => ({
        timestamp:
          log.timestamp?.toISOString() || log.createdAt?.toISOString() || '',
        message: log.message || '',
        level: log.level || 'INFO',
        phase: log.phase || null,
        step: log.step || null,
        executionType: 'COMBINED', // Build + Deploy logs combined
      })),
      hasMore: false, // TODO: implement pagination if needed
    };
  }

  /**
   * @tag logs
   * @summary Get execution logs by execution ID
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution ID',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/executions/:executionId')
  async getExecutionLogs(
    @TypedParam('executionId') executionId: string,
    @TypedQuery()
    query: {
      limit?: number;
      offset?: number;
      level?: string;
    },
    @Req() req: IRequestType,
  ): Promise<{
    logs: Array<{
      timestamp: string;
      message: string;
      level: string;
      phase?: string | null;
      step?: string | null;
    }>;
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  }> {
    const hasAccess = await this.logsService.checkAccess(
      req.user.userId,
      executionId,
    );

    if (!hasAccess) {
      return {
        logs: [],
        pagination: {
          limit: query.limit || 100,
          offset: query.offset || 0,
          total: 0,
        },
      };
    }

    const logs = await this.logsService.getExecutionLogs(executionId, {
      limit: query.limit || 100,
      offset: query.offset || 0,
      level: query.level,
    });

    // Transform ExecutionLog to match return type
    const transformedLogs = logs.map((log) => ({
      timestamp:
        log.timestamp instanceof Date
          ? log.timestamp.toISOString()
          : String(log.timestamp),
      message: log.message || '',
      level: log.level || 'INFO',
      phase: log.phase,
      step: log.step,
    }));

    return {
      logs: transformedLogs,
      pagination: {
        limit: query.limit || 100,
        offset: query.offset || 0,
        total: logs.length,
      },
    };
  }

  /**
   * @tag logs
   * @summary Get execution details by ID
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution ID',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/executions/:executionId/details')
  async getExecutionById(
    @TypedParam('executionId') executionId: string,
    @Req() req: IRequestType,
  ): Promise<{
    executionId: string;
    pipelineId: string;
    projectId: string;
    executionType: string;
    status: string;
    awsBuildId?: string;
    awsDeploymentId?: string;
    logStreamName?: string;
    metadata?: Record<string, any>;
    startedAt: Date;
    completedAt?: Date;
    updatedAt: Date;
    isArchived: boolean;
    archiveUrl?: string;
    logCount: number;
  }> {
    if (!executionId || !executionId.match(/^[0-9a-f-]+$/i)) {
      throw new Error('Invalid execution ID format');
    }

    const execution = await this.logsService.getExecutionById(
      executionId,
      req.user.userId,
    );

    return {
      executionId: execution.executionId,
      pipelineId: execution.pipelineId,
      projectId: execution.projectId,
      executionType: execution.executionType,
      status: execution.status,
      awsBuildId: execution.awsBuildId,
      awsDeploymentId: execution.awsDeploymentId,
      logStreamName: execution.logStreamName,
      metadata: execution.metadata,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      updatedAt: execution.updatedAt,
      isArchived: execution.isArchived,
      archiveUrl: execution.archiveUrl,
      logCount: execution.logs?.length || 0,
    };
  }

  /**
   * @tag logs
   * @summary Update execution status
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution ID or status',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Patch('/executions/:executionId/status')
  async updateExecutionStatus(
    @TypedParam('executionId') executionId: string,
    @TypedBody()
    body: {
      status: string;
      metadata?: Record<string, any>;
      errorMessage?: string;
      archiveUrl?: string;
      completedAt?: string;
    },
    @Req() req: IRequestType,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const hasAccess = await this.logsService.checkAccess(
      req.user.userId,
      executionId,
    );

    if (!hasAccess) {
      return {
        success: false,
        message: 'Access denied to update execution',
      };
    }

    await this.logsService.updateExecutionStatus(
      executionId,
      body.status as ExecutionStatus,
      {
        ...body.metadata,
        errorMessage: body.errorMessage,
        archiveUrl: body.archiveUrl,
        completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
      },
    );

    return {
      success: true,
      message: `Execution status updated to ${body.status}`,
    };
  }

  /**
   * @tag logs
   * @summary Get all executions with filters
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/executions')
  async getExecutions(
    @TypedQuery()
    query: {
      status?: string;
      executionType?: string;
      pipelineId?: string;
      projectId?: string;
      limit?: number;
      offset?: number;
    },
    @Req() req: IRequestType,
  ): Promise<
    Array<{
      executionId: string;
      pipelineId: string;
      projectId: string;
      executionType: string;
      status: string;
      awsBuildId?: string | null;
      awsDeploymentId?: string | null;
      logStreamName?: string | null;
      metadata?: Record<string, any> | null;
      startedAt: Date;
      completedAt?: Date | null;
      updatedAt: Date;
      isArchived: boolean;
      archiveUrl?: string | null;
      logCount: number;
    }>
  > {
    const executions = await this.logsService.getExecutions({
      userId: req.user.userId,
      status: query.status as ExecutionStatus,
      executionType: query.executionType as ExecutionType,
      pipelineId: query.pipelineId,
      projectId: query.projectId,
      limit: query.limit || 20,
      offset: query.offset || 0,
    });

    return executions.map((execution) => ({
      executionId: execution.executionId,
      pipelineId: execution.pipelineId,
      projectId: execution.projectId,
      executionType: execution.executionType,
      status: execution.status,
      awsBuildId: execution.awsBuildId,
      awsDeploymentId: execution.awsDeploymentId,
      logStreamName: execution.logStreamName,
      metadata: {
        ...execution.metadata,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        pipelineName:
          execution.pipeline?.pipelineName ||
          execution.metadata?.pipelineName ||
          'Unknown Pipeline',
      },
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      updatedAt: execution.updatedAt,
      isArchived: execution.isArchived,
      archiveUrl: execution.archiveUrl,
      logCount: execution.logs?.length || 0,
    }));
  }

  /**
   * @tag logs
   * @summary Recover missing logs for completed executions
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Post('/executions/recover-missing-logs')
  async recoverMissingLogs(@Req() req: IRequestType): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    try {
      await this.logsService.recoverMissingLogs();
      return {
        success: true,
        message: 'Log recovery completed successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Log recovery failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * @tag logs
   * @summary Check for stale executions
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Post('/executions/check-stale')
  async checkStaleExecutions(@Req() req: IRequestType): Promise<{
    checked: number;
    updated: number;
    message: string;
  }> {
    const result = await this.logsService.checkStaleExecutionsManually();

    return {
      ...result,
      message: `Checked ${result.checked} executions, updated ${result.updated} to their actual status`,
    };
  }

  /**
   * @tag logs
   * @summary Get ECS runtime logs for specific execution with service filtering
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid execution ID',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/ecs/execution/:executionId/runtime')
  async getEcsRuntimeLogsByExecution(
    @TypedParam('executionId') executionId: string,
    @TypedQuery()
    query: {
      limit?: number;
      containerName?: string;
      streamPrefix?: string;
      startTime?: string;
      endTime?: string;
    },
    @Req() req: IRequestType,
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
    // Access control check
    const hasAccess = await this.logsService.checkAccess(
      req.user.userId,
      executionId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('Access denied to this execution');
    }

    const result = await this.logsService.getEcsRuntimeLogsByExecution(
      executionId,
      req.user.userId,
      {
        limit: query.limit || 1000,
        containerName: query.containerName,
        streamPrefix: query.streamPrefix,
        startTime: query.startTime ? new Date(query.startTime) : undefined,
        endTime: query.endTime ? new Date(query.endTime) : undefined,
      },
    );

    return {
      logs: result.logs,
      logGroupName: result.logGroupName,
      hasMore: result.hasMore || false,
      totalStreams: result.totalStreams || 0,
    };
  }
}
