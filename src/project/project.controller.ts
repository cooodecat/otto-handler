import {
  Controller,
  HttpCode,
  HttpStatus,
  Req,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ProjectService } from './project.service';
import type { FastifyRequest } from 'fastify';
import { TypedBody, TypedException, TypedRoute } from '@nestia/core';
import { AuthGuard } from '../common/decorator';
import {
  CommonErrorResponseDto,
  CommonMessageResponseDto,
} from '../common/dtos';
import type {
  CreateProjectRequestDto,
  UpdateProjectRequestDto,
  ProjectResponseDto,
} from './dtos';
import type { IRequestType } from '../common/type';

@Controller('/projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  /**
   * @tag projects
   * @summary 프로젝트 생성
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청 데이터',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(201)
  @AuthGuard()
  @TypedRoute.Post('/')
  async createProject(
    @TypedBody() body: CreateProjectRequestDto,
    @Req() req: IRequestType,
  ): Promise<ProjectResponseDto> {
    return this.projectService.createProject(body, req.user.userId);
  }

  /**
   * @tag projects
   * @summary 사용자 프로젝트 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/')
  async getProjects(@Req() req: IRequestType): Promise<ProjectResponseDto[]> {
    return this.projectService.getProjectsByUserId(req.user.userId);
  }

  /**
   * @tag projects
   * @summary 프로젝트 상세 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '프로젝트를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Get('/:projectId')
  async getProject(
    @Param('projectId') projectId: string,
    @Req() req: IRequestType,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectService.getProjectById(
      projectId,
      req.user.userId,
    );
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  /**
   * @tag projects
   * @summary 프로젝트 수정
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '프로젝트를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Patch('/:projectId')
  async updateProject(
    @Param('projectId') projectId: string,
    @TypedBody() body: UpdateProjectRequestDto,
    @Req() req: FastifyRequest & { user: { userId: string } },
  ): Promise<ProjectResponseDto> {
    return this.projectService.updateProject(projectId, body, req.user.userId);
  }

  /**
   * @tag projects
   * @summary 프로젝트 삭제
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '프로젝트를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @AuthGuard()
  @TypedRoute.Delete('/:projectId')
  async deleteProject(
    @Param('projectId') projectId: string,
    @Req() req: FastifyRequest & { user: { userId: string } },
  ): Promise<CommonMessageResponseDto> {
    await this.projectService.deleteProject(projectId, req.user.userId);
    return { message: '프로젝트가 삭제되었습니다.' };
  }
}
