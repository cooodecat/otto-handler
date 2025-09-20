import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from '../database/entities/project.entity';
import { Pipeline } from '../database/entities/pipeline.entity';
import type {
  CreateProjectRequestDto,
  UpdateProjectRequestDto,
  ProjectResponseDto,
} from './dtos';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>,
  ) {}

  async createProject(
    createDto: CreateProjectRequestDto,
    userId: string,
  ): Promise<ProjectResponseDto> {
    const project = this.projectRepository.create({
      ...createDto,
      userId,
      codebuildStatus: ProjectStatus.CREATED,
    });

    const savedProject = await this.projectRepository.save(project);
    return savedProject;
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
