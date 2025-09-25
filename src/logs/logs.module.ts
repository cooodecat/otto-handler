import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';
import { EventBridgeController } from './eventbridge.controller';
import { EventBridgeService } from './eventbridge.service';
import { Execution } from '../database/entities/execution.entity';
import { ExecutionLog } from '../database/entities/execution-log.entity';
import { ExecutionArchive } from '../database/entities/execution-archive.entity';
import { Project } from '../database/entities/project.entity';
import { User } from '../database/entities/user.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { LogsGateway } from './logs.gateway';
import { JwtService } from '../auth/jwt.service';
import { TestLogsController } from './test-logs.controller';
import { RedisModule } from '../common/redis/redis.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { CodeBuildModule } from '../codebuild/codebuild.module';

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
    RedisModule,
    forwardRef(() => PipelineModule),
    forwardRef(() => CodeBuildModule),
  ],
  controllers: [LogsController, TestLogsController, EventBridgeController],
  providers: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
    LogsGateway,
    JwtService,
    EventBridgeService,
  ],
  exports: [
    CloudwatchService,
    LogBufferService,
    LogStorageService,
    LogsService,
    EventBridgeService,
  ],
})
export class LogsModule {}
