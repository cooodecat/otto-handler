import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Deployment,
  DeploymentStatus,
  DeploymentType,
} from '../database/entities/deployment.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { LogsGateway } from '../logs/logs.gateway';
import { DeploymentEventBridgeService } from './deployment-eventbridge.service';

interface CreateDeploymentConfig {
  pipelineId: string;
  userId: string;
  projectId: string;
  deploymentType?: DeploymentType;
  ecrImageUri?: string;
}

interface DeploymentProgress {
  deploymentId: string;
  status: DeploymentStatus;
  step: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class DeploymentTrackerService {
  private readonly logger = new Logger(DeploymentTrackerService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepository: Repository<Deployment>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly eventEmitter: EventEmitter2,
    private readonly logsGateway: LogsGateway,
    private readonly deploymentEventBridge: DeploymentEventBridgeService,
  ) {}

  /**
   * 새로운 배포 추적 시작
   */
  async startDeploymentTracking(
    config: CreateDeploymentConfig,
  ): Promise<Deployment> {
    this.logger.log(
      `🚀 Starting deployment tracking for pipeline: ${config.pipelineId}`,
    );

    // 파이프라인 정보 조회
    const pipeline = await this.pipelineRepository.findOne({
      where: { pipelineId: config.pipelineId },
      relations: ['project'],
    });

    if (!pipeline) {
      throw new Error(`Pipeline not found: ${config.pipelineId}`);
    }

    // 새로운 배포 레코드 생성
    const deployment = this.deploymentRepository.create({
      pipelineId: config.pipelineId,
      userId: config.userId,
      projectId: config.projectId,
      status: DeploymentStatus.PENDING,
      deploymentType: config.deploymentType || DeploymentType.INITIAL,
      ecrImageUri: config.ecrImageUri,
      startedAt: new Date(),
      metadata: {
        pipelineName: pipeline.pipelineName,
        projectName: pipeline.project?.projectName || 'Unknown',
      },
    });

    const savedDeployment = await this.deploymentRepository.save(deployment);

    // 초기 진행 상황 브로드캐스트
    this.broadcastProgress(savedDeployment.deploymentId, {
      status: DeploymentStatus.PENDING,
      step: 'initialization',
      message: '배포 준비 중...',
    });

    this.logger.log(
      `✅ Deployment tracking started: ${savedDeployment.deploymentId}`,
    );

    return savedDeployment;
  }

  /**
   * 배포 상태 업데이트
   */
  async updateDeploymentStatus(
    deploymentId: string,
    status: DeploymentStatus,
    updates: Partial<{
      deployUrl: string;
      ecsServiceArn: string;
      ecsClusterArn: string;
      targetGroupArn: string;
      albArn: string;
      albDnsName: string;
      errorMessage: string;
      metadata: Record<string, any>;
    }> = {},
  ): Promise<Deployment> {
    const deployment = await this.deploymentRepository.findOne({
      where: { deploymentId },
    });

    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    // 상태 업데이트
    deployment.status = status;

    // 필드별 업데이트
    if (updates.deployUrl) deployment.deployUrl = updates.deployUrl;
    if (updates.ecsServiceArn) deployment.ecsServiceArn = updates.ecsServiceArn;
    if (updates.ecsClusterArn) deployment.ecsClusterArn = updates.ecsClusterArn;
    if (updates.targetGroupArn)
      deployment.targetGroupArn = updates.targetGroupArn;
    if (updates.albArn) deployment.albArn = updates.albArn;
    if (updates.albDnsName) deployment.albDnsName = updates.albDnsName;
    if (updates.errorMessage) deployment.errorMessage = updates.errorMessage;

    // 메타데이터 병합
    if (updates.metadata) {
      deployment.metadata = {
        ...deployment.metadata,
        ...updates.metadata,
      };
    }

    // 완료 시점 기록
    if (status === DeploymentStatus.SUCCESS) {
      deployment.deployedAt = new Date();
      deployment.completedAt = new Date();
    } else if (
      status === DeploymentStatus.FAILED ||
      status === DeploymentStatus.ROLLED_BACK
    ) {
      deployment.completedAt = new Date();
    }

    const updatedDeployment = await this.deploymentRepository.save(deployment);

    // 상태 변경 이벤트 발생
    this.eventEmitter.emit('deployment.status.changed', {
      deployment: updatedDeployment,
      previousStatus: deployment.status,
      newStatus: status,
    });

    // 진행 상황 브로드캐스트
    this.broadcastProgress(deploymentId, {
      status,
      step: this.getStepFromStatus(status),
      message: this.getMessageFromStatus(status),
      metadata: updates.metadata,
    });

    this.logger.log(`📊 Deployment ${deploymentId} status updated: ${status}`);

    return updatedDeployment;
  }

  /**
   * ECS 서비스 배포 시작 시 EventBridge 규칙 설정
   */
  async setupEcsEventTracking(
    deploymentId: string,
    serviceName: string,
    clusterName: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `🎯 Setting up ECS event tracking for deployment: ${deploymentId}`,
      );

      // ECS 이벤트를 위한 EventBridge 규칙 생성
      await this.deploymentEventBridge.createDeploymentEventRule({
        serviceName,
        clusterName,
        deploymentId,
      });

      // 배포 상태를 ECS 배포 중으로 업데이트
      await this.updateDeploymentStatus(
        deploymentId,
        DeploymentStatus.DEPLOYING_ECS,
        {
          metadata: {
            ecsServiceName: serviceName,
            ecsClusterName: clusterName,
            eventRuleCreated: true,
          },
        },
      );

      this.logger.log(
        `✅ ECS event tracking setup completed for deployment: ${deploymentId}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to setup ECS event tracking for deployment ${deploymentId}: ${error}`,
      );

      await this.updateDeploymentStatus(deploymentId, DeploymentStatus.FAILED, {
        errorMessage: `ECS event tracking setup failed: ${error instanceof Error ? error.message : String(error)}`,
      });

      throw error;
    }
  }

  /**
   * ALB 타겟 헬스체크 추적 시작
   */
  async setupTargetHealthTracking(
    deploymentId: string,
    targetGroupArn: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `🎯 Setting up target health tracking for deployment: ${deploymentId}`,
      );

      // ALB 타겟 헬스 이벤트를 위한 EventBridge 규칙 생성
      await this.deploymentEventBridge.createTargetHealthEventRule({
        targetGroupArn,
        deploymentId,
      });

      // 배포 상태를 헬스체크 대기 중으로 업데이트
      await this.updateDeploymentStatus(
        deploymentId,
        DeploymentStatus.WAITING_HEALTH_CHECK,
        {
          metadata: {
            targetGroupArn,
            healthCheckRuleCreated: true,
          },
        },
      );

      this.logger.log(
        `✅ Target health tracking setup completed for deployment: ${deploymentId}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to setup target health tracking for deployment ${deploymentId}: ${error}`,
      );

      await this.updateDeploymentStatus(deploymentId, DeploymentStatus.FAILED, {
        errorMessage: `Target health tracking setup failed: ${error instanceof Error ? error.message : String(error)}`,
      });

      throw error;
    }
  }

  /**
   * 배포 완료 처리
   */
  async completeDeployment(
    deploymentId: string,
    success: boolean,
    finalUrl?: string,
  ): Promise<void> {
    try {
      const finalStatus = success
        ? DeploymentStatus.SUCCESS
        : DeploymentStatus.FAILED;

      // 최종 상태 업데이트
      await this.updateDeploymentStatus(deploymentId, finalStatus, {
        deployUrl: finalUrl,
        metadata: {
          completedAt: new Date().toISOString(),
          finalUrl,
        },
      });

      // EventBridge 규칙 정리
      await this.deploymentEventBridge.cleanupDeploymentEventRules(
        deploymentId,
      );

      // 배포 완료 이벤트 발생
      this.eventEmitter.emit('deployment.completed', {
        deploymentId,
        success,
        finalUrl,
      });

      this.logger.log(
        `🎉 Deployment ${deploymentId} completed: ${success ? 'SUCCESS' : 'FAILED'}`,
      );

      if (finalUrl) {
        this.logger.log(`🌐 Deployment URL: ${finalUrl}`);
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to complete deployment ${deploymentId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * 배포 진행 상황 조회
   */
  async getDeploymentProgress(
    deploymentId: string,
  ): Promise<Deployment | null> {
    return await this.deploymentRepository.findOne({
      where: { deploymentId },
      relations: ['pipeline', 'project'],
    });
  }

  /**
   * 사용자별 최근 배포 목록 조회
   */
  async getRecentDeployments(
    userId: string,
    limit: number = 10,
  ): Promise<Deployment[]> {
    return await this.deploymentRepository.find({
      where: { userId },
      relations: ['pipeline', 'project'],
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 진행 상황을 WebSocket으로 브로드캐스트
   */
  private broadcastProgress(
    deploymentId: string,
    progress: Omit<DeploymentProgress, 'deploymentId' | 'timestamp'>,
  ): void {
    const fullProgress: DeploymentProgress = {
      deploymentId,
      timestamp: new Date(),
      ...progress,
    };

    // WebSocket으로 실시간 전송
    this.logsGateway.server
      .to(`deployment:${deploymentId}`)
      .emit('deployment:progress', fullProgress);

    // 글로벌 배포 상태 채널에도 전송 (대시보드용)
    this.logsGateway.server.to('deployments:global').emit('deployment:status', {
      deploymentId,
      status: progress.status,
      step: progress.step,
      timestamp: fullProgress.timestamp,
    });

    this.logger.debug(
      `📡 Broadcasted deployment progress: ${deploymentId} - ${progress.status}`,
    );
  }

  /**
   * 상태에서 단계명 추출
   */
  private getStepFromStatus(status: DeploymentStatus): string {
    const stepMap: Record<DeploymentStatus, string> = {
      [DeploymentStatus.PENDING]: 'initialization',
      [DeploymentStatus.IN_PROGRESS]: 'deployment',
      [DeploymentStatus.DEPLOYING_ECS]: 'ecs-deployment',
      [DeploymentStatus.CONFIGURING_ALB]: 'alb-configuration',
      [DeploymentStatus.WAITING_HEALTH_CHECK]: 'health-check',
      [DeploymentStatus.SUCCESS]: 'completed',
      [DeploymentStatus.FAILED]: 'failed',
      [DeploymentStatus.ROLLED_BACK]: 'rollback',
    };
    return stepMap[status] || 'unknown';
  }

  /**
   * 상태에서 메시지 추출
   */
  private getMessageFromStatus(status: DeploymentStatus): string {
    const messageMap: Record<DeploymentStatus, string> = {
      [DeploymentStatus.PENDING]: '배포 준비 중...',
      [DeploymentStatus.IN_PROGRESS]: '배포 진행 중...',
      [DeploymentStatus.DEPLOYING_ECS]: 'ECS 서비스 배포 중...',
      [DeploymentStatus.CONFIGURING_ALB]: 'ALB 설정 중...',
      [DeploymentStatus.WAITING_HEALTH_CHECK]: '헬스체크 대기 중...',
      [DeploymentStatus.SUCCESS]: '배포가 성공적으로 완료되었습니다! 🎉',
      [DeploymentStatus.FAILED]: '배포에 실패했습니다. ❌',
      [DeploymentStatus.ROLLED_BACK]: '배포가 롤백되었습니다.',
    };
    return messageMap[status] || '상태 알 수 없음';
  }
}
