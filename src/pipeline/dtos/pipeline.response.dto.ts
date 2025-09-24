export interface PipelineResponseDto {
  /**
   * 파이프라인 ID
   */
  pipelineId: string;

  /**
   * 배포 주소
   */
  deployUrl: string | null;

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
   * ECR 이미지 URI (빌드된 이미지 전체 URI)
   */
  ecrImageUri?: string | null;

  /**
   * 이미지 태그 (빌드 번호 기반)
   */
  imageTag?: string | null;

  /**
   * 배포 옵션 (포트 및 커맨드)
   */
  deployOption?: { port: number; command: string } | null;

  /**
   * 생성일
   */
  createdAt: Date;

  /**
   * 수정일
   */
  updatedAt: Date;
}
