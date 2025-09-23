import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ECSClient,
  CreateClusterCommand,
  CreateServiceCommand,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  DescribeClustersCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ListClustersCommand,
  ListServicesCommand,
  DeleteServiceCommand,
  DeleteClusterCommand,
  UpdateServiceCommand,
  StopTaskCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import {
  CreateClusterInput,
  CreateTaskDefinitionInput,
  CreateServiceInput,
  RunTaskInput,
} from './types/ecs.types';

/**
 * AWS ECS 서비스
 * ECS 클러스터, 서비스, 태스크 정의를 관리하는 서비스
 */
@Injectable()
export class AwsEcsService {
  private ecsClient: ECSClient;

  constructor(private configService: ConfigService) {
    this.ecsClient = new ECSClient({
      region: this.configService.get<string>('AWS_REGION') || 'us-east-1',
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID')!,
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        )!,
      },
    });
  }

  /**
   * ECS 클러스터를 생성합니다
   * @param input - 클러스터 생성 입력 데이터
   * @returns 생성된 클러스터 정보
   */
  async createCluster(input: CreateClusterInput) {
    const command = new CreateClusterCommand({
      clusterName: input.clusterName,
      tags: input.tags?.map((tag) => ({ key: tag.key, value: tag.value })),
    });

    return await this.ecsClient.send(command);
  }

  /**
   * ECS 태스크 정의를 등록합니다
   * @param input - 태스크 정의 입력 데이터
   * @returns 등록된 태스크 정의 정보
   */
  async registerTaskDefinition(input: CreateTaskDefinitionInput) {
    // ContainerDefinition을 AWS SDK 형식으로 매핑
    const containerDefinitions = input.containerDefinitions.map(
      (container) => ({
        name: container.name,
        image: container.image,
        memory: container.memory,
        cpu: container.cpu,
        essential: container.essential,
        portMappings: container.portMappings,
        environment: container.environment,
        logConfiguration: container.logConfiguration,
        // command 필드 추가 (pipeline.deployOption.command 지원)
        command: container.command,
      }),
    );

    const command = new RegisterTaskDefinitionCommand({
      family: input.family,
      containerDefinitions,
      requiresCompatibilities: input.requiresCompatibilities || ['FARGATE'],
      networkMode: input.networkMode || 'awsvpc',
      cpu: input.cpu,
      memory: input.memory,
      executionRoleArn: input.executionRoleArn,
      taskRoleArn: input.taskRoleArn,
    });

    return await this.ecsClient.send(command);
  }

  /**
   * ECS 서비스를 생성합니다
   * @param input - 서비스 생성 입력 데이터
   * @returns 생성된 서비스 정보
   */
  async createService(input: CreateServiceInput) {
    const command = new CreateServiceCommand({
      serviceName: input.serviceName,
      cluster: input.cluster,
      taskDefinition: input.taskDefinition,
      desiredCount: input.desiredCount || 1,
      launchType: input.launchType || 'FARGATE',
      networkConfiguration: input.networkConfiguration,
      loadBalancers: input.loadBalancers,
    });

    return await this.ecsClient.send(command);
  }

  /**
   * ECS 태스크를 실행합니다
   * @param input - 태스크 실행 입력 데이터
   * @returns 실행된 태스크 정보
   */
  async runTask(input: RunTaskInput) {
    const command = new RunTaskCommand({
      cluster: input.cluster,
      taskDefinition: input.taskDefinition,
      count: input.count || 1,
      launchType: input.launchType || 'FARGATE',
      networkConfiguration: input.networkConfiguration,
      overrides: input.overrides,
    });

    return await this.ecsClient.send(command);
  }

  /**
   * 모든 ECS 클러스터 목록을 조회합니다
   * @returns 클러스터 목록
   */
  async listClusters() {
    const command = new ListClustersCommand({});
    return await this.ecsClient.send(command);
  }

  /**
   * 특정 ECS 클러스터들의 상세 정보를 조회합니다
   * @param clusterArns - 조회할 클러스터 ARN 목록
   * @returns 클러스터 상세 정보
   */
  async describeClusters(clusterArns: string[]) {
    const command = new DescribeClustersCommand({
      clusters: clusterArns,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 특정 클러스터의 서비스 목록을 조회합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @returns 서비스 목록
   */
  async listServices(cluster: string) {
    const command = new ListServicesCommand({
      cluster,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 특정 서비스들의 상세 정보를 조회합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param services - 조회할 서비스 이름 또는 ARN 목록
   * @returns 서비스 상세 정보
   */
  async describeServices(cluster: string, services: string[]) {
    const command = new DescribeServicesCommand({
      cluster,
      services,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 태스크 정의의 상세 정보를 조회합니다
   * @param taskDefinition - 태스크 정의 ARN 또는 패밀리:리비전
   * @returns 태스크 정의 상세 정보
   */
  async describeTaskDefinition(taskDefinition: string) {
    const command = new DescribeTaskDefinitionCommand({
      taskDefinition,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * ECS 서비스를 업데이트합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param service - 서비스 이름 또는 ARN
   * @param desiredCount - 원하는 태스크 수 (선택사항)
   * @param taskDefinition - 새로운 태스크 정의 ARN (선택사항)
   * @returns 업데이트된 서비스 정보
   */
  async updateService(
    cluster: string,
    service: string,
    desiredCount?: number,
    taskDefinition?: string,
  ) {
    const command = new UpdateServiceCommand({
      cluster,
      service,
      desiredCount,
      taskDefinition,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * ECS 서비스를 삭제합니다
   * 먼저 desired count를 0으로 설정한 후 삭제합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param service - 서비스 이름 또는 ARN
   * @returns 삭제된 서비스 정보
   */
  async deleteService(cluster: string, service: string) {
    // 서비스 삭제 전 desired count를 0으로 설정
    await this.updateService(cluster, service, 0);

    const command = new DeleteServiceCommand({
      cluster,
      service,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * ECS 클러스터를 삭제합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @returns 삭제된 클러스터 정보
   */
  async deleteCluster(cluster: string) {
    const command = new DeleteClusterCommand({
      cluster,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 실행 중인 태스크를 중지합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param task - 태스크 ARN
   * @param reason - 중지 이유 (선택사항)
   * @returns 중지된 태스크 정보
   */
  async stopTask(cluster: string, task: string, reason?: string) {
    const command = new StopTaskCommand({
      cluster,
      task,
      reason,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 특정 서비스의 태스크 목록을 조회합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param serviceName - 서비스 이름 (선택사항)
   * @returns 태스크 목록
   */
  async listTasks(cluster: string, serviceName?: string) {
    const command = new ListTasksCommand({
      cluster,
      serviceName,
    });
    return await this.ecsClient.send(command);
  }

  /**
   * 특정 태스크들의 상세 정보를 조회합니다
   * @param cluster - 클러스터 이름 또는 ARN
   * @param tasks - 조회할 태스크 ARN 목록
   * @returns 태스크 상세 정보
   */
  async describeTasks(cluster: string, tasks: string[]) {
    const command = new DescribeTasksCommand({
      cluster,
      tasks,
    });
    return await this.ecsClient.send(command);
  }
}
