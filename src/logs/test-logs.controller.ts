import { Controller, Post, Param, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { LogsGateway } from './logs.gateway';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogsService } from './logs.service';
import {
  ExecutionType,
  ExecutionStatus,
} from '../database/entities/execution.entity';

interface TestLogDto {
  message: string;
  level?: 'info' | 'warning' | 'error';
  phase?: string;
}

@ApiTags('test-logs')
@Controller('test-logs')
export class TestLogsController {
  constructor(
    private readonly logsGateway: LogsGateway,
    private readonly logBuffer: LogBufferService,
    private readonly logsService: LogsService,
  ) {}

  @Post('executions/:id/log')
  @ApiOperation({ summary: 'Send test log to execution' })
  async sendTestLog(
    @Param('id') executionId: string,
    @Body() dto: TestLogDto,
  ): Promise<any> {
    const log = {
      executionId,
      timestamp: new Date(),
      message: dto.message,
      level: dto.level || 'info',
    };

    // Add to buffer
    this.logBuffer.addLogs(executionId, [log]);

    // Broadcast to connected clients
    this.logsGateway.broadcastLogs(executionId, [log]);

    return {
      success: true,
      message: 'Test log sent',
      log,
    };
  }

  @Post('executions/:id/batch-logs')
  @ApiOperation({ summary: 'Send batch of test logs' })
  async sendBatchLogs(
    @Param('id') executionId: string,
    @Body() dto: { count: number; delay?: number },
  ): Promise<any> {
    const logs: any[] = [];
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
          this.logsGateway.broadcastLogs(executionId, [logCopy]);
        }, i * dto.delay);
      }
    }

    // Add all logs to buffer
    this.logBuffer.addLogs(executionId, logs);

    // If no delay, send all at once
    if (!dto.delay || dto.delay === 0) {
      this.logsGateway.broadcastLogs(executionId, logs);
    }

    return {
      success: true,
      message: `${dto.count} test logs sent`,
      count: dto.count,
    };
  }

  @Post('executions/:id/status')
  @ApiOperation({ summary: 'Update execution status' })
  async updateStatus(
    @Param('id') executionId: string,
    @Body() dto: { status: string },
  ): Promise<any> {
    this.logsGateway.broadcastStatusChange(executionId, dto.status);

    return {
      success: true,
      message: `Status updated to ${dto.status}`,
    };
  }

  @Get('executions/:id/buffer')
  @ApiOperation({ summary: 'Get buffered logs for execution' })
  async getBufferedLogs(@Param('id') executionId: string): Promise<any> {
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
}
