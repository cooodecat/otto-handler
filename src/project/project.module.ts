import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { Project } from '../database/entities/project.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { User } from '../database/entities/user.entity';
import { JwtService } from '../auth/jwt.service';
import { CodeBuildModule } from '../codebuild/codebuild.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, Pipeline, User]),
    CodeBuildModule, // CodeBuild 모듈 추가
  ],
  controllers: [ProjectController],
  providers: [ProjectService, JwtService],
  exports: [ProjectService],
})
export class ProjectModule {}
