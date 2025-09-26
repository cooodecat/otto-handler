import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploymentService } from './deployment.service';
import { HealthCheckService } from './health-check.service';
import { DeploymentTrackerService } from './deployment-tracker.service';
import { DeploymentEventBridgeService } from './deployment-eventbridge.service';
import { DeploymentEventsService } from './deployment-events.service';
import { PipelineCleanupService } from './pipeline-cleanup.service';
import { Pipeline } from '../database/entities/pipeline.entity';
import { Deployment } from '../database/entities/deployment.entity';
import { Execution } from '../database/entities/execution.entity';
import { AwsModule } from '../aws/aws.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pipeline, Deployment, Execution]),
    AwsModule,
    LogsModule, // WebSocket 브로드캐스팅용
  ],
  providers: [
    DeploymentService,
    HealthCheckService,
    DeploymentTrackerService,
    DeploymentEventBridgeService,
    DeploymentEventsService,
    PipelineCleanupService,
  ],
  exports: [
    DeploymentService,
    HealthCheckService,
    DeploymentTrackerService,
    DeploymentEventsService, // 다른 모듈에서 이벤트 처리용
    PipelineCleanupService, // 파이프라인 모듈에서 사용
  ],
})
export class DeploymentModule {}
