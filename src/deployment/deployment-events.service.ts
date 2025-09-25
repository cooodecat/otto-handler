import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeploymentTrackerService } from './deployment-tracker.service';
import {
  Deployment,
  DeploymentStatus,
} from '../database/entities/deployment.entity';

// ECS 이벤트 인터페이스
export interface EcsEventBridgeEvent {
  id: string;
  version: string;
  account: string;
  time: string;
  region: string;
  source: string;
  resources: string[];
  'detail-type': string;
  detail: EcsServiceDetail | EcsTaskDetail;
}

export interface EcsServiceDetail {
  eventName: string;
  eventType: 'SERVICE_TASK_DEFINITION_UPDATED' | 'SERVICE_STEADY_STATE';
  clusterArn: string;
  serviceName: string;
  serviceArn: string;
  taskDefinitionArn?: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  platformVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface EcsTaskDetail {
  clusterArn: string;
  taskArn: string;
  taskDefinitionArn: string;
  group: string; // e.g., "service:otto-service-xxx"
  lastStatus: 'PENDING' | 'RUNNING' | 'STOPPED';
  desiredStatus: 'RUNNING' | 'STOPPED';
  startedAt?: string;
  stoppedAt?: string;
  stoppedReason?: string;
  exitCode?: number;
  connectivity: 'CONNECTED' | 'DISCONNECTED';
  connectivityAt?: string;
  pullStartedAt?: string;
  pullStoppedAt?: string;
  executionStoppedAt?: string;
  createdAt: string;
  updatedAt?: string;
  version: number;
}

// ALB 타겟 헬스 이벤트 인터페이스
export interface AlbTargetHealthEvent {
  id: string;
  version: string;
  account: string;
  time: string;
  region: string;
  source: string;
  resources: string[];
  'detail-type': string;
  detail: {
    targetGroupArn: string;
    target: {
      id: string; // IP 주소
      port: number;
      availabilityZone?: string;
    };
    state: 'healthy' | 'unhealthy' | 'unavailable' | 'draining';
    stateTransitionReason?: string;
    timestamp: string;
  };
}

@Injectable()
export class DeploymentEventsService {
  private readonly logger = new Logger(DeploymentEventsService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepository: Repository<Deployment>,
    private readonly deploymentTracker: DeploymentTrackerService,
  ) {}

  /**
   * ECS 서비스 상태 변경 이벤트 처리
   */
  async handleEcsServiceStateChange(event: EcsEventBridgeEvent): Promise<void> {
    const { detail } = event;
    const serviceDetail = detail as EcsServiceDetail;

    this.logger.log(
      `📦 ECS Service State Change: ${serviceDetail.serviceName} - ${serviceDetail.eventType}`,
    );

    try {
      // 서비스명으로 해당 배포 찾기
      const deployment = await this.findDeploymentByServiceName(
        serviceDetail.serviceName,
      );

      if (!deployment) {
        this.logger.warn(
          `No active deployment found for service: ${serviceDetail.serviceName}`,
        );
        return;
      }

      this.logger.log(
        `Found deployment ${deployment.deploymentId} for service ${serviceDetail.serviceName}`,
      );

      // ECS 서비스 이벤트 타입별 처리
      switch (serviceDetail.eventType) {
        case 'SERVICE_TASK_DEFINITION_UPDATED':
          await this.handleServiceTaskDefinitionUpdated(
            deployment,
            serviceDetail,
          );
          break;

        case 'SERVICE_STEADY_STATE':
          await this.handleServiceSteadyState(deployment, serviceDetail);
          break;

        default:
          this.logger.debug(
            `Unknown ECS service event type: ${String(serviceDetail.eventType ?? 'undefined')}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process ECS service state change: ${error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * ECS 태스크 상태 변경 이벤트 처리
   */
  async handleEcsTaskStateChange(event: EcsEventBridgeEvent): Promise<void> {
    const { detail } = event;
    const taskDetail = detail as EcsTaskDetail;

    this.logger.log(
      `📋 ECS Task State Change: ${taskDetail.group} - ${taskDetail.lastStatus}`,
    );

    try {
      // 태스크 그룹에서 서비스명 추출 (e.g., "service:otto-service-xxx")
      const serviceName = this.extractServiceNameFromTaskGroup(
        taskDetail.group,
      );

      if (!serviceName) {
        this.logger.warn(
          `Cannot extract service name from task group: ${taskDetail.group}`,
        );
        return;
      }

      // 서비스명으로 해당 배포 찾기
      const deployment = await this.findDeploymentByServiceName(serviceName);

      if (!deployment) {
        this.logger.warn(
          `No active deployment found for service: ${serviceName}`,
        );
        return;
      }

      this.logger.log(
        `Found deployment ${deployment.deploymentId} for task ${taskDetail.taskArn}`,
      );

      // ECS 태스크 상태별 처리
      await this.handleTaskStatusUpdate(deployment, taskDetail);
    } catch (error) {
      this.logger.error(
        `Failed to process ECS task state change: ${error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * ALB 타겟 헬스 상태 변경 이벤트 처리
   */
  async handleAlbTargetHealthStateChange(
    event: AlbTargetHealthEvent,
  ): Promise<void> {
    const { detail } = event;

    this.logger.log(
      `🎯 ALB Target Health Change: ${detail.target.id}:${detail.target.port} - ${detail.state}`,
    );

    try {
      // 타겟 그룹 ARN으로 해당 배포 찾기
      const deployment = await this.findDeploymentByTargetGroup(
        detail.targetGroupArn,
      );

      if (!deployment) {
        this.logger.warn(
          `No active deployment found for target group: ${detail.targetGroupArn}`,
        );
        return;
      }

      this.logger.log(
        `Found deployment ${deployment.deploymentId} for target group ${detail.targetGroupArn}`,
      );

      // 타겟 상태별 처리
      switch (detail.state) {
        case 'healthy':
          await this.handleTargetHealthy(deployment, detail);
          break;

        case 'unhealthy':
          await this.handleTargetUnhealthy(deployment, detail);
          break;

        case 'draining':
          this.logger.log(
            `Target is draining: ${detail.target.id}:${detail.target.port}`,
          );
          break;

        case 'unavailable':
          this.logger.warn(
            `Target is unavailable: ${detail.target.id}:${detail.target.port}`,
          );
          break;

        default:
          this.logger.debug(
            `Unknown target health state: ${String(detail.state ?? 'undefined')}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process ALB target health state change: ${error}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * 서비스 태스크 정의 업데이트 처리
   */
  private async handleServiceTaskDefinitionUpdated(
    deployment: Deployment,
    serviceDetail: EcsServiceDetail,
  ): Promise<void> {
    this.logger.log(
      `🔄 Service task definition updated: ${serviceDetail.serviceName}`,
    );

    await this.deploymentTracker.updateDeploymentStatus(
      deployment.deploymentId,
      DeploymentStatus.DEPLOYING_ECS,
      {
        metadata: {
          ...deployment.metadata,
          taskDefinitionArn: serviceDetail.taskDefinitionArn,
          desiredCount: serviceDetail.desiredCount,
          runningCount: serviceDetail.runningCount,
          pendingCount: serviceDetail.pendingCount,
        },
      },
    );
  }

  /**
   * 서비스 안정 상태 도달 처리
   */
  private async handleServiceSteadyState(
    deployment: Deployment,
    serviceDetail: EcsServiceDetail,
  ): Promise<void> {
    this.logger.log(
      `🎯 Service reached steady state: ${serviceDetail.serviceName}`,
    );

    // 서비스가 안정 상태에 도달하면 ALB 구성 단계로 이동
    await this.deploymentTracker.updateDeploymentStatus(
      deployment.deploymentId,
      DeploymentStatus.CONFIGURING_ALB,
      {
        metadata: {
          ...deployment.metadata,
          steadyStateReached: true,
          steadyStateAt: new Date().toISOString(),
          runningCount: serviceDetail.runningCount,
        },
      },
    );
  }

  /**
   * 태스크 상태 업데이트 처리
   */
  private async handleTaskStatusUpdate(
    deployment: Deployment,
    taskDetail: EcsTaskDetail,
  ): Promise<void> {
    const taskStatus = `${taskDetail.lastStatus}/${taskDetail.desiredStatus}`;

    this.logger.log(
      `📋 Task status update: ${taskDetail.taskArn} - ${taskStatus}`,
    );

    // 태스크가 실행 중이 되면 메타데이터 업데이트
    if (taskDetail.lastStatus === 'RUNNING') {
      await this.deploymentTracker.updateDeploymentStatus(
        deployment.deploymentId,
        deployment.status, // 상태는 그대로 유지
        {
          metadata: {
            ...deployment.metadata,
            runningTasks: [
              ...(Array.isArray(deployment.metadata?.runningTasks)
                ? (deployment.metadata.runningTasks as Array<{
                    taskArn: string;
                    startedAt?: string;
                    connectivity: string;
                  }>)
                : []),
              {
                taskArn: taskDetail.taskArn,
                startedAt: taskDetail.startedAt,
                connectivity: taskDetail.connectivity,
              },
            ],
          },
        },
      );
    }

    // 태스크가 중지되면 오류 체크
    if (taskDetail.lastStatus === 'STOPPED' && taskDetail.exitCode !== 0) {
      this.logger.warn(
        `Task stopped with non-zero exit code: ${taskDetail.taskArn} - Exit: ${taskDetail.exitCode}, Reason: ${taskDetail.stoppedReason}`,
      );

      await this.deploymentTracker.updateDeploymentStatus(
        deployment.deploymentId,
        deployment.status, // 즉시 실패로 전환하지 않고 모니터링
        {
          metadata: {
            ...deployment.metadata,
            stoppedTasks: [
              ...(Array.isArray(deployment.metadata?.stoppedTasks)
                ? (deployment.metadata.stoppedTasks as Array<{
                    taskArn: string;
                    exitCode?: number;
                    stoppedReason?: string;
                    stoppedAt?: string;
                  }>)
                : []),
              {
                taskArn: taskDetail.taskArn,
                exitCode: taskDetail.exitCode,
                stoppedReason: taskDetail.stoppedReason,
                stoppedAt: taskDetail.stoppedAt,
              },
            ],
          },
        },
      );
    }
  }

  /**
   * 타겟 헬시 상태 처리
   */
  private async handleTargetHealthy(
    deployment: Deployment,
    targetDetail: AlbTargetHealthEvent['detail'],
  ): Promise<void> {
    this.logger.log(
      `💚 Target became healthy: ${targetDetail.target.id}:${targetDetail.target.port}`,
    );

    // 첫 번째 타겟이 healthy가 되면 배포 성공으로 간주
    if (deployment.status === DeploymentStatus.WAITING_HEALTH_CHECK) {
      this.logger.log(
        `🎉 First target is healthy, deployment ${deployment.deploymentId} is successful!`,
      );

      await this.deploymentTracker.completeDeployment(
        deployment.deploymentId,
        true,
        deployment.deployUrl || undefined,
      );
    } else {
      // 추가 타겟의 healthy 상태는 메타데이터만 업데이트
      await this.deploymentTracker.updateDeploymentStatus(
        deployment.deploymentId,
        deployment.status,
        {
          metadata: {
            ...deployment.metadata,
            healthyTargets: [
              ...(Array.isArray(deployment.metadata?.healthyTargets)
                ? (deployment.metadata.healthyTargets as Array<{
                    id: string;
                    port: number;
                    healthyAt: string;
                  }>)
                : []),
              {
                id: targetDetail.target.id,
                port: targetDetail.target.port,
                healthyAt: targetDetail.timestamp,
              },
            ],
          },
        },
      );
    }
  }

  /**
   * 타겟 언헬시 상태 처리
   */
  private async handleTargetUnhealthy(
    deployment: Deployment,
    targetDetail: AlbTargetHealthEvent['detail'],
  ): Promise<void> {
    this.logger.warn(
      `💔 Target became unhealthy: ${targetDetail.target.id}:${targetDetail.target.port} - ${targetDetail.stateTransitionReason}`,
    );

    await this.deploymentTracker.updateDeploymentStatus(
      deployment.deploymentId,
      deployment.status,
      {
        metadata: {
          ...deployment.metadata,
          unhealthyTargets: [
            ...(Array.isArray(deployment.metadata?.unhealthyTargets)
              ? (deployment.metadata.unhealthyTargets as Array<{
                  id: string;
                  port: number;
                  reason?: string;
                  unhealthyAt: string;
                }>)
              : []),
            {
              id: targetDetail.target.id,
              port: targetDetail.target.port,
              reason: targetDetail.stateTransitionReason,
              unhealthyAt: targetDetail.timestamp,
            },
          ],
        },
      },
    );

    // 헬스체크 실패가 지속되면 배포 실패로 처리하는 로직도 추가할 수 있음
    // (예: unhealthyTargets가 일정 수 이상이거나 일정 시간 지속)
  }

  /**
   * 서비스명으로 활성 배포 찾기
   */
  private async findDeploymentByServiceName(
    serviceName: string,
  ): Promise<Deployment | null> {
    // 서비스명에서 deploymentId 또는 pipelineId 추출 시도
    // 예: "service-{pipelineId}" 또는 "otto-service-{deploymentId}"

    let deployment: Deployment | null = null;

    // 패턴 1: service-{pipelineId}
    const servicePattern1 = serviceName.match(/^service-(.+)$/);
    if (servicePattern1) {
      const pipelineId = servicePattern1[1];
      deployment = await this.deploymentRepository
        .createQueryBuilder('deployment')
        .where('deployment.pipelineId = :pipelineId', { pipelineId })
        .andWhere('deployment.status IN (:...activeStatuses)', {
          activeStatuses: [
            DeploymentStatus.PENDING,
            DeploymentStatus.IN_PROGRESS,
            DeploymentStatus.DEPLOYING_ECS,
            DeploymentStatus.CONFIGURING_ALB,
            DeploymentStatus.WAITING_HEALTH_CHECK,
          ],
        })
        .orderBy('deployment.createdAt', 'DESC')
        .getOne();
    }

    // 패턴 2: ECS 서비스 ARN에서 매칭
    if (!deployment) {
      deployment = await this.deploymentRepository
        .createQueryBuilder('deployment')
        .where('deployment.ecsServiceArn LIKE :serviceName', {
          serviceName: `%${serviceName}%`,
        })
        .andWhere('deployment.status IN (:...activeStatuses)', {
          activeStatuses: [
            DeploymentStatus.PENDING,
            DeploymentStatus.IN_PROGRESS,
            DeploymentStatus.DEPLOYING_ECS,
            DeploymentStatus.CONFIGURING_ALB,
            DeploymentStatus.WAITING_HEALTH_CHECK,
          ],
        })
        .orderBy('deployment.createdAt', 'DESC')
        .getOne();
    }

    return deployment;
  }

  /**
   * 타겟 그룹 ARN으로 활성 배포 찾기
   */
  private async findDeploymentByTargetGroup(
    targetGroupArn: string,
  ): Promise<Deployment | null> {
    return await this.deploymentRepository
      .createQueryBuilder('deployment')
      .where('deployment.targetGroupArn = :targetGroupArn', { targetGroupArn })
      .andWhere('deployment.status IN (:...activeStatuses)', {
        activeStatuses: [
          DeploymentStatus.CONFIGURING_ALB,
          DeploymentStatus.WAITING_HEALTH_CHECK,
        ],
      })
      .orderBy('deployment.createdAt', 'DESC')
      .getOne();
  }

  /**
   * 태스크 그룹에서 서비스명 추출
   */
  private extractServiceNameFromTaskGroup(group: string): string | null {
    // "service:serviceName" 형태에서 serviceName 추출
    const match = group.match(/^service:(.+)$/);
    return match ? match[1] : null;
  }
}
