import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Execution,
  ExecutionStatus,
} from '../database/entities/execution.entity';
import { ExecutionLog } from '../database/entities/execution-log.entity';

export interface DataStrategy {
  fetchExecutionData(executionId: string): Promise<Execution>;
  fetchLogData(executionId: string): Promise<ExecutionLog[]>;
  fetchCloudWatchLogs(logGroup: string, logStream: string): Promise<any[]>;
  archiveExecution(executionId: string): Promise<string>;
}

@Injectable()
export class MockStrategy implements DataStrategy {
  async fetchExecutionData(executionId: string): Promise<Execution> {
    const mockExecution = new Execution();
    mockExecution.executionId = executionId;
    mockExecution.status = ExecutionStatus.SUCCESS;
    mockExecution.startedAt = new Date();
    mockExecution.completedAt = new Date();
    mockExecution.metadata = {
      source: 'mock',
      environment: 'test',
    };
    return mockExecution;
  }

  async fetchLogData(executionId: string): Promise<ExecutionLog[]> {
    const mockExecution = new Execution();
    mockExecution.executionId = executionId;

    return [
      {
        id: 1,
        executionId,
        timestamp: new Date(),
        message: '[MOCK] Test log entry 1',
        level: 'info' as any,
        metadata: { source: 'mock' },
        createdAt: new Date(),
        execution: mockExecution,
      },
      {
        id: 2,
        executionId,
        timestamp: new Date(),
        message: '[MOCK] Test log entry 2',
        level: 'warning' as any,
        metadata: { source: 'mock' },
        createdAt: new Date(),
        execution: mockExecution,
      },
    ];
  }

  async fetchCloudWatchLogs(
    logGroup: string,
    logStream: string,
  ): Promise<any[]> {
    return [
      {
        timestamp: Date.now(),
        message: `[MOCK] CloudWatch log from ${logGroup}/${logStream}`,
        ingestionTime: Date.now(),
      },
    ];
  }

  async archiveExecution(executionId: string): Promise<string> {
    return `mock://archive/${executionId}/logs.tar.gz`;
  }
}

@Injectable()
export class SeededStrategy implements DataStrategy {
  constructor(
    private executionRepository: any,
    private logRepository: any,
  ) {}

  async fetchExecutionData(executionId: string): Promise<Execution> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
      relations: ['logs'],
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found in seeded data`);
    }

    return execution;
  }

  async fetchLogData(executionId: string): Promise<ExecutionLog[]> {
    return this.logRepository.find({
      where: { executionId },
      order: { timestamp: 'ASC' },
    });
  }

  async fetchCloudWatchLogs(
    logGroup: string,
    logStream: string,
  ): Promise<any[]> {
    // Return simulated CloudWatch logs from seeded data
    return [
      {
        timestamp: Date.now(),
        message: `[SEEDED] Simulated CloudWatch log from ${logGroup}/${logStream}`,
        ingestionTime: Date.now(),
      },
    ];
  }

  async archiveExecution(executionId: string): Promise<string> {
    // Simulate S3 archive URL for seeded data
    return `s3://seeded-bucket/${executionId}/archive.tar.gz`;
  }
}

@Injectable()
export class RealStrategy implements DataStrategy {
  constructor(
    private cloudwatchClient: any,
    private s3Client: any,
    private executionRepository: any,
    private logRepository: any,
  ) {}

  async fetchExecutionData(executionId: string): Promise<Execution> {
    return this.executionRepository.findOne({
      where: { executionId },
      relations: ['logs', 'project', 'pipeline'],
    });
  }

  async fetchLogData(executionId: string): Promise<ExecutionLog[]> {
    return this.logRepository.find({
      where: { executionId },
      order: { timestamp: 'ASC' },
    });
  }

  async fetchCloudWatchLogs(
    logGroup: string,
    logStream: string,
  ): Promise<any[]> {
    // Real CloudWatch implementation would go here
    const params = {
      logGroupName: logGroup,
      logStreamName: logStream,
      startFromHead: true,
    };

    // This would use the actual AWS SDK
    // const response = await this.cloudwatchClient.send(new GetLogEventsCommand(params));
    // return response.events || [];

    throw new Error('Real CloudWatch integration not implemented yet');
  }

  async archiveExecution(executionId: string): Promise<string> {
    // Real S3 archive implementation would go here
    const bucketName = process.env.S3_BUCKET_NAME || 'otto-logs';
    const key = `archives/${executionId}/logs-${Date.now()}.tar.gz`;

    // This would use the actual AWS SDK to upload
    // await this.s3Client.send(new PutObjectCommand({ ... }));

    return `s3://${bucketName}/${key}`;
  }
}

@Injectable()
export class DataStrategyFactory {
  constructor(private configService: ConfigService) {}

  createStrategy(
    executionRepository?: any,
    logRepository?: any,
    cloudwatchClient?: any,
    s3Client?: any,
  ): DataStrategy {
    const useMockData = this.configService.get<boolean>('USE_MOCK_DATA', false);
    const useSeededData = this.configService.get<boolean>(
      'USE_SEEDED_DATA',
      false,
    );

    if (useMockData) {
      return new MockStrategy();
    }

    if (useSeededData) {
      if (!executionRepository || !logRepository) {
        throw new Error('Repositories required for SeededStrategy');
      }
      return new SeededStrategy(executionRepository, logRepository);
    }

    // Default to real strategy
    if (
      !cloudwatchClient ||
      !s3Client ||
      !executionRepository ||
      !logRepository
    ) {
      throw new Error('All clients and repositories required for RealStrategy');
    }

    return new RealStrategy(
      cloudwatchClient,
      s3Client,
      executionRepository,
      logRepository,
    );
  }
}
