import { Module } from '@nestjs/common';
import { CodeBuildService } from './codebuild.service';
import { BuildSpecGeneratorService } from './buildspec-generator.service';
import { ECRService } from './ecr.service';
import { EventBridgeService } from './eventbridge.service';
import { CloudWatchLogsService } from './cloudwatch-logs.service';

@Module({
  providers: [
    CodeBuildService,
    BuildSpecGeneratorService,
    ECRService,
    EventBridgeService,
    CloudWatchLogsService,
  ],
  exports: [
    CodeBuildService,
    BuildSpecGeneratorService,
    ECRService,
    EventBridgeService,
  ],
})
export class CodeBuildModule {}
