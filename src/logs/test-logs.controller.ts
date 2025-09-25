import { Controller, Post, Param, Body, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { LogsGateway } from './logs.gateway';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogsService } from './logs.service';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import {
  ExecutionType,
  ExecutionStatus,
} from '../database/entities/execution.entity';

interface LogEntry {
  executionId: string;
  timestamp: Date;
  message: string;
  level: string;
}

interface TestLogDto {
  message: string;
  level?: 'info' | 'warning' | 'error';
  phase?: string;
}

@ApiTags('test-logs')
@Controller('test-logs')
export class TestLogsController {
  private readonly logger = new Logger(TestLogsController.name);

  constructor(
    private readonly logsGateway: LogsGateway,
    private readonly logBuffer: LogBufferService,
    private readonly logsService: LogsService,
    private readonly logStorage: LogStorageService,
    private readonly cloudwatchService: CloudwatchService,
  ) {}

  @Post('executions/:id/log')
  @ApiOperation({ summary: 'Send test log to execution' })
  sendTestLog(
    @Param('id') executionId: string,
    @Body() dto: TestLogDto,
  ): Record<string, unknown> {
    const log = {
      executionId,
      timestamp: new Date(),
      message: dto.message,
      level: dto.level || 'info',
    };

    // Add to buffer (this will also trigger WebSocket broadcast via event emitter)
    this.logBuffer.addLogs(executionId, [log]);

    return {
      success: true,
      message: 'Test log sent',
      log,
    };
  }

  @Post('executions/:id/batch-logs')
  @ApiOperation({ summary: 'Send batch of test logs' })
  sendBatchLogs(
    @Param('id') executionId: string,
    @Body() dto: { count: number; delay?: number },
  ): Record<string, unknown> {
    const logs: LogEntry[] = [];
    const phases = ['BUILD', 'TEST', 'DEPLOY', 'COMPLETE'];
    const levels = ['info', 'warning', 'error'];

    for (let i = 0; i < dto.count; i++) {
      const log = {
        executionId,
        timestamp: new Date(Date.now() + i * (dto.delay || 100)),
        message: `Test log message ${i + 1}: Processing ${phases[i % phases.length]} phase`,
        level: levels[Math.floor(Math.random() * levels.length)],
      };

      logs.push(log);

      // Send logs with delay if specified
      if (dto.delay && dto.delay > 0) {
        const logCopy = { ...log };
        setTimeout(() => {
          // Add to buffer, which will trigger broadcast
          this.logBuffer.addLogs(executionId, [logCopy]);
        }, i * dto.delay);
      }
    }

    // If no delay, add all logs to buffer at once (this will trigger broadcast)
    if (!dto.delay || dto.delay === 0) {
      this.logBuffer.addLogs(executionId, logs);
    }

    return {
      success: true,
      message: `${dto.count} test logs sent`,
      count: dto.count,
    };
  }

  @Post('executions/:id/status')
  @ApiOperation({ summary: 'Update execution status' })
  updateStatus(
    @Param('id') executionId: string,
    @Body() dto: { status: string },
  ): Record<string, unknown> {
    this.logsGateway.broadcastStatusChange(executionId, dto.status);

    return {
      success: true,
      message: `Status updated to ${dto.status}`,
    };
  }

  @Get('executions/:id/buffer')
  @ApiOperation({ summary: 'Get buffered logs for execution' })
  getBufferedLogs(@Param('id') executionId: string): Record<string, unknown> {
    const logs = this.logBuffer.getRecentLogs(executionId);

    return {
      executionId,
      count: logs.length,
      logs,
    };
  }

  @Post('aws-codebuild/seed')
  @ApiOperation({ summary: 'Create AWS CodeBuild execution data' })
  async createAwsCodeBuildExecution(): Promise<any> {
    // AWS CodeBuild 정보
    const awsData = {
      projectName: 'otto-log-test',
      buildId: 'otto-log-test:a2d58a32-01d4-4436-902a-2eeab05ba739',
      logGroupName: '/aws/codebuild/otto-log-test',
      logStreamName: 'a2d58a32-01d4-4436-902a-2eeab05ba739',
      region: 'ap-northeast-2',
    };

    // Execution 생성
    const execution = await this.logsService.registerExecution({
      pipelineId: '580a79b9-a85c-4f49-97f6-11b382935119', // 예시 pipeline ID
      projectId: '580a79b9-a85c-4f49-97f6-11b382935118', // 실제 project ID
      userId: 'dev-user-001', // 개발용 사용자
      executionType: ExecutionType.BUILD,
      awsBuildId: awsData.buildId,
      logStreamName: `${awsData.logGroupName}/${awsData.logStreamName}`,
      metadata: {
        branch: 'main',
        commitId: 'abc123def',
        commitMessage: 'feat: AWS CodeBuild integration test',
        author: 'Otto CI',
        triggeredBy: 'manual',
        projectName: awsData.projectName,
        region: awsData.region,
      },
    });

    // 상태를 RUNNING으로 업데이트
    await this.logsService.updateExecutionStatus(
      execution.executionId,
      ExecutionStatus.RUNNING,
      { startedAt: new Date() },
    );

    return {
      success: true,
      message: 'AWS CodeBuild execution created',
      executionId: execution.executionId,
      awsData,
      note: 'CloudWatch logs will be fetched automatically if AWS credentials are configured',
    };
  }

  @Post('check-stale')
  @ApiOperation({ summary: 'Manually check and update stale executions' })
  @ApiResponse({
    status: 200,
    description: 'Returns the number of checked and updated executions',
  })
  async checkStaleExecutions(): Promise<{
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

  @Post('recover-logs/:executionId')
  @ApiOperation({ summary: 'Manually recover logs for a specific execution' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the number of recovered logs',
  })
  async recoverLogs(@Param('executionId') executionId: string): Promise<{
    success: boolean;
    logsRecovered: number;
    message: string;
  }> {
    try {
      // Get execution details
      const execution = await this.logsService.getExecutionById(
        executionId,
        undefined,
      );

      if (!execution) {
        return {
          success: false,
          logsRecovered: 0,
          message: 'Execution not found',
        };
      }

      // Check current log count
      const currentLogCount =
        await this.logStorage.getExecutionLogCount(executionId);

      if (currentLogCount > 0) {
        return {
          success: true,
          logsRecovered: currentLogCount,
          message: `Execution already has ${currentLogCount} logs`,
        };
      }

      // Try to recover from CloudWatch
      let recoveredCount = 0;

      if (execution.awsBuildId && execution.logStreamName) {
        // Get CloudWatch log group from project entity or determine from awsBuildId
        let logGroupName: string;
        let logStreamName: string = execution.logStreamName;

        // First, try to use the cloudwatchLogGroup from the project entity
        if (execution.project && execution.project.cloudwatchLogGroup) {
          logGroupName = execution.project.cloudwatchLogGroup;
        } else {
          // CloudWatch log group pattern:
          // Development: /aws/codebuild/otto/development/{userId}/{projectId}
          // Production: /aws/codebuild/otto/production/{userId}/{projectId}

          const nodeEnv = process.env.NODE_ENV || 'development';
          const environment =
            nodeEnv === 'production' ? 'production' : 'development';

          // Extract projectId and userId from execution
          let projectId = execution.projectId;
          const userId = execution.userId;

          if (!projectId && execution.awsBuildId) {
            // Try to extract from awsBuildId pattern: otto-{env}-{projectId}-build:{executionId}
            const match = execution.awsBuildId.match(
              /otto-\w+-([a-f0-9-]+)-build/,
            );
            if (match) {
              projectId = match[1];
            }
          }

          // Build the log group name
          // Pattern: /aws/codebuild/otto/{environment}/{userId}/{projectId}
          if (userId && projectId) {
            logGroupName = `/aws/codebuild/otto/${environment}/${userId}/${projectId}`;
            logStreamName = executionId;
          } else if (projectId) {
            // Fallback without userId (old pattern)
            logGroupName = `/aws/codebuild/otto/${environment}/${projectId}`;
            logStreamName = executionId;
          } else {
            // Ultimate fallback
            logGroupName = `/aws/codebuild/otto/${environment}`;
          }
        }

        this.logger.log(
          `Attempting to recover logs from CloudWatch:
          - Environment: ${process.env.NODE_ENV || 'development'}
          - Execution: ${executionId}
          - Project ID: ${execution.projectId}
          - AWS Build ID: ${execution.awsBuildId}
          - Log Group: ${logGroupName}
          - Log Stream: ${logStreamName}
          - Project CloudWatch Group: ${execution.project?.cloudwatchLogGroup || 'not set'}`,
        );

        try {
          recoveredCount = await this.cloudwatchService.fetchAndSaveAllLogs(
            executionId,
            logGroupName,
            logStreamName,
          );
        } catch (error) {
          this.logger.error(
            `Failed to recover logs for ${executionId}: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          );
          // Log full error for debugging
          if (error instanceof Error) {
            this.logger.error(`Full error: ${error.stack}`);
          }
        }
      }

      if (recoveredCount > 0) {
        // Update execution metadata to indicate logs were recovered
        await this.logsService.updateExecutionStatus(
          executionId,
          execution.status,
          {
            logsRecovered: true,
            logsRecoveredCount: recoveredCount,
            recoveredAt: new Date().toISOString(),
          },
        );
      }

      return {
        success: recoveredCount > 0,
        logsRecovered: recoveredCount,
        message:
          recoveredCount > 0
            ? `Successfully recovered ${recoveredCount} logs`
            : 'No logs could be recovered',
      };
    } catch (error) {
      this.logger.error(
        `Error recovering logs: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return {
        success: false,
        logsRecovered: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
