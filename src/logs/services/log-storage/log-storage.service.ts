import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ExecutionLog, LogLevel } from '../../../database/entities/execution-log.entity';
import { Execution } from '../../../database/entities/execution.entity';

interface LogEvent {
  executionId: string;
  timestamp: Date;
  message: string;
  level: LogLevel;
}

@Injectable()
export class LogStorageService {
  private readonly logger = new Logger(LogStorageService.name);

  constructor(
    @InjectRepository(ExecutionLog)
    private readonly executionLogRepository: Repository<ExecutionLog>,
    @InjectRepository(Execution)
    private readonly executionRepository: Repository<Execution>,
    private readonly dataSource: DataSource,
  ) {}

  async saveLogs(logs: LogEvent[]): Promise<void> {
    if (!logs || logs.length === 0) {
      return;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const executionLogs = logs.map(log => {
        const executionLog = new ExecutionLog();
        executionLog.executionId = log.executionId;
        executionLog.timestamp = log.timestamp;
        executionLog.message = log.message;
        executionLog.level = log.level;
        return executionLog;
      });

      await queryRunner.manager.save(ExecutionLog, executionLogs);
      await queryRunner.commitTransaction();
      
      this.logger.debug(`Saved ${logs.length} logs to database`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to save logs: ${error.message}`, error.stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getExecutionLogs(
    executionId: string,
    limit?: number,
    offset?: number,
  ): Promise<ExecutionLog[]> {
    const queryBuilder = this.executionLogRepository
      .createQueryBuilder('log')
      .where('log.executionId = :executionId', { executionId })
      .orderBy('log.timestamp', 'ASC');

    if (offset) {
      queryBuilder.skip(offset);
    }

    if (limit) {
      queryBuilder.take(limit);
    }

    return queryBuilder.getMany();
  }

  async getExecutionLogCount(executionId: string): Promise<number> {
    return this.executionLogRepository.count({
      where: { executionId },
    });
  }

  async getLatestLog(executionId: string): Promise<ExecutionLog | null> {
    return this.executionLogRepository.findOne({
      where: { executionId },
      order: { timestamp: 'DESC' },
    });
  }

  async deleteExecutionLogs(executionId: string): Promise<void> {
    const result = await this.executionLogRepository.delete({ executionId });
    this.logger.log(`Deleted ${result.affected} logs for execution ${executionId}`);
  }

  async deleteOldLogs(daysToKeep: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.executionLogRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(`Deleted ${result.affected} logs older than ${daysToKeep} days`);
    return result.affected || 0;
  }

  async getLogsByLevel(
    executionId: string,
    level: LogLevel,
  ): Promise<ExecutionLog[]> {
    return this.executionLogRepository.find({
      where: { executionId, level },
      order: { timestamp: 'ASC' },
    });
  }

  async hasErrors(executionId: string): Promise<boolean> {
    const count = await this.executionLogRepository.count({
      where: { executionId, level: LogLevel.ERROR },
    });
    return count > 0;
  }

  async updateExecutionStatus(
    executionId: string,
    status: 'success' | 'failed',
    completedAt?: Date,
  ): Promise<void> {
    const executionStatus = status === 'success' ? 'success' : 'failed';
    await this.executionRepository.update(
      { executionId },
      {
        status: executionStatus as any,
        completedAt: completedAt || new Date(),
      },
    );
    this.logger.log(`Updated execution ${executionId} status to ${status}`);
  }
}