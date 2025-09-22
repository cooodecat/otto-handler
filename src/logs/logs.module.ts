import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';
import { Execution } from '../database/entities/execution.entity';
import { ExecutionLog } from '../database/entities/execution-log.entity';
import { ExecutionArchive } from '../database/entities/execution-archive.entity';
import { Project } from '../database/entities/project.entity';
import { User } from '../database/entities/user.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { LogsGateway } from './logs.gateway';
import { JwtService } from '../auth/jwt.service';
import { TestLogsController } from './test-logs.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Execution,
      ExecutionLog,
      ExecutionArchive,
      Project,
      User,
      Pipeline,
    ]),
  ],
  controllers: [LogsController, TestLogsController],
  providers: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
    LogsGateway,
    JwtService,
  ],
  exports: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
  ],
})
export class LogsModule {}
