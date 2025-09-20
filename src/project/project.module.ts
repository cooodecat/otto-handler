import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ProjectService } from './project.service';
import { ProjectController } from './project.controller';
import { Project } from '../database/entities/project.entity';
import { User } from '../database/entities/user.entity';
import { JwtService } from '../auth/jwt.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, User])],
  controllers: [ProjectController],
  providers: [ProjectService, JwtService],
  exports: [ProjectService],
})
export class ProjectModule {}
