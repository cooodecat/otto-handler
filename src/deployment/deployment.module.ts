import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeploymentService } from './deployment.service';
import { Pipeline } from '../database/entities/pipeline.entity';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [TypeOrmModule.forFeature([Pipeline]), AwsModule],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
