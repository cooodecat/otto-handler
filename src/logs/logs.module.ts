import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { LogsService } from './logs.service';
import { Execution } from '../database/entities/execution.entity';
import { ExecutionLog } from '../database/entities/execution-log.entity';
import { ExecutionArchive } from '../database/entities/execution-archive.entity';
import { Project } from '../database/entities/project.entity';
import { User } from '../database/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Execution,
      ExecutionLog,
      ExecutionArchive,
      Project,
      User,
    ]),
  ],
  providers: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
  ],
  exports: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
  ],
})
export class LogsModule {}