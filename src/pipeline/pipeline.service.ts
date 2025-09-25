import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pipeline } from '../database/entities/pipeline.entity';
import { Project } from '../database/entities/project.entity';
import { CodeBuildService } from '../codebuild/codebuild.service';
import { ECRService } from '../codebuild/ecr.service';
import { DeploymentService } from '../deployment/deployment.service';
import { HealthCheckService } from '../deployment/health-check.service';
import type {
  CreatePipelineRequestDto,
  UpdatePipelineRequestDto,
  GetPipelinesRequestDto,
  PipelineResponseDto,
} from './dtos';

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    private readonly codeBuildService: CodeBuildService,
    private readonly ecrService: ECRService,
    private readonly deploymentService: DeploymentService,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  /**
   * 파이프라인 생성
   */
  async createPipeline(
    createPipelineDto: CreatePipelineRequestDto,
    userId: string,
  ): Promise<PipelineResponseDto> {
    // 프로젝트 존재 여부 및 권한 확인
    const project = await this.projectRepository.findOne({
      where: { projectId: createPipelineDto.projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found or access denied');
    }

    // 파이프라인 생성
    const pipeline = this.pipelineRepository.create({
      projectId: createPipelineDto.projectId,
      pipelineName: createPipelineDto.pipelineName,
      data: createPipelineDto.data as object,
    });

    const savedPipeline = await this.pipelineRepository.save(pipeline);

    this.logger.log(
      `Pipeline created: ${savedPipeline.pipelineId} for project ${createPipelineDto.projectId}`,
    );

    return this.mapToResponseDto(savedPipeline);
  }

  /**
   * 파이프라인 목록 조회
   */
  async getPipelines(
    query: GetPipelinesRequestDto,
    userId: string,
  ): Promise<PipelineResponseDto[]> {
    const { projectId } = query;

    // 쿼리 빌더 생성
    const queryBuilder = this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('project.userId = :userId', { userId })
      .orderBy('pipeline.createdAt', 'DESC');

    // 프로젝트 ID 필터링
    if (projectId) {
      queryBuilder.andWhere('pipeline.projectId = :projectId', { projectId });
    }

    const pipelines = await queryBuilder.getMany();

    return pipelines.map((pipeline) => this.mapToResponseDto(pipeline));
  }

  /**
   * 특정 파이프라인 조회
   */
  async getPipelineById(
    pipelineId: string,
    userId: string,
  ): Promise<PipelineResponseDto> {
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    return this.mapToResponseDto(pipeline);
  }

  /**
   * 파이프라인 업데이트
   */
  async updatePipeline(
    pipelineId: string,
    updatePipelineDto: UpdatePipelineRequestDto,
    userId: string,
  ): Promise<PipelineResponseDto> {
    // 파이프라인 존재 여부 및 권한 확인
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    // 업데이트 필드 적용
    if (updatePipelineDto.pipelineName !== undefined) {
      pipeline.pipelineName = updatePipelineDto.pipelineName;
    }

    if (updatePipelineDto.data !== undefined) {
      pipeline.data = updatePipelineDto.data;
    }

    // env 필드 업데이트 (환경변수)
    if (updatePipelineDto.env !== undefined) {
      pipeline.env = updatePipelineDto.env;
    }

    // deployOption 필드 업데이트 (포트, 명령어)
    if (updatePipelineDto.deployOption !== undefined) {
      pipeline.deployOption = updatePipelineDto.deployOption;
    }

    // env 필드 업데이트 (환경변수)
    if (updatePipelineDto.env !== undefined) {
      pipeline.env = updatePipelineDto.env;
    }

    // deployOption 필드 업데이트 (포트, 명령어)
    if (updatePipelineDto.deployOption !== undefined) {
      pipeline.deployOption = updatePipelineDto.deployOption;
    }

    const updatedPipeline = await this.pipelineRepository.save(pipeline);

    this.logger.log(`Pipeline updated: ${pipelineId}`);

    return this.mapToResponseDto(updatedPipeline);
  }

  /**
   * 파이프라인 삭제
   */
  async deletePipeline(pipelineId: string, userId: string): Promise<void> {
    // 파이프라인 존재 여부 및 권한 확인
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    await this.pipelineRepository.remove(pipeline);

    this.logger.log(`Pipeline deleted: ${pipelineId}`);
  }

  /**
   * 프로젝트별 파이프라인 개수 조회
   */
  async getPipelineCountByProject(
    projectId: string,
    userId: string,
  ): Promise<number> {
    return await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.projectId = :projectId', { projectId })
      .andWhere('project.userId = :userId', { userId })
      .getCount();
  }

  /**
   * 파이프라인 빌드 실행
   */
  async executePipeline(
    pipelineId: string,
    userId: string,
  ): Promise<{
    buildId: string;
    buildNumber: string;
    imageTag: string;
    ecrImageUri: string;
  }> {
    // 파이프라인 존재 여부 및 권한 확인
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    const project = pipeline.project;
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (!project.codebuildProjectName) {
      throw new Error('CodeBuild project not configured for this project');
    }

    this.logger.log(
      `Starting build for pipeline: ${pipelineId}, project: ${project.projectId}`,
    );

    // 파이프라인 data에서 flowNodes 추출
    const flowNodes = pipeline.data?.flowNodes || [];
    this.logger.log(
      `Flow nodes from pipeline: ${JSON.stringify(flowNodes, null, 2)}`,
    );

    // CodeBuild 빌드 시작 (flowNodes 포함)
    const buildResult = await this.codeBuildService.startBuild({
      projectName: project.codebuildProjectName,
      userId: project.userId,
      projectId: project.projectId,
      pipelineId: pipelineId,
      flowNodes: flowNodes,
    });

    // ECR 이미지 URI 생성
    const ecrImageUri = await this.ecrService.generateImageUri({
      userId: project.userId,
      projectId: project.projectId,
      buildNumber: buildResult.buildNumber,
    });

    this.logger.log(
      `Build result: buildId=${buildResult.buildId}, buildNumber=${buildResult.buildNumber}`,
    );
    this.logger.log(`Generated image tag: ${buildResult.imageTag}`);
    this.logger.log(`Generated ECR URI: ${ecrImageUri}`);

    // Pipeline에 이미지 정보 업데이트
    await this.pipelineRepository.update(pipelineId, {
      ecrImageUri,
      imageTag: buildResult.imageTag,
    });

    this.logger.log(`Build started successfully: ${buildResult.buildId}`);

    // 🚀 빌드 완료 후 자동 배포 시작 (백그라운드에서 실행)
    this.waitForBuildAndDeploy(buildResult.buildId, pipelineId, userId).catch(
      (error) => {
        this.logger.error(`빌드 완료 대기 및 배포 실패: ${error}`);
      },
    );

    return {
      buildId: buildResult.buildId,
      buildNumber: buildResult.buildNumber,
      imageTag: buildResult.imageTag,
      ecrImageUri,
    };
  }

  /**
   * 빌드 완료를 기다린 후 자동 배포 실행
   * 백그라운드에서 빌드 상태를 폴링하다가 완료되면 배포 시작
   */
  private async waitForBuildAndDeploy(
    buildId: string,
    pipelineId: string,
    userId: string,
  ): Promise<void> {
    this.logger.log(`🕐 빌드 완료 대기 시작: ${buildId}`);

    const maxRetries = 180; // 최대 180번 시도 (30분)
    const retryInterval = 10000; // 10초마다 확인

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`   [${attempt}/${maxRetries}] 빌드 상태 확인 중...`);

        const buildStatus = await this.codeBuildService.getBuildStatus(buildId);

        this.logger.log(`   빌드 상태: ${buildStatus.buildStatus}`);

        if (buildStatus.buildStatus === 'SUCCEEDED') {
          this.logger.log(`✅ 빌드 완료! 배포 시작...`);

          // 자동 배포 실행
          const deployResult = await this.deployAfterBuildSuccess(
            pipelineId,
            userId,
          );

          this.logger.log(`🎉 자동 배포 완료!`);
          this.logger.log(`   🌐 배포 URL: https://${deployResult.deployUrl}`);
          return;
        }

        if (
          buildStatus.buildStatus === 'FAILED' ||
          buildStatus.buildStatus === 'STOPPED'
        ) {
          this.logger.error(`❌ 빌드 실패: ${buildStatus.buildStatus}`);
          return;
        }

        // 아직 진행 중이면 30초 후 다시 확인
        if (attempt < maxRetries) {
          this.logger.log(
            `   ⏳ 빌드 진행 중... ${retryInterval / 1000}초 후 재확인`,
          );
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
        }
      } catch (error) {
        this.logger.error(
          `빌드 상태 확인 실패 (${attempt}/${maxRetries}): ${error}`,
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryInterval));
        }
      }
    }

    this.logger.error(
      `⏰ 빌드 완료 대기 시간 초과 (${(maxRetries * retryInterval) / 1000 / 60}분)`,
    );
  }

  /**
   * 빌드 성공 후 배포 처리
   * CodeBuild 빌드가 완료되면 호출되어 ECS/ALB/Route53 배포를 수행
   */
  async deployAfterBuildSuccess(
    pipelineId: string,
    userId: string,
  ): Promise<{
    deployUrl: string;
    ecsServiceArn: string;
    targetGroupArn: string;
    albDnsName: string;
  }> {
    this.logger.log(`빌드 성공 후 배포 시작: pipelineId=${pipelineId}`);

    try {
      // 파이프라인에 ecrImageUri가 있는지 확인 (빌드 성공 여부)
      const pipeline = await this.pipelineRepository.findOne({
        where: { pipelineId },
        relations: ['project'],
      });

      if (!pipeline) {
        throw new NotFoundException('파이프라인을 찾을 수 없습니다');
      }

      if (!pipeline.ecrImageUri) {
        throw new Error(
          'ECR 이미지 URI가 없습니다. 빌드가 완료되지 않았을 수 있습니다.',
        );
      }

      // 배포 서비스를 통해 ECS/ALB/Route53 설정
      const deploymentResult = await this.deploymentService.deployAfterBuild(
        pipelineId,
        userId,
      );

      this.logger.log(`배포 완료: ${deploymentResult.deployUrl}`);

      return deploymentResult;
    } catch (error) {
      this.logger.error(`배포 실패: ${error}`);
      throw new Error(`배포 실패: ${error}`);
    }
  }

  /**
   * 빌드 상태 조회
   */
  async getBuildStatus(
    pipelineId: string,
    buildId: string,
    userId: string,
  ): Promise<{
    buildStatus: string;
    currentPhase?: string;
    startTime?: Date;
    endTime?: Date;
    logs?: {
      groupName?: string;
      streamName?: string;
    };
  }> {
    // 파이프라인 권한 확인
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    // CodeBuild에서 빌드 상태 조회
    return await this.codeBuildService.getBuildStatus(buildId);
  }

  /**
   * 배포 헬스체크 수행
   */
  async getDeploymentHealth(
    pipelineId: string,
    userId: string,
  ): Promise<{
    isHealthy: boolean;
    responseStatus: number;
    responseTime: number;
    errorMessage?: string;
    lastChecked: Date;
    deployUrl: string;
  }> {
    // 파이프라인 권한 확인
    const pipeline = await this.pipelineRepository
      .createQueryBuilder('pipeline')
      .leftJoinAndSelect('pipeline.project', 'project')
      .where('pipeline.pipelineId = :pipelineId', { pipelineId })
      .andWhere('project.userId = :userId', { userId })
      .getOne();

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found or access denied');
    }

    if (!pipeline.deployUrl) {
      throw new Error('배포 URL이 설정되지 않았습니다');
    }

    this.logger.log(
      `배포 헬스체크 시작: pipelineId=${pipelineId}, deployUrl=${pipeline.deployUrl}`,
    );

    // 헬스체크 수행
    const healthResult = await this.healthCheckService.checkDeploymentHealth(
      pipeline.deployUrl,
    );

    return {
      ...healthResult,
      deployUrl: pipeline.deployUrl,
    };
  }

  /**
   * Entity를 ResponseDto로 변환
   */
  private mapToResponseDto(pipeline: Pipeline): PipelineResponseDto {
    return {
      pipelineId: pipeline.pipelineId,
      projectId: pipeline.projectId,
      pipelineName: pipeline.pipelineName,
      data: pipeline.data,
      ecrImageUri: pipeline.ecrImageUri,
      imageTag: pipeline.imageTag,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
      deployUrl: pipeline.deployUrl,
    };
  }
}
