import {
  Controller,
  Headers,
  HttpCode,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GithubWebhookService } from './github-webhook.service';
import { TypedBody, TypedRoute } from '@nestia/core';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { GitHubWebhookPayload } from './dtos';

@Controller('/webhook/github')
export class GithubWebhookController {
  private readonly logger = new Logger(GithubWebhookController.name);

  constructor(
    private readonly githubWebhookService: GithubWebhookService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * @tag github-webhook
   * @internal
   * @summary GitHub App 웹훅 이벤트 수신
   * @description GitHub App에서 자동으로 전송되는 웹훅 이벤트를 처리합니다
   */
  @HttpCode(200)
  @TypedRoute.Post('/')
  async handleGitHubWebhook(
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-hub-signature-256') signature: string,
    @TypedBody() payload: GitHubWebhookPayload,
  ): Promise<{ message: string }> {
    this.logger.log(`Received GitHub webhook: ${eventType} - ${deliveryId}`);

    // 디버깅용 상세 로그 (installation 관련 이벤트)
    if (
      eventType === 'installation' ||
      eventType === 'installation_repositories'
    ) {
      this.logger.log(`[Webhook Debug] Installation event details:`, {
        action: payload.action,
        installation_id: payload.installation?.id,
        account: payload.installation?.account?.login,
        account_type: payload.installation?.account?.type,
        account_id: payload.installation?.account?.id,
        sender: payload.sender?.login,
        sender_id: payload.sender?.id,
      });
    }

    // 1. 시그니처 검증
    if (!this.verifyWebhookSignature(JSON.stringify(payload), signature)) {
      this.logger.error(
        `[Webhook Error] Signature verification failed for ${eventType} event`,
      );
      throw new BadRequestException('Invalid webhook signature');
    }

    // 2. 이벤트 타입별 처리
    try {
      switch (eventType) {
        case 'push':
          await this.githubWebhookService.handlePushEvent(payload);
          break;

        case 'create':
          if (payload.ref && !payload.ref.startsWith('refs/tags/')) {
            // 브랜치 생성 이벤트
            this.githubWebhookService.handleBranchCreateEvent(payload);
          }
          break;

        case 'delete':
          if (payload.ref && !payload.ref.startsWith('refs/tags/')) {
            // 브랜치 삭제 이벤트
            await this.githubWebhookService.handleBranchDeleteEvent(payload);
          }
          break;

        case 'pull_request':
          await this.githubWebhookService.handlePullRequestEvent(payload);
          break;

        case 'installation':
          this.logger.log(
            `Installation event: ${payload.action} for account ${payload.installation?.account?.login} (ID: ${payload.installation?.id})`,
          );
          await this.githubWebhookService.handleInstallationEvent(payload);
          break;

        case 'installation_repositories':
          this.logger.log(
            `Installation repositories event: ${payload.action} for installation ${payload.installation?.id}`,
          );
          await this.githubWebhookService.handleInstallationRepositoriesEvent(
            payload,
          );
          break;

        default:
          this.logger.debug(`Unhandled GitHub webhook event: ${eventType}`);
      }

      return { message: `GitHub webhook ${eventType} processed successfully` };
    } catch (error) {
      this.logger.error(
        `Failed to process GitHub webhook ${eventType}:`,
        error,
      );
      throw new BadRequestException(
        `Failed to process webhook: ${(error as Error).message}`,
      );
    }
  }

  private verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('GitHub webhook secret not configured');
      return false;
    }

    const expectedSignature =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature || ''),
    );
  }
}
