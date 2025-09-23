export type UpdatePipelineRequestDto = {
  /**
   * 파이프라인 이름
   */
  pipelineName?: undefined | string;

  /**
   * 파이프라인 데이터 (JSON)
   */
  data?: any | undefined;
};
