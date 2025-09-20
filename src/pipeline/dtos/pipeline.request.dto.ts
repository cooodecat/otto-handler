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
  data: any;
}

export interface UpdatePipelineRequestDto {
  /**
   * 파이프라인 이름
   */
  pipelineName?: string;

  /**
   * 파이프라인 데이터 (JSON)
   */
  data?: any;
}

export interface GetPipelinesRequestDto {
  /**
   * 프로젝트 ID로 필터링
   */
  projectId?: string;
}
