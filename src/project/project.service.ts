import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from '../database/entities/project.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import { CodeBuildService } from '../codebuild/codebuild.service';
import type {
  CreateProjectRequestDto,
  UpdateProjectRequestDto,
  ProjectResponseDto,
} from './dtos';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
    private readonly codeBuildService: CodeBuildService,
  ) {}

  async createProject(
    createDto: CreateProjectRequestDto,
    userId: string,
  ): Promise<ProjectResponseDto> {
    // 생성된 리소스 추적을 위한 변수
    const createdResources = {
      ecrRepository: null as string | null,
      codebuildProject: null as string | null,
      eventBridgeRule: null as string | null,
      cloudwatchLogGroup: null as string | null,
    };

    try {
      // 1. AWS CodeBuild 프로젝트 먼저 생성
      const githubRepositoryUrl = `https://github.com/${createDto.githubOwner}/${createDto.githubRepositoryName}`;

      // 임시 프로젝트 ID 생성 (UUID)
      const tempProjectId = this.generateProjectId();

      this.logger.log(`Creating AWS resources for project ${tempProjectId}`);

      // 디버깅: Flow 노드 확인
      this.logger.log(
        `Flow nodes received: ${JSON.stringify(createDto.flowNodes, null, 2)}`,
      );

      const codeBuildResult = await this.codeBuildService.createProject({
        userId: userId,
        projectId: tempProjectId,
        projectName: createDto.projectName,
        githubRepositoryUrl,
        branch: createDto.selectedBranch,
        flowNodes: createDto.flowNodes || [], // Flow 노드들
        // AWS 설정은 CodeBuildService에서 기본값으로 처리
      });

      // 생성된 리소스 기록
      createdResources.ecrRepository = codeBuildResult.ecrRepository;
      createdResources.codebuildProject = codeBuildResult.projectName;
      createdResources.cloudwatchLogGroup = codeBuildResult.logGroup;

      // EventBridge Rule 이름 저장 (otto-dev-{projectId} 형식)
      createdResources.eventBridgeRule = `otto-dev-${tempProjectId}`;

      this.logger.log(
        `CodeBuild project and EventBridge rule created successfully: ${codeBuildResult.projectName}`,
      );

      // 3. CodeBuild 생성 성공 시 Project 엔티티 생성 및 저장
      const project = this.projectRepository.create({
        ...createDto,
        projectId: tempProjectId,
        userId,
        codebuildProjectName: codeBuildResult.projectName,
        codebuildProjectArn: codeBuildResult.arn,
        cloudwatchLogGroup: codeBuildResult.logGroup,
        ecrRepository: codeBuildResult.ecrRepository,
        codebuildStatus: ProjectStatus.SUCCESS,
        codebuildErrorMessage: null,
      });

      const savedProject = await this.projectRepository.save(project);

      return savedProject as ProjectResponseDto;
    } catch (error) {
      // 실패 시 생성된 모든 리소스 롤백
      this.logger.error(`Project creation failed, starting rollback...`);

      await this.rollbackCreatedResources(createdResources);

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Project creation failed: ${errorMessage}`);

      throw new Error(`프로젝트 생성 실패: ${errorMessage}`);
    }
  }

  /**
   * 생성된 AWS 리소스 롤백
   */
  private async rollbackCreatedResources(resources: {
    ecrRepository: string | null;
    codebuildProject: string | null;
    eventBridgeRule: string | null;
    cloudwatchLogGroup: string | null;
  }): Promise<void> {
    const rollbackPromises: Promise<void>[] = [];

    // CodeBuild 프로젝트 삭제
    if (resources.codebuildProject) {
      this.logger.log(
        `Rolling back CodeBuild project: ${resources.codebuildProject}`,
      );
      rollbackPromises.push(
        this.codeBuildService
          .deleteProject(resources.codebuildProject)
          .catch((err: Error) =>
            this.logger.error(
              `Failed to delete CodeBuild project: ${err.message}`,
            ),
          ),
      );
    }

    // ECR 리포지토리 삭제
    if (resources.ecrRepository) {
      this.logger.log(
        `Rolling back ECR repository: ${resources.ecrRepository}`,
      );
      rollbackPromises.push(
        this.codeBuildService
          .deleteEcrRepository(resources.ecrRepository)
          .catch((err: Error) =>
            this.logger.error(
              `Failed to delete ECR repository: ${err.message}`,
            ),
          ),
      );
    }

    // EventBridge 규칙 삭제
    if (resources.eventBridgeRule) {
      this.logger.log(
        `Rolling back EventBridge rule: ${resources.eventBridgeRule}`,
      );
      // TODO: EventBridge 삭제 메서드 구현 필요
      // rollbackPromises.push(
      //   this.eventBridgeService.deleteRule(resources.eventBridgeRule)
      //     .catch(err => this.logger.error(`Failed to delete EventBridge rule: ${err.message}`))
      // );
    }

    // CloudWatch 로그 그룹 삭제
    if (resources.cloudwatchLogGroup) {
      this.logger.log(
        `Rolling back CloudWatch log group: ${resources.cloudwatchLogGroup}`,
      );
      rollbackPromises.push(
        this.codeBuildService
          .deleteCloudWatchLogGroup(resources.cloudwatchLogGroup)
          .catch((err: Error) =>
            this.logger.error(
              `Failed to delete CloudWatch log group: ${err.message}`,
            ),
          ),
      );
    }

    await Promise.all(rollbackPromises);
    this.logger.log('Rollback completed');
  }

  private generateProjectId(): string {
    // UUID v4 생성 로직 (crypto.randomUUID가 없는 경우 대체)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }

  async getProjectsByUserId(userId: string): Promise<ProjectResponseDto[]> {
    const projects = await this.projectRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return projects as ProjectResponseDto[];
  }

  async getProjectById(
    projectId: string,
    userId: string,
  ): Promise<ProjectResponseDto | null> {
    const project = await this.projectRepository.findOne({
      where: { projectId, userId },
    });

    return project;
  }

  async updateProject(
    projectId: string,
    updateDto: UpdateProjectRequestDto,
    userId: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectRepository.findOne({
      where: { projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    Object.assign(project, updateDto);
    const updatedProject = await this.projectRepository.save(project);

    return updatedProject as ProjectResponseDto;
  }

  async deleteProject(projectId: string, userId: string): Promise<void> {
    // 먼저 프로젝트가 존재하고 사용자가 소유자인지 확인
    const project = await this.projectRepository.findOne({
      where: { projectId, userId },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // 관련된 모든 파이프라인 삭제
    await this.pipelineRepository.delete({ projectId });

    // 프로젝트 삭제
    const result = await this.projectRepository.delete({
      projectId,
      userId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Project not found');
    }
  }
}
