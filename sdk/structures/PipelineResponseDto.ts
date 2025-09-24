import type { Format } from "typia/lib/tags/Format";

export type PipelineResponseDto = {
  /**
   * 파이프라인 ID
   */
  pipelineId: string;

  /**
   * 배포 주소
   */
  deployUrl: null | string;

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
  ecrImageUri?: null | undefined | string;

  /**
   * 이미지 태그 (빌드 번호 기반)
   */
  imageTag?: null | undefined | string;

  /**
   * 배포 옵션 (포트 및 커맨드)
   */
  deployOption?:
    | null
    | undefined
    | {
        port: number;
        command: string;
      };

  /**
   * 생성일
   */
  createdAt: string & Format<"date-time">;

  /**
   * 수정일
   */
  updatedAt: string & Format<"date-time">;
};
