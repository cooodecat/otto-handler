import { Injectable, Logger } from '@nestjs/common';
import {
  ECRClient,
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
  Repository,
} from '@aws-sdk/client-ecr';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

@Injectable()
export class ECRService {
  private readonly logger = new Logger(ECRService.name);
  private readonly ecrClient: ECRClient;
  private readonly stsClient: STSClient;

  constructor() {
    const region = process.env.AWS_REGION || 'ap-northeast-2';

    this.ecrClient = new ECRClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    this.stsClient = new STSClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * ECR Repository 생성 (없을 경우에만)
   */
  async createRepositoryIfNotExists(config: {
    userId: string;
    projectId: string;
  }): Promise<{
    repositoryName: string;
    repositoryUri: string;
    registryId: string;
  }> {
    const environment = process.env.NODE_ENV || 'development';
    const repositoryName = `otto/${environment}/${config.userId}/${config.projectId}`;

    try {
      // 1. Repository 존재 확인
      const describeResult = await this.ecrClient.send(
        new DescribeRepositoriesCommand({
          repositoryNames: [repositoryName],
        }),
      );

      if (
        describeResult.repositories &&
        describeResult.repositories.length > 0
      ) {
        const repository = describeResult.repositories[0];
        this.logger.log(`ECR Repository already exists: ${repositoryName}`);

        return {
          repositoryName,
          repositoryUri: repository.repositoryUri!,
          registryId: repository.registryId!,
        };
      }
    } catch (error) {
      // Repository가 없으면 RepositoryNotFoundException 발생 - 정상적인 상황
      if (error.name !== 'RepositoryNotFoundException') {
        this.logger.error(`Error checking ECR repository: ${error.message}`);
        throw error;
      }
    }

    // 2. Repository 생성
    try {
      const createResult = await this.ecrClient.send(
        new CreateRepositoryCommand({
          repositoryName,
          imageScanningConfiguration: {
            scanOnPush: true, // 이미지 푸시 시 취약점 스캔
          },
          encryptionConfiguration: {
            encryptionType: 'AES256', // 기본 암호화
          },
          tags: [
            {
              Key: 'Project',
              Value: 'Otto',
            },
            {
              Key: 'Environment',
              Value: environment,
            },
            {
              Key: 'UserId',
              Value: config.userId,
            },
            {
              Key: 'ProjectId',
              Value: config.projectId,
            },
            {
              Key: 'ManagedBy',
              Value: 'Otto-System',
            },
          ],
        }),
      );

      const repository = createResult.repository!;
      this.logger.log(`ECR Repository created successfully: ${repositoryName}`);

      return {
        repositoryName,
        repositoryUri: repository.repositoryUri!,
        registryId: repository.registryId!,
      };
    } catch (error) {
      this.logger.error(`Failed to create ECR repository: ${error.message}`);
      throw new Error(`ECR Repository 생성 실패: ${error.message}`);
    }
  }

  /**
   * ECR 이미지 태그 생성
   */
  generateImageTag(config: {
    userId: string;
    projectId: string;
    buildNumber: string;
  }): string {
    return `user-${config.userId}-project-${config.projectId}-build-${config.buildNumber}`;
  }

  /**
   * ECR 이미지 URI 생성
   */
  async generateImageUri(config: {
    userId: string;
    projectId: string;
    buildNumber: string;
  }): Promise<string> {
    // AWS Account ID 조회
    const { Account } = await this.stsClient.send(
      new GetCallerIdentityCommand({}),
    );
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    const environment = process.env.NODE_ENV || 'development';

    const repositoryName = `otto/${environment}/${config.userId}/${config.projectId}`;
    const imageTag = this.generateImageTag(config);

    return `${Account}.dkr.ecr.${region}.amazonaws.com/${repositoryName}:${imageTag}`;
  }

  /**
   * Repository URI 조회 (Repository 이름으로)
   */
  async getRepositoryUri(repositoryName: string): Promise<string | null> {
    try {
      const result = await this.ecrClient.send(
        new DescribeRepositoriesCommand({
          repositoryNames: [repositoryName],
        }),
      );

      if (result.repositories && result.repositories.length > 0) {
        return result.repositories[0].repositoryUri!;
      }

      return null;
    } catch (error) {
      this.logger.error(`Error getting repository URI: ${error.message}`);
      return null;
    }
  }

  /**
   * AWS Account ID 조회
   */
  async getAccountId(): Promise<string> {
    try {
      const { Account } = await this.stsClient.send(
        new GetCallerIdentityCommand({}),
      );
      return Account!;
    } catch (error) {
      this.logger.error(`Failed to get AWS Account ID: ${error.message}`);
      throw new Error('AWS Account ID 조회 실패');
    }
  }

  /**
   * ECR Repository 삭제
   */
  async deleteRepository(repositoryName: string): Promise<void> {
    try {
      const { DeleteRepositoryCommand } = await import('@aws-sdk/client-ecr');

      await this.ecrClient.send(
        new DeleteRepositoryCommand({
          repositoryName,
          force: true, // 이미지가 있어도 강제 삭제
        }),
      );

      this.logger.log(`ECR Repository deleted successfully: ${repositoryName}`);
    } catch (error) {
      if (error.name === 'RepositoryNotFoundException') {
        this.logger.warn(
          `ECR Repository not found for deletion: ${repositoryName}`,
        );
        return;
      }

      this.logger.error(`Failed to delete ECR repository: ${error.message}`);
      throw new Error(`ECR Repository 삭제 실패: ${error.message}`);
    }
  }
}
