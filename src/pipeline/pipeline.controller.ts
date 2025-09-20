import {
  Controller,
  HttpCode,
  HttpStatus,
  Req,
  Query,
  Body,
} from '@nestjs/common';
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
}
