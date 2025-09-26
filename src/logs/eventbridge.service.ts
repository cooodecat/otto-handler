import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RedisService } from '../common/redis/redis.service';
import { LogsGateway } from './logs.gateway';
import {
  Execution,
  ExecutionStatus,
  ExecutionType,
} from '../database/entities/execution.entity';
import { LogsService } from './logs.service';
import { ConfigService } from '@nestjs/config';
import { LogStorageService } from './services/log-storage/log-storage.service';
import { LogLevel } from '../database/entities/execution-log.entity';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { Pipeline } from '../database/entities/pipeline.entity';
import { PipelineService } from '../pipeline/pipeline.service';
import { DeploymentTrackerService } from '../deployment/deployment-tracker.service';
import {
  Deployment,
  DeploymentStatus,
} from '../database/entities/deployment.entity';

export interface EventBridgeEvent {
  id: string;
  version: string;
  account: string;
  time: string;
  region: string;
  source: string;
  resources: string[];
  'detail-type': string;
  detail: CodeBuildDetail | EcsDetail | AlbDetail;
}

export interface CodeBuildDetail {
  'build-status': 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'STOPPED';
  'build-id': string;
  'project-name': string;
  'current-phase'?: string;
  'current-phase-context'?: string;
  'additional-information'?: {
    'build-complete'?: boolean;
    'build-number'?: number;
    initiator?: string;
    'start-time'?: string;
    'end-time'?: string;
    environment?: {
      'environment-variables'?: Array<{
        name: string;
        value: string;
        type?: string;
      }>;
    };
    logs?: {
      'group-name'?: string;
      'stream-name'?: string;
      'deep-link'?: string;
    };
  };
}

export interface EcsDetail {
  // Service 관련 필드
  eventName?: string;
  eventType?:
    | 'SERVICE_DEPLOYMENT_COMPLETED'
    | 'SERVICE_DEPLOYMENT_IN_PROGRESS'
    | 'SERVICE_DEPLOYMENT_FAILED'
    | 'SERVICE_TASK_DEFINITION_UPDATED'
    | 'SERVICE_STEADY_STATE';
  serviceName?: string;
  serviceArn?: string;
  desiredCount?: number;
  runningCount?: number;
  pendingCount?: number;
  deploymentId?: string;

  // Task 관련 필드
  clusterArn: string;
  taskArn?: string;
  taskDefinitionArn?: string;
  lastStatus?:
    | 'PENDING'
    | 'ACTIVATING'
    | 'RUNNING'
    | 'STOPPING'
    | 'STOPPED'
    | 'DEPROVISIONING';
  desiredStatus?: 'RUNNING' | 'STOPPED';
  startedAt?: string;
  stoppedAt?: string;
  stoppedReason?: string;
  stopCode?: string;
  executionStoppedAt?: string;
  stoppingAt?: string;
  exitCode?: number;
  connectivity?: 'CONNECTED' | 'DISCONNECTED';
  connectivityAt?: string;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  group?: string; // e.g., "service:otto-service-xxx"

  // Task 세부 정보
  cpu?: string;
  memory?: string;
  availabilityZone?: string;
  launchType?: string;
  platformVersion?: string;
  pullStartedAt?: string;
  pullStoppedAt?: string;
  containers?: Array<{
    name: string;
    lastStatus: string;
    exitCode?: number;
    image?: string;
    imageDigest?: string;
    runtimeId?: string;
    taskArn?: string;
    networkInterfaces?: Array<{
      attachmentId: string;
      privateIpv4Address: string;
    }>;
    cpu?: string;
  }>;
}

export interface AlbDetail {
  targetGroupArn: string;
  target: {
    id: string; // IP 주소
    port: number;
    availabilityZone?: string;
  };
  state: 'healthy' | 'unhealthy' | 'unavailable' | 'draining';
  stateTransitionReason?: string;
  timestamp: string;
}

@Injectable()
export class EventBridgeService {
  private readonly logger = new Logger(EventBridgeService.name);
  private readonly useEventBridge: boolean;

  constructor(
    private readonly redisService: RedisService,
    private readonly logsGateway: LogsGateway,
    private readonly logsService: LogsService,
    private readonly configService: ConfigService,
    private readonly logStorage: LogStorageService,
    private readonly cloudwatchService: CloudwatchService,
    @Inject(forwardRef(() => PipelineService))
    private readonly pipelineService: PipelineService,
    @InjectRepository(Execution)
    private executionRepository: Repository<Execution>,
    @InjectRepository(Pipeline)
    private pipelineRepository: Repository<Pipeline>,
    @InjectRepository(Deployment)
    private deploymentRepository: Repository<Deployment>,
    @Inject(forwardRef(() => DeploymentTrackerService))
    private deploymentTrackerService: DeploymentTrackerService,
  ) {
    const envValue = this.configService.get<string>('USE_EVENTBRIDGE', 'false');
    this.useEventBridge = envValue === 'true';
    this.logger.log(
      `EventBridge integration: ${this.useEventBridge ? 'Enabled' : 'Disabled'} (USE_EVENTBRIDGE=${envValue})`,
    );
  }

  async checkDuplicate(eventId: string): Promise<boolean> {
    try {
      const isNew = await this.redisService.checkDuplicate(eventId);
      if (!isNew) {
        this.logger.debug(`Duplicate event detected: ${eventId}`);
      }
      return isNew;
    } catch (error) {
      this.logger.error(
        `Failed to check duplicate for event ${eventId}:`,
        error,
      );
      return true;
    }
  }

  async processEvent(event: EventBridgeEvent): Promise<void> {
    const { id: eventId, source } = event;

    try {
      // 이벤트 ID로 중복 체크 (네트워크 재시도 방지)
      const isDuplicate = !(await this.checkDuplicate(eventId));
      if (isDuplicate) {
        this.logger.debug(`Skipping duplicate event: ${eventId}`);
        return;
      }

      await this.redisService.saveEventHistory(eventId, event);

      // 소스별로 이벤트 처리 분기
      if (source === 'aws.codebuild') {
        await this.processCodeBuildEvent(event);
      } else if (source === 'aws.ecs') {
        this.processEcsEvent(event);
      } else if (source === 'aws.elasticloadbalancing') {
        this.processAlbEvent(event);
      } else {
        this.logger.warn(`Unsupported event source: ${source}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process EventBridge event ${eventId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * CodeBuild 이벤트 처리
   */
  private async processCodeBuildEvent(event: EventBridgeEvent): Promise<void> {
    const { id: eventId, detail } = event;
    const codeBuildDetail = detail as CodeBuildDetail;

    const buildId = codeBuildDetail['build-id'];
    const buildStatus = codeBuildDetail['build-status'];
    const projectName = codeBuildDetail['project-name'];

    this.logger.log(
      `Processing CodeBuild event: ${eventId}, Build: ${buildId}, Status: ${buildStatus}`,
    );

    // Debug: Check if this is a Phase Change event
    if (
      !buildStatus &&
      event['detail-type'] === 'CodeBuild Build Phase Change'
    ) {
      // Use proper type casting for phase change events
      interface PhaseChangeDetail extends CodeBuildDetail {
        'current-phase'?: string;
        'completed-phase'?: string;
        'current-phase-status'?: string;
        'completed-phase-status'?: string;
      }
      const phaseDetail = codeBuildDetail as PhaseChangeDetail;
      const phase =
        phaseDetail['current-phase'] || phaseDetail['completed-phase'] || '';
      const phaseStatus =
        phaseDetail['current-phase-status'] ||
        phaseDetail['completed-phase-status'] ||
        '';
      this.logger.log(
        `Phase change event - Phase: ${phase}, Status: ${phaseStatus}`,
      );

      // Phase change 이벤트에서도 execution 찾아서 CloudWatch 폴링 확인
      const phaseExecution = await this.findExecutionByBuildId(buildId);
      if (
        phaseExecution &&
        !this.cloudwatchService.isPolling(phaseExecution.executionId)
      ) {
        this.logger.log(
          `Starting CloudWatch polling for phase change event - Execution: ${phaseExecution.executionId}`,
        );
        try {
          await this.cloudwatchService.startPolling(phaseExecution);
        } catch (error) {
          this.logger.error(
            `Failed to start CloudWatch polling: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      // Phase 정보를 WebSocket으로 전송
      if (phaseExecution) {
        const phaseEvent = {
          executionId: phaseExecution.executionId,
          type: 'phase-change',
          phase: String(phase || ''),
          status: String(phaseStatus || ''),
          timestamp: new Date().toISOString(),
        };
        this.logsGateway.server
          .to(`execution:${phaseExecution.executionId}`)
          .emit('phase:update', phaseEvent);
      }

      return;
    }

    // buildId로 기존 실행 찾기 - 동일한 빌드의 연속된 이벤트는 같은 execution 사용
    let execution = await this.findExecutionByBuildId(buildId);

    if (!execution) {
      if (buildStatus === 'IN_PROGRESS') {
        // buildId에서 UUID 추출하여 executionId로 사용된 execution이 있는지 확인
        const executionId = buildId.split(':').pop();
        execution = await this.executionRepository.findOne({
          where: { executionId },
        });

        if (execution) {
          // CodeBuild 서비스에서 이미 생성한 execution이 있으면 awsBuildId와 logStreamName 업데이트
          this.logger.log(
            `Found pre-created execution ${executionId}, updating build info and starting CloudWatch polling`,
          );

          // logStreamName이 없으면 설정
          if (!execution.logStreamName) {
            execution.logStreamName = executionId;
          }

          execution.awsBuildId = buildId;
          await this.executionRepository.save(execution);

          // CloudWatch 폴링 시작
          try {
            this.logger.log(
              `Attempting to start CloudWatch polling for execution ${executionId}`,
            );
            await this.cloudwatchService.startPolling(execution);
            this.logger.log(
              `Successfully started CloudWatch polling for existing execution ${executionId}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to start CloudWatch polling for ${executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              error instanceof Error ? error.stack : undefined,
            );
          }
        } else {
          // 정말로 새로운 execution이면 생성
          await this.createNewExecution(buildId, projectName, event);
          return;
        }
      } else {
        this.logger.warn(
          `No execution found for build ${buildId}, status: ${buildStatus}`,
        );
        return;
      }
    }

    await this.updateExecutionStatus(execution, buildStatus, codeBuildDetail);

    // EventBridge 상태 변경 이벤트는 로그로 저장하지 않음
    // CloudWatch 폴링을 통해 실제 빌드 로그를 가져옴

    // Status 변경만 WebSocket으로 브로드캐스트
    const statusEvent = {
      executionId: execution.executionId,
      type: 'status-change',
      status: buildStatus,
      timestamp: new Date().toISOString(),
    };
    this.broadcastStatusEvent(execution.executionId, statusEvent);
    const logEvent = this.createLogEvent(execution, event, codeBuildDetail);
    this.broadcastLogEvent(execution.executionId, logEvent);

    if (
      buildStatus === 'SUCCEEDED' ||
      buildStatus === 'FAILED' ||
      buildStatus === 'STOPPED'
    ) {
      await this.finalizeExecution(execution, buildStatus);
    }
  }

  /**
   * ECS 이벤트 처리 (배포 관련)
   */
  private processEcsEvent(event: EventBridgeEvent): void {
    const { id: eventId, 'detail-type': detailType } = event;
    const ecsDetail = event.detail as EcsDetail;

    this.logger.log(
      `Processing ECS event: ${eventId}, Type: ${detailType}, Service: ${ecsDetail.serviceName}`,
    );

    // DeploymentEventsService에서 처리하도록 위임
    // const { DeploymentEventsService } = await import(
    //   '../deployment/deployment-events.service'
    // );

    // 현재 서비스 인스턴스가 아닌 별도 처리가 필요한 경우
    // deployment 모듈의 DeploymentEventsService를 직접 호출

    if (detailType === 'ECS Service State Change') {
      this.logger.log(
        `Delegating ECS Service State Change to DeploymentEventsService`,
      );
      // TODO: DeploymentEventsService.handleEcsServiceStateChange 호출
    } else if (detailType === 'ECS Task State Change') {
      // group에서 서비스명 추출: "service:otto-0fcfb499-c0d2-4eae-b560-3453c9408d8c"
      const serviceName = ecsDetail.group?.startsWith('service:')
        ? ecsDetail.group.substring('service:'.length)
        : ecsDetail.group || 'unknown';

      // 컨테이너 정보 추출
      const containers = ecsDetail.containers || [];
      const appContainer =
        containers.find((c) => c.name === 'app') || containers[0];

      this.logger.log(`📦 ===============================================`);
      this.logger.log(`📦 🔄 ECS 태스크 상태 변경 🔄`);
      this.logger.log(`📦 ===============================================`);
      this.logger.log(`🏷️ 서비스: ${serviceName}`);
      this.logger.log(`🏗️ 클러스터: ${ecsDetail.clusterArn?.split('/').pop()}`);
      this.logger.log(`📋 태스크 ARN: ${ecsDetail.taskArn?.split('/').pop()}`);
      this.logger.log(
        `📋 태스크 정의: ${ecsDetail.taskDefinitionArn?.split('/').pop()}`,
      );
      this.logger.log(`🌍 가용 영역: ${ecsDetail.availabilityZone}`);

      if (ecsDetail.lastStatus === 'RUNNING') {
        this.logger.log(`🟢 ===============================================`);
        this.logger.log(`🟢 ✅ 태스크가 실행 중입니다! ✅`);
        this.logger.log(`🟢 ===============================================`);
        this.logger.log(
          `✅ 태스크 상태: ${ecsDetail.lastStatus} → ${ecsDetail.desiredStatus}`,
        );
        this.logger.log(`✅ 연결 상태: ${ecsDetail.connectivity || 'N/A'}`);
        this.logger.log(
          `✅ CPU: ${ecsDetail.cpu}, 메모리: ${ecsDetail.memory}`,
        );
        if (appContainer) {
          this.logger.log(`✅ 컨테이너 상태: ${appContainer.lastStatus}`);
          this.logger.log(`✅ 이미지: ${appContainer.image?.split('/').pop()}`);
        }
        this.logger.log(`🟢 ===============================================`);

        // 🎯 배포를 SUCCESS로 업데이트
        void this.updateDeploymentToSuccess(serviceName);
      } else if (
        ecsDetail.lastStatus === 'STOPPED' ||
        ecsDetail.lastStatus === 'DEPROVISIONING'
      ) {
        this.logger.error(`🔴 ===============================================`);
        this.logger.error(`🔴 ❌ 태스크가 중지되었습니다! ❌`);
        this.logger.error(`🔴 ===============================================`);
        this.logger.error(`❌ 태스크 상태: ${ecsDetail.lastStatus}`);
        this.logger.error(`❌ 원하는 상태: ${ecsDetail.desiredStatus}`);
        this.logger.error(
          `❌ 중지 이유: ${ecsDetail.stoppedReason || '알 수 없음'}`,
        );
        this.logger.error(`❌ 중지 코드: ${ecsDetail.stopCode || 'N/A'}`);

        if (appContainer) {
          this.logger.error(`❌ 컨테이너 상태: ${appContainer.lastStatus}`);
          this.logger.error(`❌ 종료 코드: ${appContainer.exitCode || 'N/A'}`);
          this.logger.error(
            `❌ 이미지: ${appContainer.image?.split('/').pop()}`,
          );
        }

        this.logger.error(
          `❌ 실행 시간: ${ecsDetail.createdAt} ~ ${ecsDetail.executionStoppedAt || ecsDetail.stoppingAt || 'N/A'}`,
        );
        this.logger.error(
          `🔴 Circuit Breaker가 새로운 태스크 시작을 시도할 것입니다.`,
        );
        this.logger.error(`🔴 ===============================================`);
      } else {
        this.logger.log(`🟡 ===============================================`);
        this.logger.log(`🟡 🔄 태스크 상태 변경: ${ecsDetail.lastStatus} 🔄`);
        this.logger.log(`🟡 ===============================================`);
        this.logger.log(`🔄 현재 상태: ${ecsDetail.lastStatus}`);
        this.logger.log(`🔄 목표 상태: ${ecsDetail.desiredStatus}`);
        if (ecsDetail.pullStartedAt && ecsDetail.pullStoppedAt) {
          const pullDuration =
            new Date(ecsDetail.pullStoppedAt).getTime() -
            new Date(ecsDetail.pullStartedAt).getTime();
          this.logger.log(
            `🔄 이미지 풀 시간: ${Math.round(pullDuration / 1000)}초`,
          );
        }
        this.logger.log(`🟡 ===============================================`);
      }

      this.logger.log(
        `Delegating ECS Task State Change to DeploymentEventsService`,
      );
      // TODO: DeploymentEventsService.handleEcsTaskStateChange 호출
    } else if (detailType === 'ECS Deployment State Change') {
      this.logger.log(`🎉 ECS Deployment State Change: ${ecsDetail.eventType}`);

      // 공통 배포 정보 로깅
      this.logger.log(`📋 배포 세부 정보:`);
      this.logger.log(`   🏷️  서비스명: ${ecsDetail.serviceName}`);
      this.logger.log(
        `   🏗️  클러스터: ${ecsDetail.clusterArn?.split('/').pop()}`,
      );
      this.logger.log(`   🔢 원하는 태스크 수: ${ecsDetail.desiredCount}`);
      this.logger.log(`   ▶️  실행 중인 태스크 수: ${ecsDetail.runningCount}`);
      this.logger.log(`   ⏸️  대기 중인 태스크 수: ${ecsDetail.pendingCount}`);

      if (ecsDetail.eventType === 'SERVICE_DEPLOYMENT_COMPLETED') {
        this.logger.log(`🎊 ===============================================`);
        this.logger.log(`🎊 🎉 배포 완료! 🎉`);
        this.logger.log(`🎊 ===============================================`);
        this.logger.log(`✅ 서비스: ${ecsDetail.serviceName}`);
        this.logger.log(`✅ 상태: 배포 성공적으로 완료됨`);
        this.logger.log(
          `✅ 태스크 정의: ${ecsDetail.taskDefinitionArn?.split('/').pop()}`,
        );
        this.logger.log(`✅ 배포 ID: ${ecsDetail.deploymentId || 'N/A'}`);
        this.logger.log(`✅ 시작 시간: ${ecsDetail.startedAt || 'N/A'}`);

        if (ecsDetail.desiredCount === ecsDetail.runningCount) {
          this.logger.log(`✅ 모든 태스크가 정상적으로 실행 중입니다!`);
        }
        this.logger.log(`🎊 ===============================================`);
      } else if (ecsDetail.eventType === 'SERVICE_DEPLOYMENT_FAILED') {
        this.logger.error(`💥 ===============================================`);
        this.logger.error(`💥 ❌ 배포 실패! ❌`);
        this.logger.error(`💥 ===============================================`);
        this.logger.error(`❌ 서비스: ${ecsDetail.serviceName}`);
        this.logger.error(`❌ 상태: 배포 실패`);
        this.logger.error(
          `❌ 실패 이유: ${ecsDetail.stoppedReason || '알 수 없음'}`,
        );
        this.logger.error(`❌ 종료 코드: ${ecsDetail.exitCode || 'N/A'}`);
        this.logger.error(`❌ 종료 시간: ${ecsDetail.stoppedAt || 'N/A'}`);
        this.logger.error(
          `💥 Circuit Breaker가 자동 롤백을 수행했을 수 있습니다.`,
        );
        this.logger.error(`💥 ===============================================`);
      } else if (ecsDetail.eventType === 'SERVICE_DEPLOYMENT_IN_PROGRESS') {
        this.logger.log(`⚡ ===============================================`);
        this.logger.log(`⚡ ⏳ 배포 진행 중... ⏳`);
        this.logger.log(`⚡ ===============================================`);
        this.logger.log(`⏳ 서비스: ${ecsDetail.serviceName}`);
        this.logger.log(
          `⏳ 진행률: ${ecsDetail.runningCount}/${ecsDetail.desiredCount} 태스크 실행 중`,
        );

        const progressPercent = ecsDetail.desiredCount
          ? Math.round(
              ((ecsDetail.runningCount || 0) / ecsDetail.desiredCount) * 100,
            )
          : 0;
        this.logger.log(`⏳ 진행률: ${progressPercent}%`);
        this.logger.log(`⏳ 새 태스크 배포가 진행 중입니다...`);
        this.logger.log(`⚡ ===============================================`);
      }
    }
  }

  /**
   * ALB 이벤트 처리 (헬스체크 관련)
   */
  private processAlbEvent(event: EventBridgeEvent): void {
    const { id: eventId, 'detail-type': detailType } = event;
    const albDetail = event.detail as AlbDetail;

    this.logger.log(`🏥 ALB 헬스체크 이벤트: ${eventId}`);

    if (detailType === 'ELB Target Health State Change') {
      // 헬스체크 상태별 상세 로깅
      const targetInfo = `${albDetail.target.id}:${albDetail.target.port}`;
      const az = albDetail.target.availabilityZone || 'N/A';

      this.logger.log(`🏥 ===============================================`);
      this.logger.log(`🏥 🩺 ALB 타겟 헬스체크 상태 변경 🩺`);
      this.logger.log(`🏥 ===============================================`);
      this.logger.log(`🎯 타겟: ${targetInfo}`);
      this.logger.log(`🌍 가용 영역: ${az}`);
      this.logger.log(`⏰ 시간: ${albDetail.timestamp}`);

      if (albDetail.state === 'healthy') {
        this.logger.log(`💚 ===============================================`);
        this.logger.log(`💚 ✅ 헬스체크 성공! 타겟이 정상 상태입니다! ✅`);
        this.logger.log(`💚 ===============================================`);
        this.logger.log(`✅ 타겟 상태: HEALTHY 🟢`);
        this.logger.log(`✅ 트래픽 라우팅: 활성화됨`);
        this.logger.log(`✅ 서비스 준비: 완료`);
      } else if (albDetail.state === 'unhealthy') {
        this.logger.error(`🔴 ===============================================`);
        this.logger.error(`🔴 ❌ 헬스체크 실패! 타겟이 비정상 상태입니다! ❌`);
        this.logger.error(`🔴 ===============================================`);
        this.logger.error(`❌ 타겟 상태: UNHEALTHY 🔴`);
        this.logger.error(`❌ 트래픽 라우팅: 차단됨`);
        this.logger.error(
          `❌ 실패 이유: ${albDetail.stateTransitionReason || '알 수 없음'}`,
        );
      } else if (albDetail.state === 'draining') {
        this.logger.warn(`🟡 ===============================================`);
        this.logger.warn(`🟡 ⚠️ 타겟 드레이닝 중... ⚠️`);
        this.logger.warn(`🟡 ===============================================`);
        this.logger.warn(`⚠️ 타겟 상태: DRAINING 🟡`);
        this.logger.warn(`⚠️ 기존 연결 종료 중...`);
        this.logger.warn(`⚠️ 새 트래픽 차단됨`);
      } else if (albDetail.state === 'unavailable') {
        this.logger.warn(`⚪ ===============================================`);
        this.logger.warn(`⚪ ⚠️ 타겟 사용 불가 상태 ⚠️`);
        this.logger.warn(`⚪ ===============================================`);
        this.logger.warn(`⚠️ 타겟 상태: UNAVAILABLE ⚪`);
        this.logger.warn(`⚠️ 헬스체크 미실시`);
      }

      this.logger.log(
        `🏥 Target Group ARN: ${albDetail.targetGroupArn.split('/').pop()}`,
      );
      this.logger.log(`🏥 ===============================================`);

      this.logger.log(
        `Delegating ALB Target Health State Change to DeploymentEventsService`,
      );
      // TODO: DeploymentEventsService.handleAlbTargetHealthStateChange 호출
    }
  }

  private async findExecutionByBuildId(
    buildId: string,
  ): Promise<Execution | null> {
    try {
      const execution = await this.executionRepository.findOne({
        where: { awsBuildId: buildId },
        relations: ['project'],
      });
      return execution;
    } catch (error) {
      this.logger.error(
        `Failed to find execution for build ${buildId}:`,
        error,
      );
      return null;
    }
  }

  private async createNewExecution(
    buildId: string,
    projectName: string,
    event: EventBridgeEvent,
  ): Promise<void> {
    try {
      this.logger.log(
        `Creating new execution for build ${buildId}, project: ${projectName}`,
      );

      // Extract metadata from environment variables in build detail
      const codeBuildDetail = event.detail as CodeBuildDetail;
      const additionalInfo = codeBuildDetail['additional-information'];
      const environment = additionalInfo?.environment;

      // 환경변수에서 사용자 컨텍스트 추출
      let projectId = '';
      let userId = '';
      let pipelineId = '';

      if (environment?.['environment-variables']) {
        const envVars = environment['environment-variables'];
        for (const envVar of envVars) {
          if (envVar.name === 'OTTO_USER_ID') {
            userId = envVar.value;
          } else if (envVar.name === 'OTTO_PROJECT_ID') {
            projectId = envVar.value;
          } else if (envVar.name === 'OTTO_PIPELINE_ID') {
            pipelineId = envVar.value;
          } else if (envVar.name === 'PIPELINE_ID') {
            pipelineId = pipelineId || envVar.value; // fallback
          }
        }
      }

      // Fallback: Extract from project name if not found in env vars
      if (!projectId) {
        const parts = projectName.split('-');
        if (parts.length >= 4) {
          projectId = parts[2];
        }
      }

      if (!userId) {
        this.logger.warn(
          `EventBridge execution missing userId context for ${buildId}`,
        );
        userId = 'eventbridge-user'; // Default fallback
      }

      // Extract log stream name from build ID
      const logStreamName = buildId.split(':').pop(); // Get UUID part

      const execution = this.executionRepository.create({
        awsBuildId: buildId,
        status: ExecutionStatus.RUNNING,
        executionType: ExecutionType.BUILD,
        startedAt: new Date(event.time),
        projectId: projectId || 'unknown',
        userId: userId,
        pipelineId: pipelineId || '',
        logStreamName: logStreamName, // CloudWatch 로그 스트림명 설정
        metadata: {
          source: 'eventbridge',
          projectName,
          region: event.region,
          account: event.account,
          logGroup: additionalInfo?.logs?.['group-name'],
          logStream: additionalInfo?.logs?.['stream-name'] || logStreamName,
        },
      });

      await this.executionRepository.save(execution);
      this.logger.log(
        `Created execution ${execution.executionId} for build ${buildId} with logStream ${logStreamName}`,
      );

      // Start CloudWatch polling for actual build logs
      try {
        await this.cloudwatchService.startPolling(execution);
        this.logger.log(
          `Started CloudWatch polling for execution ${execution.executionId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to start CloudWatch polling: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create execution for build ${buildId}:`,
        error,
      );
      throw error;
    }
  }

  private async updateExecutionStatus(
    execution: Execution,
    status: string,
    detail: CodeBuildDetail,
  ): Promise<void> {
    try {
      const statusMap: Record<string, ExecutionStatus> = {
        IN_PROGRESS: ExecutionStatus.RUNNING,
        SUCCEEDED: ExecutionStatus.SUCCESS,
        FAILED: ExecutionStatus.FAILED,
        STOPPED: ExecutionStatus.FAILED,
      };

      const newStatus = statusMap[status] || execution.status;

      const metadata: Record<string, unknown> = {};

      if (detail['current-phase']) {
        metadata.currentPhase = detail['current-phase'];
        metadata.currentPhaseContext = detail['current-phase-context'];
      }

      // EventBridge 이벤트에서 environment variables 추출하여 metadata에 저장
      this.logger.log(
        `🔍 Debug: additional-information 존재 여부: ${!!detail['additional-information']}`,
      );
      this.logger.log(
        `🔍 Debug: environment 존재 여부: ${!!detail['additional-information']?.environment}`,
      );

      const envVars =
        detail['additional-information']?.environment?.[
          'environment-variables'
        ];
      this.logger.log(
        `🔍 Debug: environment-variables 개수: ${envVars ? envVars.length : 0}`,
      );

      if (envVars && Array.isArray(envVars)) {
        // 모든 환경변수 로그 출력
        this.logger.log(`🔍 Debug: 전체 환경변수 목록:`);
        envVars.forEach((v, i) => {
          this.logger.log(`  ${i + 1}. ${v.name} = ${v.value}`);
        });

        const ottoUserId = envVars.find(
          (v) => v.name === 'OTTO_USER_ID',
        )?.value;
        const ottoProjectId = envVars.find(
          (v) => v.name === 'OTTO_PROJECT_ID',
        )?.value;
        const pipelineId = envVars.find((v) => v.name === 'PIPELINE_ID')?.value;

        this.logger.log(
          `🔍 Debug: 추출된 값들 - userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
        );

        if (ottoUserId && ottoProjectId && pipelineId) {
          metadata.ottoUserId = ottoUserId;
          metadata.ottoProjectId = ottoProjectId;
          metadata.pipelineId = pipelineId;
          metadata.projectName = detail['project-name']; // 기존 project name 유지

          this.logger.log(
            `   ✅ Environment Variables 추출 성공: userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
          );
        } else {
          this.logger.warn(
            `⚠️ 필요한 Environment Variables를 찾을 수 없습니다`,
          );
        }
      } else {
        this.logger.warn(`⚠️ environment-variables를 찾을 수 없습니다`);
      }

      // Use logsService.updateExecutionStatus to handle duration calculation and metadata update
      await this.logsService.updateExecutionStatus(
        execution.executionId,
        newStatus,
        metadata,
      );
      this.logger.debug(
        `Updated execution ${execution.executionId} status to ${newStatus}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update execution ${execution.executionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private createLogEvent(
    execution: Execution,
    event: EventBridgeEvent,
    codeBuildDetail: CodeBuildDetail,
  ): {
    executionId: string;
    timestamp: string;
    type: string;
    level: LogLevel;
    message: string;
    metadata: {
      buildId: string;
      status: string;
      phase?: string;
      phaseContext?: string;
      projectName: string;
      source: string;
    };
  } {
    return {
      executionId: execution.executionId,
      timestamp: new Date(event.time).toISOString(),
      type: 'build-status-change',
      level: this.getLogLevel(codeBuildDetail['build-status']),
      message: this.formatLogMessage(codeBuildDetail),
      metadata: {
        buildId: codeBuildDetail['build-id'],
        status: codeBuildDetail['build-status'],
        phase: codeBuildDetail['current-phase'],
        phaseContext: codeBuildDetail['current-phase-context'],
        projectName: codeBuildDetail['project-name'],
        source: 'eventbridge',
      },
    };
  }

  private getLogLevel(status: string): LogLevel {
    switch (status) {
      case 'SUCCEEDED':
        return LogLevel.INFO;
      case 'FAILED':
      case 'STOPPED':
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  private formatLogMessage(detail: CodeBuildDetail): string {
    const status = detail['build-status'];
    const phase = detail['current-phase'];
    const projectName = detail['project-name'];

    if (phase) {
      return `[${projectName}] Build ${status}: ${phase}`;
    }
    return `[${projectName}] Build ${status}`;
  }

  private broadcastLogEvent(executionId: string, logEvent: unknown): void {
    try {
      // Broadcast the log event through the gateway
      this.logsGateway.broadcastLogs(executionId, [logEvent]);
      this.logger.debug(`Broadcast log event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process log event for execution ${executionId}:`,
        error,
      );
    }
  }

  private broadcastStatusEvent(
    executionId: string,
    statusEvent: {
      executionId: string;
      type: string;
      status: string;
      timestamp: string;
    },
  ): void {
    try {
      // Normalize AWS CodeBuild statuses to internal ExecutionStatus for frontend
      const normalized = this.mapBuildStatusToExecutionStatus(
        statusEvent.status,
      );
      // Status broadcasts now handled through status change methods
      this.logsGateway.broadcastStatusChange(executionId, normalized);
      this.logger.debug(`Broadcast status event for execution ${executionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast status event for execution ${executionId}:`,
        error,
      );
    }
  }

  private mapBuildStatusToExecutionStatus(status: string): ExecutionStatus {
    switch (status) {
      case 'IN_PROGRESS':
        return ExecutionStatus.RUNNING;
      case 'SUCCEEDED':
        return ExecutionStatus.SUCCESS;
      case 'FAILED':
      case 'STOPPED':
        return ExecutionStatus.FAILED;
      default:
        // Fallback to PENDING when unknown
        return ExecutionStatus.PENDING;
    }
  }

  private async finalizeExecution(
    execution: Execution,
    status: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Finalizing execution ${execution.executionId} with status ${status}`,
      );

      // Stop CloudWatch polling
      this.cloudwatchService.stopPolling(execution.executionId);
      this.logger.log(
        `Stopped CloudWatch polling for execution ${execution.executionId}`,
      );

      const finalEvent = {
        executionId: execution.executionId,
        type: 'execution-complete',
        status,
        completedAt: new Date().toISOString(),
      };

      this.logsGateway.broadcastExecutionComplete(
        execution.executionId,
        status,
      );
      this.logsGateway.broadcastLogs(execution.executionId, [finalEvent]);

      // 🚀 빌드 성공 시 자동 배포 트리거
      if (status === 'SUCCEEDED') {
        // Check if logs need recovery (SUCCESS but no logs)
        await this.checkAndRecoverLogs(execution);

        await this.triggerDeploymentAfterBuild(execution);
      }
    } catch (error) {
      this.logger.error(
        `Failed to finalize execution ${execution.executionId}:`,
        error,
      );
    }
  }

  /**
   * Check if execution has logs and attempt recovery if needed
   */
  private async checkAndRecoverLogs(execution: Execution): Promise<void> {
    try {
      // Small delay to ensure CloudWatch logs are available
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get execution with project relation
      const fullExecution = await this.executionRepository.findOne({
        where: { executionId: execution.executionId },
        relations: ['project'],
      });

      if (!fullExecution) {
        return;
      }

      // Check log count
      const logCount = await this.logStorage.getExecutionLogCount(
        execution.executionId,
      );

      if (logCount === 0) {
        this.logger.log(
          `Execution ${execution.executionId} completed successfully but has no logs. Attempting auto-recovery...`,
        );

        const recoveredCount =
          await this.cloudwatchService.autoRecoverLogsForExecution(
            fullExecution,
          );

        if (recoveredCount > 0) {
          this.logger.log(
            `✅ Auto-recovered ${recoveredCount} logs for execution ${execution.executionId}`,
          );

          // Broadcast recovered logs to connected clients
          const recoveredLogs = await this.logStorage.getExecutionLogs(
            execution.executionId,
            1000,
            0,
          );

          if (recoveredLogs.length > 0) {
            this.logsGateway.broadcastLogs(
              execution.executionId,
              recoveredLogs,
            );
          }
        }
      } else {
        this.logger.debug(
          `Execution ${execution.executionId} already has ${logCount} logs`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to check/recover logs for execution ${execution.executionId}:`,
        error,
      );
      // Don't throw - this is best-effort
    }
  }

  /**
   * 빌드 성공 후 자동 배포 트리거
   * execution.awsBuildId를 통해 pipeline을 찾고 배포 시작
   */
  private async triggerDeploymentAfterBuild(
    execution: Execution,
  ): Promise<void> {
    try {
      this.logger.log(
        `🚀 빌드 성공! 자동 배포 트리거 시작: buildId=${execution.awsBuildId}`,
      );

      // Environment Variables에서 추출한 정보 우선 사용
      const ottoUserId = execution.metadata?.ottoUserId as string | undefined;
      const ottoProjectId = execution.metadata?.ottoProjectId as
        | string
        | undefined;
      const pipelineId = execution.metadata?.pipelineId as string | undefined;

      if (ottoUserId && ottoProjectId && pipelineId) {
        // Environment Variables에서 추출한 정확한 정보 사용
        this.logger.log(
          `   📋 Environment Variables 정보 사용: userId=${ottoUserId}, projectId=${ottoProjectId}, pipelineId=${pipelineId}`,
        );

        // 직접 파이프라인 ID로 조회
        const pipeline = await this.pipelineRepository.findOne({
          where: { pipelineId },
          relations: ['project'],
        });

        if (pipeline) {
          this.logger.log(`✅ 파이프라인 발견: ${pipeline.pipelineId}`);
          await this.pipelineService.deployAfterBuildSuccess(
            pipelineId,
            ottoUserId,
            execution.executionId,
          );
          this.logger.log(`🎉 자동 배포 트리거 완료: ${pipelineId}`);
          return;
        } else {
          this.logger.warn(`파이프라인을 찾을 수 없습니다: ${pipelineId}`);
        }
      }

      // 폴백: 기존 방식 (프로젝트 이름 파싱)
      const projectName = execution.metadata?.projectName as string | undefined;
      if (!projectName) {
        this.logger.warn(
          `프로젝트 이름과 Environment Variables 모두 없습니다: execution=${execution.executionId}`,
        );
        return;
      }

      // 프로젝트 이름에서 userId와 projectId 추출 (구 방식 - 오류 있음)
      const nameMatch = projectName.match(
        /^otto-(development|production)-(.+?)-build$/,
      );
      if (!nameMatch) {
        this.logger.warn(`프로젝트 이름 형식이 잘못되었습니다: ${projectName}`);
        return;
      }

      const [, environment, projectId] = nameMatch as [string, string, string];
      this.logger.log(
        `   📋 프로젝트명 파싱 정보: environment=${environment}, projectId=${projectId}`,
      );

      // 해당 프로젝트의 가장 최근 파이프라인 찾기 (ecrImageUri가 있는 것)
      // 폴백 방식: projectId만으로 검색 (userId를 모르므로)
      const pipeline = await this.pipelineRepository
        .createQueryBuilder('pipeline')
        .leftJoinAndSelect('pipeline.project', 'project')
        .where('project.projectId = :projectId', { projectId })
        .andWhere('pipeline.ecrImageUri IS NOT NULL')
        .orderBy('pipeline.updatedAt', 'DESC')
        .getOne();

      if (!pipeline) {
        this.logger.warn(
          `배포할 파이프라인을 찾을 수 없습니다: projectId=${projectId} (폴백 방식)`,
        );
        return;
      }

      this.logger.log(`   ✅ 파이프라인 발견: ${pipeline.pipelineId}`);

      // 자동 배포 시작 (project에서 userId 가져옴)
      this.logger.log(`   🚀 자동 배포 시작...`);
      const deploymentResult =
        await this.pipelineService.deployAfterBuildSuccess(
          pipeline.pipelineId,
          pipeline.project.userId,
          execution.executionId,
        );

      this.logger.log(`🎉 자동 배포 완료!`);
      this.logger.log(`   🌐 배포 URL: https://${deploymentResult.deployUrl}`);
      this.logger.log(`   🔗 ECS 서비스: ${deploymentResult.ecsServiceArn}`);

      // 배포 완료 이벤트 브로드캐스트
      const deployEvent = {
        executionId: execution.executionId,
        type: 'deployment-complete',
        deployUrl: deploymentResult.deployUrl,
        ecsServiceArn: deploymentResult.ecsServiceArn,
        timestamp: new Date().toISOString(),
      };
      this.logsGateway.broadcastLogs(execution.executionId, [deployEvent]);
    } catch (error) {
      this.logger.error(`❌ 자동 배포 실패: ${error}`);

      // 배포 실패 이벤트 브로드캐스트
      const errorEvent = {
        executionId: execution.executionId,
        type: 'deployment-failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };
      this.logsGateway.broadcastLogs(execution.executionId, [errorEvent]);
    }
  }

  isEventBridgeEnabled(): boolean {
    return this.useEventBridge;
  }

  /**
   * ECS 서비스명으로 배포를 찾아서 SUCCESS로 업데이트
   */
  private async updateDeploymentToSuccess(serviceName: string): Promise<void> {
    try {
      this.logger.log(`🎯 배포 성공 처리 중: ${serviceName}`);

      // 서비스명에서 pipelineId 추출: otto-{pipelineId} 형태
      const pipelineId = serviceName.replace('otto-', '');

      this.logger.log(`🔍 파이프라인 ID: ${pipelineId}`);

      // pipelineId로 가장 최근 배포 찾기 (WAITING_HEALTH_CHECK 또는 DEPLOYING_ECS 상태)
      const deployment = await this.deploymentRepository.findOne({
        where: {
          pipelineId,
          status: DeploymentStatus.WAITING_HEALTH_CHECK, // 또는 다른 진행 중 상태
        },
        order: { createdAt: 'DESC' },
      });

      if (!deployment) {
        // DEPLOYING_ECS 상태도 확인
        const deployingDeployment = await this.deploymentRepository.findOne({
          where: {
            pipelineId,
            status: DeploymentStatus.DEPLOYING_ECS,
          },
          order: { createdAt: 'DESC' },
        });

        if (!deployingDeployment) {
          this.logger.warn(
            `❌ 배포를 찾을 수 없습니다. 파이프라인: ${pipelineId}`,
          );
          return;
        }

        // DEPLOYING_ECS 상태의 배포를 SUCCESS로 업데이트
        await this.deploymentTrackerService.updateDeploymentStatus(
          deployingDeployment.deploymentId,
          DeploymentStatus.SUCCESS,
          {
            metadata: {
              ...deployingDeployment.metadata,
              completedAt: new Date().toISOString(),
              ecsTaskStatus: 'RUNNING',
            },
          },
        );

        this.logger.log(`🎉 ===============================================`);
        this.logger.log(`🎉 🎊 배포가 성공했습니다! 🎊`);
        this.logger.log(`🎉 ===============================================`);
        this.logger.log(`✅ 서비스: ${serviceName}`);
        this.logger.log(`✅ 파이프라인: ${pipelineId}`);
        this.logger.log(`✅ 배포 ID: ${deployingDeployment.deploymentId}`);
        this.logger.log(`✅ 상태: DEPLOYING_ECS → SUCCESS`);
        this.logger.log(`🎉 ===============================================`);
        return;
      }

      // WAITING_HEALTH_CHECK 상태의 배포를 SUCCESS로 업데이트
      await this.deploymentTrackerService.updateDeploymentStatus(
        deployment.deploymentId,
        DeploymentStatus.SUCCESS,
        {
          metadata: {
            ...deployment.metadata,
            completedAt: new Date().toISOString(),
            ecsTaskStatus: 'RUNNING',
          },
        },
      );

      this.logger.log(`🎉 ===============================================`);
      this.logger.log(`🎉 🎊 배포가 성공했습니다! 🎊`);
      this.logger.log(`🎉 ===============================================`);
      this.logger.log(`✅ 서비스: ${serviceName}`);
      this.logger.log(`✅ 파이프라인: ${pipelineId}`);
      this.logger.log(`✅ 배포 ID: ${deployment.deploymentId}`);
      this.logger.log(`✅ 상태: WAITING_HEALTH_CHECK → SUCCESS`);
      this.logger.log(`🎉 ===============================================`);
    } catch (error) {
      this.logger.error(`❌ 배포 성공 처리 실패: ${error}`);
    }
  }
}
