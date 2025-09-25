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
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeploymentEventBridgeService {
  private readonly logger = new Logger(DeploymentEventBridgeService.name);
  private readonly client: EventBridgeClient;
  private readonly lambdaClient: LambdaClient;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = this.configService.get<string>(
      'AWS_REGION',
      'ap-northeast-2',
    );
    const credentials = {
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY')!,
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
   * ECS 서비스 배포 이벤트를 위한 EventBridge Rule 생성
   */
  async createDeploymentEventRule(config: {
    serviceName: string;
    clusterName: string;
    deploymentId: string;
  }): Promise<string> {
    const environment = this.configService.get<string>(
      'NODE_ENV',
      'development',
    );
    const ruleName = `otto-deploy-${environment}-${config.deploymentId}`;

    try {
      this.logger.log(
        `Creating deployment EventBridge rule: ${ruleName} for service: ${config.serviceName}`,
      );

      // 1. ECS 서비스 및 태스크 상태 변경 이벤트를 감지하는 EventBridge Rule 생성
      await this.client.send(
        new PutRuleCommand({
          Name: ruleName,
          Description: `Otto deployment events for service ${config.serviceName}`,
          EventPattern: JSON.stringify({
            source: ['aws.ecs'],
            'detail-type': [
              'ECS Service State Change',
              'ECS Task State Change',
            ],
            detail: {
              clusterArn: [
                {
                  suffix: `:cluster/${config.clusterName}`,
                },
              ],
              $or: [
                // ECS Service State Change 이벤트
                {
                  serviceName: [config.serviceName],
                },
                // ECS Task State Change 이벤트 (해당 서비스의 태스크만)
                {
                  group: [`service:${config.serviceName}`],
                },
              ],
            },
          }),
          State: 'ENABLED',
        }),
      );

      this.logger.log(`ECS EventBridge rule created: ${ruleName}`);

      // 2. Lambda 함수를 타겟으로 추가
      const lambdaArn = this.configService.get<string>('OTTO_LAMBDA_ARN');

      if (!lambdaArn) {
        this.logger.warn(
          'OTTO_LAMBDA_ARN not configured, skipping Lambda target for deployment events',
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
                MaximumEventAgeInSeconds: 3600,
              },
            },
          ],
        }),
      );

      this.logger.log(`Lambda target added to deployment rule: ${ruleName}`);

      // 3. Lambda에 EventBridge 호출 권한 추가
      await this.addLambdaPermission(ruleName, lambdaArn);

      return ruleName;
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      this.logger.error(
        `Failed to create deployment EventBridge rule: ${errorObj.message || 'Unknown error'}`,
      );
      throw new Error(
        `Deployment EventBridge Rule 생성 실패: ${errorObj.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * ALB Target Health 이벤트를 위한 EventBridge Rule 생성
   */
  async createTargetHealthEventRule(config: {
    targetGroupArn: string;
    deploymentId: string;
  }): Promise<string> {
    const environment = this.configService.get<string>(
      'NODE_ENV',
      'development',
    );
    const ruleName = `otto-health-${environment}-${config.deploymentId}`;

    try {
      this.logger.log(`Creating target health EventBridge rule: ${ruleName}`);

      // ALB Target Health 상태 변경 이벤트를 감지하는 EventBridge Rule 생성
      await this.client.send(
        new PutRuleCommand({
          Name: ruleName,
          Description: `Otto target health events for deployment ${config.deploymentId}`,
          EventPattern: JSON.stringify({
            source: ['aws.elasticloadbalancing'],
            'detail-type': ['ELB Target Health State Change'],
            detail: {
              targetGroupArn: [config.targetGroupArn],
            },
          }),
          State: 'ENABLED',
        }),
      );

      this.logger.log(`Target health EventBridge rule created: ${ruleName}`);

      // Lambda 함수를 타겟으로 추가
      const lambdaArn = this.configService.get<string>('OTTO_LAMBDA_ARN');

      if (lambdaArn) {
        await this.client.send(
          new PutTargetsCommand({
            Rule: ruleName,
            Targets: [
              {
                Arn: lambdaArn,
                Id: '1',
                RetryPolicy: {
                  MaximumRetryAttempts: 2,
                  MaximumEventAgeInSeconds: 1800, // 30분
                },
              },
            ],
          }),
        );

        await this.addLambdaPermission(ruleName, lambdaArn);
      }

      return ruleName;
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      this.logger.error(
        `Failed to create target health EventBridge rule: ${errorObj.message || 'Unknown error'}`,
      );
      throw new Error(
        `Target Health EventBridge Rule 생성 실패: ${errorObj.message || 'Unknown error'}`,
      );
    }
  }

  /**
   * 배포 완료 후 EventBridge Rule 정리
   */
  async cleanupDeploymentEventRules(deploymentId: string): Promise<void> {
    const environment = this.configService.get<string>(
      'NODE_ENV',
      'development',
    );
    const deployRuleName = `otto-deploy-${environment}-${deploymentId}`;
    const healthRuleName = `otto-health-${environment}-${deploymentId}`;

    try {
      // ECS 배포 규칙 삭제
      await this.deleteRuleByName(deployRuleName);
      this.logger.log(`Cleaned up deployment rule: ${deployRuleName}`);

      // ALB 헬스체크 규칙 삭제
      await this.deleteRuleByName(healthRuleName);
      this.logger.log(`Cleaned up health check rule: ${healthRuleName}`);
    } catch (error: unknown) {
      const errorObj = error as { message?: string };
      this.logger.warn(
        `Failed to cleanup deployment EventBridge rules for ${deploymentId}: ${errorObj.message || 'Unknown error'}`,
      );
      // 정리 실패는 치명적이지 않으므로 예외를 던지지 않음
    }
  }

  /**
   * Lambda 권한 추가
   */
  private async addLambdaPermission(
    ruleName: string,
    lambdaArn: string,
  ): Promise<void> {
    const statementId = `${ruleName}-permission`;

    try {
      // 먼저 기존 권한 제거 시도 (중복 방지)
      try {
        await this.lambdaClient.send(
          new RemovePermissionCommand({
            FunctionName: lambdaArn.split(':').pop(),
            StatementId: statementId,
          }),
        );
        this.logger.log(`Removed existing permission: ${statementId}`);
      } catch {
        // 권한이 없으면 무시
      }

      await this.lambdaClient.send(
        new AddPermissionCommand({
          FunctionName: lambdaArn.split(':').pop(),
          StatementId: statementId,
          Action: 'lambda:InvokeFunction',
          Principal: 'events.amazonaws.com',
          SourceArn: `arn:aws:events:${this.region}:${lambdaArn.split(':')[4]}:rule/${ruleName}`,
        }),
      );

      this.logger.log(`Lambda permission added for rule: ${ruleName}`);
    } catch (permissionError: unknown) {
      const errorObj = permissionError as { name?: string; message?: string };
      if (errorObj.name !== 'ResourceConflictException') {
        this.logger.error(
          `Failed to add Lambda permission: ${errorObj.message || 'Unknown error'}`,
        );
        throw new Error(
          `Lambda 권한 추가 실패: ${errorObj.message || 'Unknown error'}`,
        );
      }
      this.logger.log(`Lambda permission already exists for rule: ${ruleName}`);
    }
  }

  /**
   * Rule 이름으로 EventBridge Rule 삭제
   */
  private async deleteRuleByName(ruleName: string): Promise<void> {
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
        const errorObj = error as { name?: string; message?: string };
        if (errorObj.name !== 'ResourceNotFoundException') {
          this.logger.warn(
            `Failed to remove targets from ${ruleName}: ${errorObj.message || 'Unknown error'}`,
          );
        }
      }

      // 2. Lambda 권한 제거
      const lambdaArn = this.configService.get<string>('OTTO_LAMBDA_ARN');
      if (lambdaArn) {
        const statementId = `${ruleName}-permission`;
        try {
          await this.lambdaClient.send(
            new RemovePermissionCommand({
              FunctionName: lambdaArn.split(':').pop(),
              StatementId: statementId,
            }),
          );
          this.logger.log(`Lambda permission removed for rule: ${ruleName}`);
        } catch (permissionError: unknown) {
          const errorObj = permissionError as {
            name?: string;
            message?: string;
          };
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
