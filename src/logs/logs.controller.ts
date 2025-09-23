import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  HttpException,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { LogsService } from './logs.service';
import { AuthGuardRole } from '../common/guard/auth.guard';
import { RegisterExecutionDto } from './dto/register-execution.dto';
import { ExecutionResponseDto } from './dto/execution-response.dto';
import { LogQueryDto } from './dto/log-query.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import type { IRequestType } from '../common/type';
import {
  ExecutionStatus,
  ExecutionType,
} from '../database/entities/execution.entity';

@ApiTags('logs')
@Controller('logs')
@UseGuards(AuthGuardRole)
@ApiBearerAuth()
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Post('executions/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new execution' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Execution registered successfully',
    type: ExecutionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error',
  })
  async registerExecution(
    @Body() dto: RegisterExecutionDto,
    @Request() req: IRequestType,
  ): Promise<ExecutionResponseDto> {
    try {
      const execution = await this.logsService.registerExecution({
        pipelineId: dto.context,
        projectId: dto.functionName,
        userId: req.user.userId,
        executionType: ExecutionType.BUILD,
        metadata: {
          ...dto.metadata,
          inputParams: dto.inputParams,
        },
      });

      return this.mapToExecutionResponse(execution);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to register execution: ${error.message}`,
      );
    }
  }

  @Get('executions')
  @ApiOperation({ summary: 'Get executions list' })
  @ApiQuery({ name: 'status', required: false, enum: ExecutionStatus })
  @ApiQuery({ name: 'executionType', required: false, enum: ExecutionType })
  @ApiQuery({ name: 'pipelineId', required: false, type: String })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'limit', required: true, type: Number, default: 20 })
  @ApiQuery({ name: 'offset', required: true, type: Number, default: 0 })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns list of executions',
    type: [ExecutionResponseDto],
  })
  async getExecutions(
    @Query('status') status?: ExecutionStatus,
    @Query('executionType') executionType?: ExecutionType,
    @Query('pipelineId') pipelineId?: string,
    @Query('projectId') projectId?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Request() req?: IRequestType,
  ): Promise<ExecutionResponseDto[]> {
    try {
      const executions = await this.logsService.getExecutions({
        userId: req?.user?.userId,
        status,
        executionType,
        pipelineId,
        projectId,
        limit: limit || 20,
        offset: offset || 0,
      });

      return executions.map((execution) =>
        this.mapToExecutionResponse(execution),
      );
    } catch (error) {
      console.error('Error fetching executions:', error);
      throw new InternalServerErrorException('Failed to fetch executions');
    }
  }

  @Get('executions/:id')
  @ApiOperation({ summary: 'Get execution details' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns execution details',
    type: ExecutionResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Execution not found',
  })
  async getExecutionById(
    @Param('id') id: string,
    @Request() req: IRequestType,
  ): Promise<ExecutionResponseDto> {
    try {
      if (!id || !id.match(/^[0-9a-f-]+$/i)) {
        throw new BadRequestException('Invalid execution ID format');
      }

      const execution = await this.logsService.getExecutionById(
        id,
        req.user.userId,
      );
      return this.mapToExecutionResponse(execution);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to fetch execution: ${error.message}`,
      );
    }
  }

  @Get('executions/:id/logs')
  @ApiOperation({ summary: 'Get execution logs' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns execution logs',
  })
  async getExecutionLogs(
    @Param('id') id: string,
    @Query() query: LogQueryDto,
    @Request() req: IRequestType,
  ): Promise<any> {
    const hasAccess = await this.logsService.checkAccess(req.user.userId, id);

    if (!hasAccess) {
      return {
        logs: [],
        message: 'Access denied to execution logs',
      };
    }

    const logs = await this.logsService.getExecutionLogs(id, {
      limit: query.limit || 100,
      offset: ((query.page || 1) - 1) * (query.limit || 100),
      level: query.level,
    });

    return {
      logs,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: logs.length,
      },
      filters: {
        level: query.level,
        keyword: query.keyword,
        source: query.source,
        sortOrder: query.sortOrder,
      },
    };
  }

  @Patch('executions/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update execution status' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Status updated successfully',
  })
  async updateExecutionStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Request() req: IRequestType,
  ): Promise<any> {
    const hasAccess = await this.logsService.checkAccess(req.user.userId, id);

    if (!hasAccess) {
      return {
        success: false,
        message: 'Access denied to update execution',
      };
    }

    await this.logsService.updateExecutionStatus(id, dto.status, {
      ...dto.metadata,
      errorMessage: dto.errorMessage,
      archiveUrl: dto.archiveUrl,
      completedAt: dto.completedAt,
    });

    return {
      success: true,
      message: `Execution status updated to ${dto.status}`,
    };
  }

  @Get('executions/:id/archive-url')
  @ApiOperation({ summary: 'Get S3 archive URL for completed execution' })
  @ApiParam({ name: 'id', description: 'Execution ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns S3 archive URL',
  })
  async getArchiveUrl(
    @Param('id') id: string,
    @Request() req: IRequestType,
  ): Promise<any> {
    const execution = await this.logsService.getExecutionById(
      id,
      req.user.userId,
    );

    if (!execution.isArchived || !execution.archiveUrl) {
      return {
        available: false,
        message: 'Archive not available for this execution',
      };
    }

    return {
      available: true,
      archiveUrl: execution.archiveUrl,
      archivedAt: execution.completedAt,
    };
  }

  private mapToExecutionResponse(execution: any): ExecutionResponseDto {
    return {
      executionId: execution.executionId,
      pipelineId: execution.pipelineId,
      projectId: execution.projectId,
      userId: execution.userId,
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
      logs: execution.logs,
      logCount: execution.logs?.length || 0,
    };
  }
}
