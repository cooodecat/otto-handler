import { Module } from '@nestjs/common';
import { DebugController } from './debug.controller';
import { AwsEcsService } from '../aws/aws-ecs.service';
import { AwsAlbService } from '../aws/aws-alb.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  controllers: [DebugController],
  providers: [AwsEcsService, AwsAlbService],
})
export class DebugModule {}
