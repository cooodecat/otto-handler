import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, ProjectStatus } from '../database/entities/project.entity';
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
    const result = await this.projectRepository.delete({
      projectId,
      userId,
    });

    if (result.affected === 0) {
      throw new NotFoundException('Project not found');
    }
  }
}
