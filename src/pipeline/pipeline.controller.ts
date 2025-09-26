import { Controller, HttpCode, HttpStatus, Req, Body } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import {
  TypedParam,
  TypedException,
  TypedRoute,
  TypedQuery,
} from '@nestia/core';
import { CommonErrorResponseDto } from '../common/dtos';
import { AuthGuard } from '../common/decorator';
import type {
  CreatePipelineRequestDto,
  UpdatePipelineRequestDto,
  GetPipelinesRequestDto,
  PipelineResponseDto,
} from './dtos';
import type { IRequestType } from '../common/type';

@Controller('/pipelines')
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  /**
   * @tag pipeline
   * @summary 파이프라인 생성
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '프로젝트를 찾을 수 없음',
  })
  @HttpCode(201)
  @TypedRoute.Post('/')
  @AuthGuard()
  async createPipeline(
    @Body() createPipelineDto: CreatePipelineRequestDto,
    @Req() req: IRequestType,
  ): Promise<PipelineResponseDto> {
    return this.pipelineService.createPipeline(
      createPipelineDto,
      req.user.userId,
    );
  }

  /**
   * @tag pipeline
   * @summary 파이프라인 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/')
  @AuthGuard()
  async getPipelines(
    @TypedQuery() query: GetPipelinesRequestDto,
    @Req() req: IRequestType,
  ): Promise<PipelineResponseDto[]> {
    return this.pipelineService.getPipelines(query, req.user.userId);
  }

  /**
   * @tag pipeline
   * @summary 특정 파이프라인 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/:pipelineId')
  @AuthGuard()
  async getPipelineById(
    @TypedParam('pipelineId') pipelineId: string,
    @Req() req: IRequestType,
  ): Promise<PipelineResponseDto> {
    return this.pipelineService.getPipelineById(pipelineId, req.user.userId);
  }

  /**
   * @tag pipeline
   * @summary 파이프라인 업데이트
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: '잘못된 요청',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Patch('/:pipelineId')
  @AuthGuard()
  async updatePipeline(
    @TypedParam('pipelineId') pipelineId: string,
    @Body() updatePipelineDto: UpdatePipelineRequestDto,
    @Req() req: IRequestType,
  ): Promise<PipelineResponseDto> {
    return this.pipelineService.updatePipeline(
      pipelineId,
      updatePipelineDto,
      req.user.userId,
    );
  }

  /**
   * @tag pipeline
   * @summary 파이프라인 삭제
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(204)
  @TypedRoute.Delete('/:pipelineId')
  @AuthGuard()
  async deletePipeline(
    @TypedParam('pipelineId') pipelineId: string,
    @Req() req: IRequestType,
  ): Promise<void> {
    return this.pipelineService.deletePipeline(pipelineId, req.user.userId);
  }

  /**
   * @tag pipeline
   * @summary 프로젝트별 파이프라인 개수 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/projects/:projectId/count')
  @AuthGuard()
  async getPipelineCountByProject(
    @TypedParam('projectId') projectId: string,
    @Req() req: IRequestType,
  ): Promise<{ count: number }> {
    const count = await this.pipelineService.getPipelineCountByProject(
      projectId,
      req.user.userId,
    );
    return { count };
  }

  /**
   * @tag pipeline
   * @summary 파이프라인 빌드 실행
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: 'CodeBuild 프로젝트가 설정되지 않음',
  })
  @HttpCode(200)
  @TypedRoute.Post('/:pipelineId/execute')
  @AuthGuard()
  async executePipeline(
    @TypedParam('pipelineId') pipelineId: string,
    @Req() req: IRequestType,
  ): Promise<{
    buildId: string;
    buildNumber: string;
    imageTag: string;
    ecrImageUri: string;
  }> {
    return await this.pipelineService.executePipeline(
      pipelineId,
      req.user.userId,
    );
  }

  /**
   * @tag pipeline
   * @summary 빌드 상태 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인 또는 빌드를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/:pipelineId/builds/:buildId/status')
  @AuthGuard()
  async getBuildStatus(
    @TypedParam('pipelineId') pipelineId: string,
    @TypedParam('buildId') buildId: string,
    @Req() req: IRequestType,
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
    return await this.pipelineService.getBuildStatus(
      pipelineId,
      buildId,
      req.user.userId,
    );
  }

  /**
   * @tag pipeline
   * @summary 배포 상태 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '배포 정보를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/:pipelineId/deployment/status')
  @AuthGuard()
  async getDeploymentStatus(
    @TypedParam('pipelineId') pipelineId: string,
    @Req() req: IRequestType,
  ): Promise<{
    status: string;
    deployUrl: string | null;
    updatedAt: Date;
  }> {
    return await this.pipelineService.getDeploymentStatus(
      pipelineId,
      req.user.userId,
    );
  }

  /**
   * @tag pipeline
   * @summary 배포 헬스체크 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: '파이프라인을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.BAD_REQUEST,
    description: '배포 URL이 설정되지 않음',
  })
  @HttpCode(200)
  @TypedRoute.Get('/:pipelineId/deployment/health')
  @AuthGuard()
  async getDeploymentHealth(
    @TypedParam('pipelineId') pipelineId: string,
    @Req() req: IRequestType,
  ): Promise<{
    isHealthy: boolean;
    responseStatus: number;
    responseTime: number;
    errorMessage?: string;
    lastChecked: Date;
    deployUrl: string;
  }> {
    return await this.pipelineService.getDeploymentHealth(
      pipelineId,
      req.user.userId,
    );
  }
}
