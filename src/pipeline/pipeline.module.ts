import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';
import { Pipeline } from '../database/entities/pipeline.entity';
import { Project } from '../database/entities/project.entity';
import { User } from '../database/entities/user.entity';
import { Deployment } from '../database/entities/deployment.entity';
import { CodeBuildModule } from '../codebuild/codebuild.module';
import { DeploymentModule } from '../deployment/deployment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pipeline, Project, User, Deployment]),
    CodeBuildModule, // CodeBuild 모듈 추가
    DeploymentModule, // 배포 모듈 추가
  ],
  providers: [PipelineService],
  controllers: [PipelineController],
  exports: [PipelineService],
})
export class PipelineModule {}
