import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deployment } from '../database/entities/deployment.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { AwsEcsService } from '../aws/aws-ecs.service';
import { AwsAlbService } from '../aws/aws-alb.service';
import { AwsRoute53Service } from '../aws/aws-route53.service';
import { AwsInfrastructureService } from '../aws/aws-infrastructure.service';
import { DeploymentEventBridgeService } from './deployment-eventbridge.service';

@Injectable()
export class PipelineCleanupService {
  private readonly logger = new Logger(PipelineCleanupService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepository: Repository<Deployment>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly ecsService: AwsEcsService,
    private readonly albService: AwsAlbService,
    private readonly route53Service: AwsRoute53Service,
    private readonly infrastructureService: AwsInfrastructureService,
    private readonly deploymentEventBridge: DeploymentEventBridgeService,
  ) {}

  /**
   * 파이프라인 삭제 시 모든 관련 AWS 리소스 정리
   */
  async cleanupPipelineResources(pipelineId: string): Promise<void> {
    this.logger.log(`🧹 Starting cleanup for pipeline: ${pipelineId}`);

    try {
      // 1. 파이프라인 정보 조회
      const pipeline = await this.pipelineRepository.findOne({
        where: { pipelineId },
        relations: ['project'],
      });

      if (!pipeline) {
        this.logger.warn(`Pipeline not found: ${pipelineId}`);
        return;
      }

      // 2. 활성 배포 정보 조회
      const activeDeployments = await this.deploymentRepository.find({
        where: { pipelineId },
        order: { createdAt: 'DESC' },
      });

      this.logger.log(
        `Found ${activeDeployments.length} deployments for pipeline ${pipelineId}`,
      );

      // 3. ECS 서비스 정리
      await this.cleanupEcsService(pipelineId);

      // 4. ALB 규칙 정리
      await this.cleanupAlbRules(pipelineId, activeDeployments);

      // 5. 타겟 그룹 정리
      await this.cleanupTargetGroups(activeDeployments);

      // 6. Route53 레코드 정리
      await this.cleanupRoute53Records(pipelineId, activeDeployments);

      // 7. EventBridge 규칙 정리
      await this.cleanupEventBridgeRules(activeDeployments);

      // 8. 배포 레코드 정리
      await this.cleanupDeploymentRecords(pipelineId);

      this.logger.log(`✅ Pipeline cleanup completed: ${pipelineId}`);
    } catch (error) {
      this.logger.error(
        `❌ Pipeline cleanup failed for ${pipelineId}: ${error}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * ECS 서비스 정리
   */
  private async cleanupEcsService(pipelineId: string): Promise<void> {
    try {
      const serviceName = `otto-${pipelineId}`;
      this.logger.log(`🔄 Cleaning up ECS service: ${serviceName}`);

      // 서비스 존재 여부 확인
      const serviceExists = await this.checkEcsServiceExists(serviceName);

      if (serviceExists) {
        // 인프라 구성 조회
        const infrastructure =
          await this.infrastructureService.getOrCreateInfrastructure();
        const clusterName = infrastructure.cluster.name;

        // 1. 서비스 스케일 다운 (desiredCount를 0으로)
        await this.ecsService.updateService(clusterName, serviceName, 0);

        this.logger.log(`⏳ Waiting for tasks to stop...`);
        await this.waitForTasksToStop(serviceName, clusterName);

        // 2. 서비스 삭제
        await this.ecsService.deleteService(clusterName, serviceName);

        this.logger.log(`✅ ECS service deleted: ${serviceName}`);
      } else {
        this.logger.log(`ℹ️ ECS service not found: ${serviceName}`);
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup ECS service: ${error}`);
      // ECS 정리 실패해도 다른 리소스 정리는 계속 진행
    }
  }

  /**
   * ALB 규칙 정리
   */
  private async cleanupAlbRules(
    pipelineId: string,
    deployments: Deployment[],
  ): Promise<void> {
    try {
      this.logger.log(`🔄 Cleaning up ALB rules for pipeline: ${pipelineId}`);

      // 메인 ALB 조회 (Infrastructure Service에서 ALB 이름 가져오기)
      const albName = process.env.AWS_ALB_NAME || 'otto-main-alb';
      const mainAlb = await this.albService.findLoadBalancerByName(albName);

      if (!mainAlb) {
        this.logger.log('ℹ️ Main ALB not found, skipping rule cleanup');
        return;
      }

      // 리스너 조회
      const listeners = await this.albService.describeListeners(mainAlb.arn);

      for (const listener of listeners) {
        const rules = await this.albService.describeRules(listener.arn);

        // 파이프라인과 관련된 규칙 찾기 (호스트 헤더 기반)
        for (const deployment of deployments) {
          if (deployment.deployUrl) {
            const hostHeader = deployment.deployUrl;
            const matchingRules = rules.filter((rule) =>
              rule.conditions.some(
                (condition) =>
                  condition.field === 'host-header' &&
                  condition.values.includes(hostHeader),
              ),
            );

            // 규칙 삭제
            for (const rule of matchingRules) {
              if (rule.priority !== 'default') {
                await this.albService.deleteRule(rule.ruleArn);
                this.logger.log(`✅ ALB rule deleted: ${rule.ruleArn}`);
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup ALB rules: ${error}`);
    }
  }

  /**
   * 타겟 그룹 정리
   */
  private async cleanupTargetGroups(deployments: Deployment[]): Promise<void> {
    try {
      this.logger.log(`🔄 Cleaning up target groups`);

      for (const deployment of deployments) {
        if (deployment.targetGroupArn) {
          try {
            await this.albService.deleteTargetGroup(deployment.targetGroupArn);
            this.logger.log(
              `✅ Target group deleted: ${deployment.targetGroupArn}`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to delete target group ${deployment.targetGroupArn}: ${error}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup target groups: ${error}`);
    }
  }

  /**
   * Route53 레코드 정리
   */
  private async cleanupRoute53Records(
    pipelineId: string,
    deployments: Deployment[],
  ): Promise<void> {
    try {
      this.logger.log(
        `🔄 Cleaning up Route53 records for pipeline: ${pipelineId}`,
      );

      // 인프라 구성에서 Route53 정보 가져오기
      const infrastructure =
        await this.infrastructureService.getOrCreateInfrastructure();
      const hostedZoneId = infrastructure.route53.hostedZoneId;

      if (hostedZoneId === 'MANUAL_SETUP_REQUIRED') {
        this.logger.warn(
          'Route53 hosted zone not configured, skipping DNS cleanup',
        );
        return;
      }

      for (const deployment of deployments) {
        if (deployment.deployUrl) {
          try {
            // DNS 레코드 삭제 시도
            await this.route53Service.deleteRecord({
              hostedZoneId,
              name: deployment.deployUrl,
              type: 'A',
              aliasTarget: {
                dnsName: deployment.albDnsName || 'unknown',
                hostedZoneId: 'ZWKZPGTI48KDX', // ALB의 Hosted Zone ID
                evaluateTargetHealth: true,
              },
            });

            this.logger.log(
              `✅ Route53 record deleted: ${deployment.deployUrl}`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to delete Route53 record ${deployment.deployUrl}: ${error}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup Route53 records: ${error}`);
    }
  }

  /**
   * EventBridge 규칙 정리
   */
  private async cleanupEventBridgeRules(
    deployments: Deployment[],
  ): Promise<void> {
    try {
      this.logger.log(`🔄 Cleaning up EventBridge rules`);

      for (const deployment of deployments) {
        try {
          await this.deploymentEventBridge.cleanupDeploymentEventRules(
            deployment.deploymentId,
          );
          this.logger.log(
            `✅ EventBridge rules cleaned up for deployment: ${deployment.deploymentId}`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to cleanup EventBridge rules for ${deployment.deploymentId}: ${error}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup EventBridge rules: ${error}`);
    }
  }

  /**
   * 배포 레코드 정리
   */
  private async cleanupDeploymentRecords(pipelineId: string): Promise<void> {
    try {
      this.logger.log(
        `🔄 Cleaning up deployment records for pipeline: ${pipelineId}`,
      );

      await this.deploymentRepository.delete({ pipelineId });

      this.logger.log(
        `✅ Deployment records cleaned up for pipeline: ${pipelineId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to cleanup deployment records: ${error}`);
    }
  }

  /**
   * ECS 서비스 존재 여부 확인
   */
  private async checkEcsServiceExists(serviceName: string): Promise<boolean> {
    try {
      const infrastructure =
        await this.infrastructureService.getOrCreateInfrastructure();
      const clusterName = infrastructure.cluster.name;

      const result = await this.ecsService.listServices(clusterName);
      const serviceArns = result.serviceArns || [];

      // 서비스 ARN에서 서비스 이름 추출해서 비교
      return serviceArns.some((arn) => {
        const arnParts = arn.split('/');
        const existingServiceName = arnParts[arnParts.length - 1];
        return existingServiceName === serviceName;
      });
    } catch (error) {
      this.logger.warn(`Failed to check service existence: ${error}`);
      return false;
    }
  }

  /**
   * ECS 태스크가 모두 중지될 때까지 대기
   */
  private async waitForTasksToStop(
    serviceName: string,
    clusterName: string,
  ): Promise<void> {
    const maxRetries = 30; // 5분 대기
    const retryInterval = 10000; // 10초

    for (let i = 0; i < maxRetries; i++) {
      try {
        const result = await this.ecsService.describeServices(clusterName, [
          serviceName,
        ]);
        const services = result.services || [];

        if (services.length === 0) {
          this.logger.log(
            `✅ Service not found (likely deleted): ${serviceName}`,
          );
          return;
        }

        const service = services[0];
        if (
          service &&
          service.runningCount === 0 &&
          service.pendingCount === 0
        ) {
          this.logger.log(`✅ All tasks stopped for service: ${serviceName}`);
          return;
        }

        if (i < maxRetries - 1) {
          this.logger.log(
            `⏳ Waiting for tasks to stop... (${i + 1}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
        }
      } catch (error) {
        this.logger.warn(`Error checking service status: ${error}`);
        break;
      }
    }

    this.logger.warn(`⚠️ Timeout waiting for tasks to stop: ${serviceName}`);
  }
}
