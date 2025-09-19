import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GithubAppController } from './github-app.controller';
import { GithubAppService } from './github-app.service';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookService } from './github-webhook.service';
import { Project } from '../database/entities/project.entity';
import { GithubApp } from '../database/entities/github-app.entity';
import { User } from '../database/entities/user.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Project, GithubApp, User])],
  controllers: [GithubAppController, GithubWebhookController],
  providers: [GithubAppService, GithubWebhookService],
  exports: [GithubAppService, GithubWebhookService],
})
export class GithubAppModule {}
