import { Injectable, Logger } from '@nestjs/common';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';

@Injectable()
export class CloudWatchLogsService {
  private readonly logger = new Logger(CloudWatchLogsService.name);
  private readonly client: CloudWatchLogsClient;

  constructor() {
    const region = process.env.AWS_REGION || 'ap-northeast-2';

    this.client = new CloudWatchLogsClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * CloudWatch 로그 그룹 생성
   */
  async createLogGroup(
    logGroupName: string,
    retentionInDays: number = 7,
  ): Promise<void> {
    try {
      // 1. 로그 그룹 생성
      await this.client.send(
        new CreateLogGroupCommand({
          logGroupName,
        }),
      );

      this.logger.log(`CloudWatch log group created: ${logGroupName}`);

      // 2. 보존 정책 설정 (선택적)
      if (retentionInDays > 0) {
        await this.client.send(
          new PutRetentionPolicyCommand({
            logGroupName,
            retentionInDays,
          }),
        );
        this.logger.log(
          `Retention policy set to ${retentionInDays} days for ${logGroupName}`,
        );
      }
    } catch (error) {
      // 이미 존재하는 경우는 무시
      if (
        error instanceof ResourceAlreadyExistsException ||
        error.name === 'ResourceAlreadyExistsException'
      ) {
        this.logger.log(`Log group already exists: ${logGroupName}`);
        return;
      }

      this.logger.error(`Failed to create log group: ${error.message}`);
      throw new Error(`CloudWatch 로그 그룹 생성 실패: ${error.message}`);
    }
  }

  /**
   * CloudWatch 로그 그룹 삭제 (롤백/정리용)
   */
  async deleteLogGroup(logGroupName: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteLogGroupCommand({
          logGroupName,
        }),
      );

      this.logger.log(`CloudWatch log group deleted: ${logGroupName}`);
    } catch (error) {
      // 존재하지 않는 경우는 무시
      if (error.name === 'ResourceNotFoundException') {
        this.logger.warn(`Log group not found for deletion: ${logGroupName}`);
        return;
      }

      this.logger.error(`Failed to delete log group: ${error.message}`);
      throw error;
    }
  }
}
