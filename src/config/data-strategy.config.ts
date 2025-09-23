import { Injectable } from '@nestjs/common';
import { Execution } from '../database/entities/execution.entity';
import { ExecutionLog } from '../database/entities/execution-log.entity';
import { Repository } from 'typeorm';

export interface DataStrategy {
  fetchExecutionData(executionId: string): Promise<Execution>;
  fetchLogData(executionId: string): Promise<ExecutionLog[]>;
  fetchCloudWatchLogs(logGroup: string, logStream: string): Promise<any[]>;
  archiveExecution(executionId: string): Promise<string>;
}

@Injectable()
export class RealStrategy implements DataStrategy {
  constructor(
    private cloudwatchClient: unknown,
    private s3Client: unknown,
    private executionRepository: Repository<Execution>,
    private logRepository: Repository<ExecutionLog>,
  ) {}

  async fetchExecutionData(executionId: string): Promise<Execution> {
    const execution = await this.executionRepository.findOne({
      where: { executionId },
      relations: ['logs', 'project', 'pipeline'],
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    return execution;
  }

  async fetchLogData(executionId: string): Promise<ExecutionLog[]> {
    return this.logRepository.find({
      where: { executionId },
      order: { timestamp: 'ASC' },
    });
  }

  fetchCloudWatchLogs(): Promise<any[]> {
    // Real CloudWatch implementation would go here
    // This would use the actual AWS SDK
    // const response = await this.cloudwatchClient.send(new GetLogEventsCommand(params));
    // return response.events || [];

    throw new Error('Real CloudWatch integration not implemented yet');
  }

  archiveExecution(executionId: string): Promise<string> {
    // Real S3 archive implementation would go here
    const bucketName = process.env.S3_BUCKET_NAME || 'otto-logs';
    const key = `archives/${executionId}/logs-${Date.now()}.tar.gz`;

    // This would use the actual AWS SDK to upload
    // await this.s3Client.send(new PutObjectCommand({ ... }));

    return Promise.resolve(`s3://${bucketName}/${key}`);
  }
}

@Injectable()
export class DataStrategyFactory {
  createStrategy(
    executionRepository: Repository<Execution>,
    logRepository: Repository<ExecutionLog>,
    cloudwatchClient: unknown,
    s3Client: unknown,
  ): DataStrategy {
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
