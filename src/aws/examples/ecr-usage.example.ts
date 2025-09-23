import { Injectable, Logger } from '@nestjs/common';
import { AwsEcrService } from '../aws-ecr.service';

/**
 * ECR 기본 사용법 예제
 * ECR 리포지토리 관리와 이미지 조작의 기본적인 사용 방법을 보여줍니다
 */
@Injectable()
export class EcrUsageExample {
  private readonly logger = new Logger(EcrUsageExample.name);

  constructor(private readonly ecrService: AwsEcrService) {}

  /**
   * ECR 리포지토리 생성 예제
   */
  async createRepositoryExample(): Promise<void> {
    try {
      const repositoryName = 'my-node-app';

      const result = await this.ecrService.createRepository({
        repositoryName,
        imageScanningConfiguration: {
          scanOnPush: true, // 푸시 시 자동 보안 스캔
        },
        encryptionConfiguration: {
          encryptionType: 'AES256',
        },
        tags: [
          { Key: 'Project', Value: 'MyProject' },
          { Key: 'Environment', Value: 'Development' },
          { Key: 'Owner', Value: 'DevOps Team' },
        ],
      });

      this.logger.log(
        `리포지토리 생성 완료: ${result.repository?.repositoryUri}`,
      );
      this.logger.log(`Registry ID: ${result.repository?.registryId}`);
    } catch (error) {
      this.logger.error(`리포지토리 생성 실패: ${error}`);
    }
  }

  /**
   * 리포지토리 목록 조회 예제
   */
  async listRepositoriesExample(): Promise<void> {
    try {
      const result = await this.ecrService.describeRepositories();

      this.logger.log(`총 ${result.repositories?.length}개의 리포지토리 발견`);

      result.repositories?.forEach((repo) => {
        this.logger.log(`- ${repo.repositoryName}: ${repo.repositoryUri}`);
        this.logger.log(`  생성일: ${repo?.createdAt?.toString() ?? ''}`);
        this.logger.log(`  이미지 수: ${repo.imageTagMutability}`);
      });
    } catch (error) {
      this.logger.error(`리포지토리 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 특정 리포지토리의 이미지 목록 조회 예제
   */
  async listImagesExample(repositoryName: string): Promise<void> {
    try {
      const result = await this.ecrService.listImages({
        repositoryName,
        maxResults: 100,
      });

      this.logger.log(
        `${repositoryName}에서 ${result.imageIds?.length}개의 이미지 발견`,
      );

      result.imageIds?.forEach((image) => {
        this.logger.log(`- 태그: ${image.imageTag || 'untagged'}`);
        this.logger.log(
          `  다이제스트: ${image.imageDigest?.substring(0, 12)}...`,
        );
      });
    } catch (error) {
      this.logger.error(`이미지 목록 조회 실패: ${error}`);
    }
  }

  /**
   * 이미지 상세 정보 조회 예제
   */
  async getImageDetailsExample(repositoryName: string): Promise<void> {
    try {
      const result = await this.ecrService.describeImages({
        repositoryName,
        maxResults: 10,
      });

      this.logger.log(`${repositoryName}의 이미지 상세 정보:`);

      result.imageDetails?.forEach((image) => {
        this.logger.log(`- 태그: ${image.imageTags?.join(', ') || 'untagged'}`);
        this.logger.log(
          `  크기: ${(image.imageSizeInBytes! / 1024 / 1024).toFixed(2)} MB`,
        );
        this.logger.log(`  푸시일: ${image.imagePushedAt?.toString() ?? ''}`);
        this.logger.log(
          `  스캔 상태: ${image.imageScanFindingsSummary ? '완료' : '없음'}`,
        );

        if (image.imageScanFindingsSummary) {
          const summary = image.imageScanFindingsSummary;
          this.logger.log(`  보안 스캔 결과:`);
          this.logger.log(
            `    스캔 완료 시간: ${summary.imageScanCompletedAt?.toString() ?? ''}`,
          );
          this.logger.log(
            `    취약점 수: ${summary.vulnerabilitySourceUpdatedAt ? '있음' : '없음'}`,
          );
        }
      });
    } catch (error) {
      this.logger.error(`이미지 상세 정보 조회 실패: ${error}`);
    }
  }

  /**
   * ECR 로그인 토큰 획득 예제
   */
  async getAuthTokenExample(): Promise<string> {
    try {
      const result = await this.ecrService.getAuthorizationToken();
      const authData = result.authorizationData![0];

      this.logger.log(`로그인 토큰 획득 완료`);
      this.logger.log(`프록시 엔드포인트: ${authData.proxyEndpoint}`);
      this.logger.log(`토큰 만료일: ${authData.expiresAt?.toString() ?? ''}`);

      // 토큰 디코딩 (실제 사용을 위해)
      const token = Buffer.from(
        authData.authorizationToken!,
        'base64',
      ).toString();
      const [username, password] = token.split(':');

      this.logger.log(`Docker 로그인 명령어:`);
      this.logger.log(
        `echo "${password}" | docker login --username ${username} --password-stdin ${authData.proxyEndpoint}`,
      );

      return password;
    } catch (error) {
      this.logger.error(`로그인 토큰 획득 실패: ${error}`);
      throw error;
    }
  }

  /**
   * 오래된 이미지 삭제 예제
   */
  async cleanupOldImagesExample(repositoryName: string): Promise<void> {
    try {
      // 1. 이미지 목록 조회
      const listResult = await this.ecrService.describeImages({
        repositoryName,
      });

      const images = listResult.imageDetails || [];
      this.logger.log(`${repositoryName}에서 ${images.length}개의 이미지 발견`);

      // 2. 30일 이상 된 이미지 필터링
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const oldImages = images.filter((image) => {
        return image.imagePushedAt! < thirtyDaysAgo;
      });

      if (oldImages.length === 0) {
        this.logger.log('삭제할 오래된 이미지가 없습니다.');
        return;
      }

      this.logger.log(`${oldImages.length}개의 오래된 이미지 삭제 예정`);

      // 3. 이미지 삭제
      const imageIds = oldImages.map((image) => ({
        imageDigest: image.imageDigest!,
      }));

      const deleteResult = await this.ecrService.batchDeleteImage({
        repositoryName,
        imageIds,
      });

      this.logger.log(`삭제 완료: ${deleteResult.imageIds?.length}개`);
      deleteResult.failures?.forEach((failure) => {
        this.logger.warn(
          `삭제 실패: ${failure.imageId?.imageDigest} - ${failure.failureReason}`,
        );
      });
    } catch (error) {
      this.logger.error(`이미지 정리 실패: ${error}`);
    }
  }

  /**
   * 리포지토리 정책 설정 예제
   */
  async setRepositoryPolicyExample(repositoryName: string): Promise<void> {
    try {
      // 교차 계정 접근을 허용하는 정책 예제
      const policyDocument = {
        Version: '2008-10-17',
        Statement: [
          {
            Sid: 'AllowPushPull',
            Effect: 'Allow',
            Principal: {
              AWS: [
                'arn:aws:iam::123456789012:root', // 다른 AWS 계정
                'arn:aws:iam::123456789012:role/ECSTaskRole',
              ],
            },
            Action: [
              'ecr:BatchCheckLayerAvailability',
              'ecr:BatchGetImage',
              'ecr:GetDownloadUrlForLayer',
              'ecr:PutImage',
              'ecr:InitiateLayerUpload',
              'ecr:UploadLayerPart',
              'ecr:CompleteLayerUpload',
            ],
          },
        ],
      };

      await this.ecrService.setRepositoryPolicy({
        repositoryName,
        policyText: JSON.stringify(policyDocument),
        force: true,
      });

      this.logger.log(`리포지토리 정책 설정 완료: ${repositoryName}`);
    } catch (error) {
      this.logger.error(`리포지토리 정책 설정 실패: ${error}`);
    }
  }

  /**
   * 수명 주기 정책 설정 예제
   */
  async setLifecyclePolicyExample(repositoryName: string): Promise<void> {
    try {
      // 최근 10개 이미지만 유지하는 정책
      const lifecyclePolicy = {
        rules: [
          {
            rulePriority: 1,
            description: 'Keep last 10 images',
            selection: {
              tagStatus: 'tagged',
              tagPrefixList: ['v'],
              countType: 'imageCountMoreThan',
              countNumber: 10,
            },
            action: {
              type: 'expire',
            },
          },
          {
            rulePriority: 2,
            description: 'Delete untagged images older than 1 day',
            selection: {
              tagStatus: 'untagged',
              countType: 'sinceImagePushed',
              countUnit: 'days',
              countNumber: 1,
            },
            action: {
              type: 'expire',
            },
          },
        ],
      };

      await this.ecrService.putLifecyclePolicy({
        repositoryName,
        lifecyclePolicyText: JSON.stringify(lifecyclePolicy),
      });

      this.logger.log(`수명 주기 정책 설정 완료: ${repositoryName}`);
    } catch (error) {
      this.logger.error(`수명 주기 정책 설정 실패: ${error}`);
    }
  }

  /**
   * 리포지토리 삭제 예제 (주의: 모든 이미지가 함께 삭제됩니다)
   */
  async deleteRepositoryExample(repositoryName: string): Promise<void> {
    try {
      // 강제 삭제 (이미지가 있어도 삭제)
      const result = await this.ecrService.deleteRepository(
        repositoryName,
        undefined, // registryId
        true, // force delete
      );

      this.logger.log(
        `리포지토리 삭제 완료: ${result.repository?.repositoryName}`,
      );
      this.logger.warn('⚠️  모든 이미지가 함께 삭제되었습니다!');
    } catch (error) {
      this.logger.error(`리포지토리 삭제 실패: ${error}`);
    }
  }

  /**
   * 전체 워크플로우 예제
   */
  async fullWorkflowExample(): Promise<void> {
    const repositoryName = 'example-app';

    this.logger.log('=== ECR 전체 워크플로우 시작 ===');

    try {
      // 1. 리포지토리 생성
      this.logger.log('1. 리포지토리 생성');
      await this.createRepositoryExample();

      // 2. 인증 토큰 획득
      this.logger.log('2. 인증 토큰 획득');
      await this.getAuthTokenExample();

      // 3. 정책 설정
      this.logger.log('3. 리포지토리 정책 설정');
      await this.setRepositoryPolicyExample(repositoryName);

      // 4. 수명 주기 정책 설정
      this.logger.log('4. 수명 주기 정책 설정');
      await this.setLifecyclePolicyExample(repositoryName);

      // 5. 이미지 정보 조회
      this.logger.log('5. 이미지 정보 조회');
      await this.getImageDetailsExample(repositoryName);

      // 6. 정리 작업
      this.logger.log('6. 오래된 이미지 정리');
      await this.cleanupOldImagesExample(repositoryName);

      this.logger.log('=== 워크플로우 완료 ===');
    } catch (error) {
      this.logger.error(`워크플로우 실행 중 오류: ${error}`);
    }
  }
}
