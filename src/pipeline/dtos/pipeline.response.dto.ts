export interface PipelineResponseDto {
  /**
   * 파이프라인 ID
   */
  pipelineId: string;

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

  /**
   * 생성일
   */
  createdAt: Date;

  /**
   * 수정일
   */
  updatedAt: Date;
}
