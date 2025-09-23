import { Injectable, Logger } from '@nestjs/common';
import { AwsEcrService } from '../aws-ecr.service';
import { AwsEcsService } from '../aws-ecs.service';

/**
 * ECR을 이용한 CD(Continuous Deployment) 예제
 * 이미지 빌드 → ECR 푸시 → ECS 배포 과정을 보여줍니다
 */
@Injectable()
export class EcrCdExample {
  private readonly logger = new Logger(EcrCdExample.name);

  constructor(
    private readonly ecrService: AwsEcrService,
    private readonly ecsService: AwsEcsService,
  ) {}

  /**
   * 전체 CD 파이프라인을 실행합니다
   * @param appName - 애플리케이션 이름
   * @param imageTag - 이미지 태그 (예: latest, v1.0.0)
   * @param clusterName - ECS 클러스터 이름
   * @param serviceName - ECS 서비스 이름
   */
  async runCdPipeline(
    appName: string,
    imageTag: string,
    clusterName: string,
    serviceName: string,
  ) {
    try {
      this.logger.log(`CD 파이프라인 시작: ${appName}:${imageTag}`);

      // 1. ECR 리포지토리 확인/생성
      const repositoryUri = await this.ensureRepository(appName);

      // 2. 이미지 빌드 및 ECR 푸시 (실제 환경에서는 Docker 빌드)
      await this.buildAndPushImage(appName, imageTag, repositoryUri);

      // 3. 새로운 태스크 정의 생성
      const taskDefinitionArn = await this.createTaskDefinition(
        appName,
        repositoryUri,
        imageTag,
      );

      // 4. ECS 서비스 업데이트
      await this.updateEcsService(clusterName, serviceName, taskDefinitionArn);

      // 5. 배포 상태 모니터링
      await this.monitorDeployment(clusterName, serviceName);

      this.logger.log(`CD 파이프라인 완료: ${appName}:${imageTag}`);
    } catch (error) {
      this.logger.error(`CD 파이프라인 실패: ${error}`);
      throw error;
    }
  }

  /**
   * ECR 리포지토리가 존재하는지 확인하고, 없으면 생성합니다
   */
  private async ensureRepository(repositoryName: string): Promise<string> {
    try {
      // 기존 리포지토리 확인
      const response = await this.ecrService.describeRepositories([
        repositoryName,
      ]);

      if (response.repositories && response.repositories.length > 0) {
        const repositoryUri = response.repositories[0].repositoryUri!;
        this.logger.log(`기존 ECR 리포지토리 사용: ${repositoryUri}`);
        return repositoryUri;
      }
    } catch (error) {
      // 리포지토리가 없는 경우
      this.logger.log(`ECR 리포지토리가 없음, 새로 생성: ${repositoryName}`);
    }

    // 새 리포지토리 생성
    const createResponse = await this.ecrService.createRepository({
      repositoryName,
      imageScanningConfiguration: {
        scanOnPush: true, // 이미지 푸시 시 자동 스캔
      },
      encryptionConfiguration: {
        encryptionType: 'AES256', // 암호화 설정
      },
      tags: [
        { Key: 'Environment', Value: 'production' },
        { Key: 'Application', Value: repositoryName },
      ],
    });

    const repositoryUri = createResponse.repository!.repositoryUri!;
    this.logger.log(`새 ECR 리포지토리 생성: ${repositoryUri}`);
    return repositoryUri;
  }

  /**
   * Docker 이미지를 빌드하고 ECR에 푸시합니다
   * 실제 환경에서는 Docker CLI나 buildx를 사용합니다
   */
  private async buildAndPushImage(
    appName: string,
    imageTag: string,
    repositoryUri: string,
  ): Promise<void> {
    this.logger.log(`이미지 빌드 및 푸시 시작: ${appName}:${imageTag}`);

    // ECR 로그인 토큰 획득
    const authResponse = await this.ecrService.getAuthorizationToken();
    const authData = authResponse.authorizationData![0];
    const token = Buffer.from(authData.authorizationToken!, 'base64')
      .toString()
      .split(':')[1];

    this.logger.log('ECR 인증 토큰 획득 완료');

    // 실제 환경에서는 다음과 같은 Docker 명령어를 실행합니다:
    // 1. docker build -t ${appName}:${imageTag} .
    // 2. docker tag ${appName}:${imageTag} ${repositoryUri}:${imageTag}
    // 3. echo ${token} | docker login --username AWS --password-stdin ${registryId}.dkr.ecr.${region}.amazonaws.com
    // 4. docker push ${repositoryUri}:${imageTag}

    this.logger.log(`이미지 푸시 완료: ${repositoryUri}:${imageTag}`);
  }

  /**
   * 새로운 태스크 정의를 생성합니다
   */
  private async createTaskDefinition(
    appName: string,
    repositoryUri: string,
    imageTag: string,
  ): Promise<string> {
    this.logger.log(`태스크 정의 생성: ${appName}`);

    const taskDefResponse = await this.ecsService.registerTaskDefinition({
      family: `${appName}-task`,
      requiresCompatibilities: ['FARGATE'],
      networkMode: 'awsvpc',
      cpu: '256', // 0.25 vCPU
      memory: '512', // 512 MB
      executionRoleArn: 'arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole',
      containerDefinitions: [
        {
          name: appName,
          image: `${repositoryUri}:${imageTag}`,
          memory: 512,
          essential: true,
          portMappings: [
            {
              containerPort: 3000,
              protocol: 'tcp',
            },
          ],
          environment: [
            { name: 'NODE_ENV', value: 'production' },
            { name: 'PORT', value: '3000' },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': `/ecs/${appName}`,
              'awslogs-region': 'us-east-1',
              'awslogs-stream-prefix': 'ecs',
            },
          },
        },
      ],
    });

    const taskDefinitionArn =
      taskDefResponse.taskDefinition!.taskDefinitionArn!;
    this.logger.log(`태스크 정의 생성 완료: ${taskDefinitionArn}`);
    return taskDefinitionArn;
  }

  /**
   * ECS 서비스를 새로운 태스크 정의로 업데이트합니다
   */
  private async updateEcsService(
    clusterName: string,
    serviceName: string,
    taskDefinitionArn: string,
  ): Promise<void> {
    this.logger.log(`ECS 서비스 업데이트: ${serviceName}`);

    await this.ecsService.updateService(
      clusterName,
      serviceName,
      undefined, // desiredCount는 유지
      taskDefinitionArn,
    );

    this.logger.log('ECS 서비스 업데이트 요청 완료');
  }

  /**
   * 배포 상태를 모니터링합니다
   */
  private async monitorDeployment(
    clusterName: string,
    serviceName: string,
  ): Promise<void> {
    this.logger.log('배포 상태 모니터링 시작');

    const maxAttempts = 30; // 15분 (30회 * 30초)
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await this.ecsService.describeServices(clusterName, [
        serviceName,
      ]);

      const service = response.services![0];
      const deployments = service.deployments || [];

      // PRIMARY 배포 찾기
      const primaryDeployment = deployments.find((d) => d.status === 'PRIMARY');

      if (primaryDeployment) {
        const running = primaryDeployment.runningCount || 0;
        const desired = primaryDeployment.desiredCount || 0;

        this.logger.log(`배포 진행 상황: ${running}/${desired} 태스크 실행 중`);

        if (running === desired && desired > 0) {
          this.logger.log('배포 완료! 모든 태스크가 정상 실행 중입니다.');
          return;
        }
      }

      attempts++;
      await this.sleep(30000); // 30초 대기
    }

    throw new Error('배포 타임아웃: 15분 내에 배포가 완료되지 않았습니다.');
  }

  /**
   * 롤백을 수행합니다
   */
  async rollback(
    clusterName: string,
    serviceName: string,
    previousTaskDefinition: string,
  ): Promise<void> {
    this.logger.log(`롤백 시작: ${previousTaskDefinition}`);

    await this.ecsService.updateService(
      clusterName,
      serviceName,
      undefined,
      previousTaskDefinition,
    );

    await this.monitorDeployment(clusterName, serviceName);
    this.logger.log('롤백 완료');
  }

  /**
   * 오래된 이미지를 정리합니다
   */
  async cleanupOldImages(
    repositoryName: string,
    keepCount: number = 10,
  ): Promise<void> {
    this.logger.log(
      `이미지 정리 시작: ${repositoryName}, 최근 ${keepCount}개 유지`,
    );

    const imagesResponse = await this.ecrService.describeImages({
      repositoryName,
    });

    const images = imagesResponse.imageDetails || [];

    // 푸시 시간 기준으로 정렬 (최신 순)
    images.sort((a, b) => {
      const dateA = a.imagePushedAt?.getTime() || 0;
      const dateB = b.imagePushedAt?.getTime() || 0;
      return dateB - dateA;
    });

    // 유지할 개수를 초과하는 이미지들 삭제
    if (images.length > keepCount) {
      const imagesToDelete = images.slice(keepCount);
      const imageIds = imagesToDelete.map((img) => ({
        imageDigest: img.imageDigest!,
      }));

      await this.ecrService.batchDeleteImage({
        repositoryName,
        imageIds,
      });

      this.logger.log(`${imagesToDelete.length}개의 오래된 이미지 삭제 완료`);
    }
  }

  /**
   * 블루-그린 배포를 수행합니다
   */
  async blueGreenDeploy(
    appName: string,
    imageTag: string,
    blueCluster: string,
    greenCluster: string,
    serviceName: string,
  ): Promise<void> {
    this.logger.log(`블루-그린 배포 시작: ${appName}:${imageTag}`);

    try {
      // 1. 그린 환경에 새 버전 배포
      await this.runCdPipeline(appName, imageTag, greenCluster, serviceName);

      // 2. 헬스 체크 (실제로는 ALB나 Route53을 통해 트래픽 전환)
      this.logger.log('그린 환경 헬스 체크 완료');

      // 3. 트래픽을 그린으로 전환 (여기서는 로그만)
      this.logger.log('트래픽을 그린 환경으로 전환');

      // 4. 블루 환경 정리 (선택사항)
      this.logger.log('블루-그린 배포 완료');
    } catch (error) {
      this.logger.error('블루-그린 배포 실패, 롤백 필요', error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
