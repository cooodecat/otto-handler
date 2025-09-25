import { PipelineData } from '../../database/entities/pipeline.entity';

export interface CreatePipelineRequestDto {
  /**
   * 프로젝트 ID
   */
  projectId: string;

  /**
   * 파이프라인 이름
   */
  pipelineName: string;

  /**
   * 파이프라인 데이터 (JSON)
   */
  data: PipelineData;
}

export interface UpdatePipelineRequestDto {
  /**
   * 파이프라인 이름
   */
  pipelineName?: string;

  /**
   * 파이프라인 데이터 (JSON)
   */
  data?: PipelineData;

  /**
   * env 관련
   */
  env?: Record<string, string> | null;

  /**
   * 빌드 옵션 관련
   */
  deployOption?: { port: number; command: string };
}

export interface GetPipelinesRequestDto {
  /**
   * 프로젝트 ID로 필터링
   */
  projectId?: string;
}
