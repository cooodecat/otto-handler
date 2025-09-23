import { Injectable } from '@nestjs/common';
import { AwsEcsService } from '../aws-ecs.service';
import { AwsEcrService } from '../aws-ecr.service';
import { AwsRoute53Service } from '../aws-route53.service';
import { AwsAlbService } from '../aws-alb.service';

/**
 * 완전한 배포 플로우 예제:
 * ECR 배포 → ECS 업데이트 → Route53 서브도메인 → ALB 라우팅
 */
@Injectable()
export class CompleteDeploymentExample {
  constructor(
    private readonly ecsService: AwsEcsService,
    private readonly ecrService: AwsEcrService,
    private readonly route53Service: AwsRoute53Service,
    private readonly albService: AwsAlbService,
  ) {}

  /**
   * 전체 배포 플로우 실행
   * ECR → ECS → Route53 → ALB 순서로 배포
   */
  async deployCompleteApplication(config: {
    userId: string;
    projectId: string;
    projectName: string;
    imageTag: string;
    domainName: string;
    subdomainPrefix: string;
    vpcId: string;
    subnetIds: string[];
    securityGroupIds: string[];
    hostedZoneId: string;
  }) {
    console.log('🚀 완전한 애플리케이션 배포 시작...');

    try {
      // 1. ECR 이미지 URI 생성
      const repositoryName = `otto-${config.userId}-${config.projectId}`;
      const imageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${repositoryName}:${config.imageTag}`;

      console.log(`📦 ECR 이미지 URI: ${imageUri}`);

      // 2. ECS 클러스터 생성
      const clusterName = `otto-cluster-${config.userId}`;
      try {
        await this.ecsService.createCluster({ clusterName });
        console.log(`✅ ECS 클러스터 생성: ${clusterName}`);
      } catch (error) {
        console.log(`ℹ️ ECS 클러스터 이미 존재: ${clusterName}`);
      }

      // 3. ECS 태스크 정의 생성
      const taskDefinitionFamily = `otto-task-${config.projectId}`;
      const taskDefinition = await this.ecsService.registerTaskDefinition({
        family: taskDefinitionFamily,
        cpu: '256',
        memory: '512',
        networkMode: 'awsvpc',
        containerDefinitions: [
          {
            name: config.projectName,
            image: imageUri,
            portMappings: [{ containerPort: 3000, protocol: 'tcp' }],
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/otto/${config.userId}/${config.projectId}`,
                'awslogs-region': process.env.AWS_REGION!,
                'awslogs-stream-prefix': 'ecs',
              },
            },
            environment: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: '3000' },
              { name: 'USER_ID', value: config.userId },
              { name: 'PROJECT_ID', value: config.projectId },
            ],
          },
        ],
      });

      console.log(
        `✅ 태스크 정의 생성: ${taskDefinition.taskDefinition?.taskDefinitionArn}`,
      );

      // 4. ALB 타겟 그룹 생성
      const targetGroupName = `otto-tg-${config.projectId}`;
      const targetGroup = await this.albService.createTargetGroup({
        name: targetGroupName,
        protocol: 'HTTP',
        port: 3000,
        vpcId: config.vpcId,
        targetType: 'ip',
        healthCheck: {
          path: '/health',
          protocol: 'HTTP',
          port: '3000',
          intervalSeconds: 30,
          timeoutSeconds: 5,
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
          matcher: '200',
        },
      });

      console.log(`✅ 타겟 그룹 생성: ${targetGroup.name}`);

      // 5. ALB 생성
      const albName = `otto-alb-${config.projectId}`;
      const loadBalancer = await this.albService.createLoadBalancer({
        name: albName,
        subnets: config.subnetIds,
        securityGroups: config.securityGroupIds,
        scheme: 'internet-facing',
        type: 'application',
      });

      console.log(
        `✅ ALB 생성: ${loadBalancer.name} (${loadBalancer.dnsName})`,
      );

      // 6. ALB 리스너 생성
      const listener = await this.albService.createListener({
        loadBalancerArn: loadBalancer.arn,
        protocol: 'HTTP',
        port: 80,
        defaultActions: [
          {
            type: 'forward',
            targetGroupArn: targetGroup.arn,
          },
        ],
      });

      console.log(`✅ 리스너 생성: ${listener.arn}`);

      // 7. ECS 서비스 생성
      const serviceName = `otto-service-${config.projectId}`;
      const service = await this.ecsService.createService({
        serviceName,
        cluster: clusterName,
        taskDefinition: taskDefinition.taskDefinition?.taskDefinitionArn || '',
        desiredCount: 2,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnetIds,
            securityGroups: config.securityGroupIds,
            assignPublicIp: 'ENABLED',
          },
        },
        loadBalancers: [
          {
            targetGroupArn: targetGroup.arn,
            containerName: config.projectName,
            containerPort: 3000,
          },
        ],
      });

      console.log(`✅ ECS 서비스 생성: ${service.service?.serviceArn}`);

      // 8. Route53 DNS 레코드 생성
      const subdomain = `${config.subdomainPrefix}.${config.domainName}`;
      const record = await this.route53Service.createRecord({
        hostedZoneId: config.hostedZoneId,
        name: subdomain,
        type: 'A',
        aliasTarget: {
          dnsName: loadBalancer.dnsName,
          hostedZoneId: loadBalancer.canonicalHostedZoneId,
          evaluateTargetHealth: true,
        },
      });

      console.log(
        `✅ Route53 DNS 레코드 생성: ${subdomain} → ${loadBalancer.dnsName}`,
      );

      // 9. 배포 완료
      const deploymentInfo = {
        imageUri,
        clusterName,
        serviceName,
        taskDefinitionArn:
          taskDefinition.taskDefinition?.taskDefinitionArn || '',
        loadBalancerDns: loadBalancer.dnsName,
        targetGroupArn: targetGroup.arn,
        subdomain,
        changeId: record.changeId,
        accessUrl: `http://${subdomain}`,
      };

      console.log('🎉 배포 완료!');
      console.log(`🌐 접속 URL: ${deploymentInfo.accessUrl}`);

      return deploymentInfo;
    } catch (error: any) {
      console.error('❌ 배포 실패:', error);
      throw new Error(`배포 실패: ${error}`);
    }
  }

  /**
   * 애플리케이션 업데이트 (새 이미지로 롤링 배포)
   */
  async updateApplication(config: {
    userId: string;
    projectId: string;
    projectName: string;
    newImageTag: string;
  }) {
    console.log('🔄 애플리케이션 업데이트 시작...');

    try {
      const repositoryName = `otto-${config.userId}-${config.projectId}`;
      const newImageUri = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION}.amazonaws.com/${repositoryName}:${config.newImageTag}`;

      const clusterName = `otto-cluster-${config.userId}`;
      const serviceName = `otto-service-${config.projectId}`;
      const taskDefinitionFamily = `otto-task-${config.projectId}`;

      // 1. 새 태스크 정의 생성
      const newTaskDefinition = await this.ecsService.registerTaskDefinition({
        family: taskDefinitionFamily,
        cpu: '256',
        memory: '512',
        networkMode: 'awsvpc',
        containerDefinitions: [
          {
            name: config.projectName,
            image: newImageUri,
            portMappings: [{ containerPort: 3000, protocol: 'tcp' }],
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/otto/${config.userId}/${config.projectId}`,
                'awslogs-region': process.env.AWS_REGION!,
                'awslogs-stream-prefix': 'ecs',
              },
            },
            environment: [
              { name: 'NODE_ENV', value: 'production' },
              { name: 'PORT', value: '3000' },
              { name: 'USER_ID', value: config.userId },
              { name: 'PROJECT_ID', value: config.projectId },
              { name: 'IMAGE_TAG', value: config.newImageTag },
            ],
          },
        ],
      });

      console.log(
        `✅ 새 태스크 정의 생성: ${newTaskDefinition.taskDefinition?.taskDefinitionArn}`,
      );

      // 2. ECS 서비스 업데이트 (롤링 배포)
      await this.ecsService.updateService(
        serviceName,
        clusterName,
        2,
        newTaskDefinition.taskDefinition?.taskDefinitionArn || '',
      );

      console.log(`✅ 롤링 업데이트 완료: ${serviceName}`);
      console.log(`📦 새 이미지: ${newImageUri}`);

      return {
        newImageUri,
        taskDefinitionArn:
          newTaskDefinition.taskDefinition?.taskDefinitionArn || '',
        serviceName,
      };
    } catch (error: any) {
      console.error('❌ 업데이트 실패:', error);
      throw new Error(`업데이트 실패: ${error}`);
    }
  }

  /**
   * 애플리케이션 삭제
   */
  async deleteApplication(config: {
    userId: string;
    projectId: string;
    hostedZoneId: string;
    subdomain: string;
  }) {
    console.log('🗑️ 애플리케이션 삭제 시작...');

    try {
      const clusterName = `otto-cluster-${config.userId}`;
      const serviceName = `otto-service-${config.projectId}`;

      // 1. Route53 DNS 레코드 삭제
      try {
        await this.route53Service.deleteRecord({
          hostedZoneId: config.hostedZoneId,
          name: config.subdomain,
          type: 'A',
          aliasTarget: {
            dnsName: 'dummy',
            hostedZoneId: 'dummy',
          },
        });
        console.log(`✅ DNS 레코드 삭제: ${config.subdomain}`);
      } catch (error: any) {
        console.log(`ℹ️ DNS 레코드 삭제 스킵: ${error}`);
      }

      // 2. ECS 서비스 삭제
      try {
        await this.ecsService.deleteService(serviceName, clusterName);
        console.log(`✅ ECS 서비스 삭제: ${serviceName}`);
      } catch (error: any) {
        console.log(`ℹ️ ECS 서비스 삭제 스킵: ${error}`);
      }

      console.log('🎉 애플리케이션 삭제 완료!');
    } catch (error: any) {
      console.error('❌ 삭제 실패:', error);
      throw new Error(`삭제 실패: ${error}`);
    }
  }
}
