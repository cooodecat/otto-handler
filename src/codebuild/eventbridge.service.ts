import { Injectable, Logger } from '@nestjs/common';
import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import {
  LambdaClient,
  AddPermissionCommand,
  RemovePermissionCommand,
} from '@aws-sdk/client-lambda';

@Injectable()
export class EventBridgeService {
  private readonly logger = new Logger(EventBridgeService.name);
  private readonly client: EventBridgeClient;
  private readonly lambdaClient: LambdaClient;
  private readonly region: string;

  constructor() {
    this.region = process.env.AWS_REGION || 'ap-northeast-2';
    const credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    };

    this.client = new EventBridgeClient({
      region: this.region,
      credentials,
    });

    this.lambdaClient = new LambdaClient({
      region: this.region,
      credentials,
    });
  }

  /**
   * CodeBuild 프로젝트용 EventBridge Rule 생성
   */
  async createCodeBuildEventRule(
    codebuildProjectName: string,
  ): Promise<string> {
    // EventBridge Rule 이름은 64자 제한
    // codebuildProjectName이 otto-development-{uuid}-build 또는 otto-production-{uuid}-build 형태
    // UUID 부분만 추출하여 사용
    const parts = codebuildProjectName.split('-');
    const projectId = parts[parts.length - 2]; // UUID 부분 추출
    const environment = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    const ruleName = `otto-${environment}-${projectId}`;

    try {
      // 1. EventBridge Rule 생성
      await this.client.send(
        new PutRuleCommand({
          Name: ruleName,
          Description: `Otto CodeBuild events for project ${codebuildProjectName}`,
          EventPattern: JSON.stringify({
            source: ['aws.codebuild'],
            'detail-type': [
              'CodeBuild Build State Change',
              'CodeBuild Build Phase Change',
            ],
            detail: {
              'project-name': [codebuildProjectName],
            },
          }),
          State: 'ENABLED',
        }),
      );

      this.logger.log(`EventBridge rule created: ${ruleName}`);

      // 2. Lambda 함수를 타겟으로 추가
      const lambdaArn = process.env.OTTO_LAMBDA_ARN;

      if (!lambdaArn) {
        this.logger.warn(
          'OTTO_LAMBDA_ARN not configured, skipping Lambda target',
        );
        return ruleName;
      }

      await this.client.send(
        new PutTargetsCommand({
          Rule: ruleName,
          Targets: [
            {
              Arn: lambdaArn,
              Id: '1',
              RetryPolicy: {
                MaximumRetryAttempts: 2,
                MaximumEventAgeInSeconds: 3600, // 1 hour
              },
            },
          ],
        }),
      );

      this.logger.log(`Lambda target added to rule: ${ruleName}`);

      // 3. Lambda에 EventBridge 호출 권한 추가
      const statementId = `${ruleName}-permission`;

      try {
        await this.lambdaClient.send(
          new AddPermissionCommand({
            FunctionName: lambdaArn.split(':').pop(), // Lambda 함수 이름 추출
            StatementId: statementId,
            Action: 'lambda:InvokeFunction',
            Principal: 'events.amazonaws.com',
            SourceArn: `arn:aws:events:${this.region}:${lambdaArn.split(':')[4]}:rule/${ruleName}`,
          }),
        );
        this.logger.log(`Lambda permission added for rule: ${ruleName}`);
      } catch (permissionError: unknown) {
        const errorObj = permissionError as { name?: string; message?: string };
        // 이미 존재하는 권한은 무시
        if (errorObj.name !== 'ResourceConflictException') {
          this.logger.error(
            `Failed to add Lambda permission: ${errorObj.message || 'Unknown error'}`,
          );
          // Permission 추가 실패 시 Rule과 Target 롤백
          await this.deleteRuleByName(ruleName);
          throw new Error(
            `Lambda 권한 추가 실패: ${errorObj.message || 'Unknown error'}`,
          );
        }
        this.logger.log(
          `Lambda permission already exists for rule: ${ruleName}`,
        );
      }
      return ruleName;
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      this.logger.error(
        `Failed to create EventBridge rule: ${errorObj.message || 'Unknown error'}`,
      );
      throw new Error(
        `EventBridge Rule 생성 실패: ${errorObj.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * EventBridge Rule 삭제 (프로젝트 삭제 시)
   */
  async deleteCodeBuildEventRule(codebuildProjectName: string): Promise<void> {
    // 생성 시와 동일한 로직으로 Rule 이름 생성
    const parts = codebuildProjectName.split('-');
    const projectId = parts[parts.length - 2];
    const environment = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    const ruleName = `otto-${environment}-${projectId}`;

    try {
      // 1. 먼저 타겟 제거
      try {
        await this.client.send(
          new RemoveTargetsCommand({
            Rule: ruleName,
            Ids: ['1'],
          }),
        );
        this.logger.log(`Targets removed from rule: ${ruleName}`);
      } catch (error: unknown) {
        // 타겟이 없는 경우는 무시
        const errorObj = error as { name?: string; message?: string };
        if (errorObj.name !== 'ResourceNotFoundException') {
          this.logger.warn(
            `Failed to remove targets: ${errorObj.message || 'Unknown error'}`,
          );
        }
      }

      // 2. Lambda 권한 제거
      const lambdaArn = process.env.OTTO_LAMBDA_ARN;
      if (lambdaArn) {
        const statementId = `${ruleName}-permission`;
        try {
          await this.lambdaClient.send(
            new RemovePermissionCommand({
              FunctionName: lambdaArn.split(':').pop(), // Lambda 함수 이름 추출
              StatementId: statementId,
            }),
          );
          this.logger.log(`Lambda permission removed for rule: ${ruleName}`);
        } catch (permissionError: unknown) {
          const errorObj = permissionError as {
            name?: string;
            message?: string;
          };
          // 권한이 없는 경우는 무시
          if (errorObj.name !== 'ResourceNotFoundException') {
            this.logger.warn(
              `Failed to remove Lambda permission: ${errorObj.message || 'Unknown error'}`,
            );
          }
        }
      }

      // 3. Rule 삭제
      await this.client.send(
        new DeleteRuleCommand({
          Name: ruleName,
        }),
      );

      this.logger.log(`EventBridge rule deleted: ${ruleName}`);
    } catch (error: unknown) {
      // Rule이 없는 경우는 무시
      const errorObj = error as { name?: string; message?: string };
      if (errorObj.name !== 'ResourceNotFoundException') {
        this.logger.error(
          `Failed to delete EventBridge rule: ${errorObj.message || 'Unknown error'}`,
        );
        throw error;
      }
    }
  }

  /**
   * Rule 이름으로 EventBridge Rule 삭제 (롤백용)
   */
  async deleteRuleByName(ruleName: string): Promise<void> {
    try {
      // 1. 먼저 타겟 제거
      try {
        await this.client.send(
          new RemoveTargetsCommand({
            Rule: ruleName,
            Ids: ['1'],
          }),
        );
      } catch (error: unknown) {
        // 타겟이 없는 경우는 무시
        const errorObj = error as { name?: string; message?: string };
        if (errorObj.name !== 'ResourceNotFoundException') {
          this.logger.warn(
            `Failed to remove targets from ${ruleName}: ${errorObj.message || 'Unknown error'}`,
          );
        }
      }

      // 2. Lambda 권한 제거
      const lambdaArn = process.env.OTTO_LAMBDA_ARN;
      if (lambdaArn) {
        const statementId = `${ruleName}-permission`;
        try {
          await this.lambdaClient.send(
            new RemovePermissionCommand({
              FunctionName: lambdaArn.split(':').pop(), // Lambda 함수 이름 추출
              StatementId: statementId,
            }),
          );
          this.logger.log(`Lambda permission removed for rule: ${ruleName}`);
        } catch (permissionError: unknown) {
          const errorObj = permissionError as {
            name?: string;
            message?: string;
          };
          // 권한이 없는 경우는 무시
          if (errorObj.name !== 'ResourceNotFoundException') {
            this.logger.warn(
              `Failed to remove Lambda permission: ${errorObj.message || 'Unknown error'}`,
            );
          }
        }
      }

      // 3. Rule 삭제
      await this.client.send(
        new DeleteRuleCommand({
          Name: ruleName,
        }),
      );

      this.logger.log(`EventBridge rule deleted: ${ruleName}`);
    } catch (error: unknown) {
      const errorObj = error as { name?: string; message?: string };
      if (errorObj.name !== 'ResourceNotFoundException') {
        this.logger.error(
          `Failed to delete EventBridge rule ${ruleName}: ${errorObj.message || 'Unknown error'}`,
        );
        throw error;
      }
    }
  }
}
