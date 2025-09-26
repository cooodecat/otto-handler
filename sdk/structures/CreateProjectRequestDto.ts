import type { CICDNodeData } from "./CICDNodeData";

export type CreateProjectRequestDto = {
  /**
   * 프로젝트 이름
   */
  projectName: string;

  /**
   * 프로젝트 설명 (선택사항)
   */
  projectDescription?: undefined | string;

  /**
   * GitHub 저장소 이름
   */
  githubRepositoryName: string;

  /**
   * GitHub 저장소 ID
   */
  githubRepositoryId: string;

  /**
   * GitHub 소유자 이름
   */
  githubOwner: string;

  /**
   * 선택된 브랜치
   */
  selectedBranch: string;

  /**
   * GitHub App 설치 ID
   */
  installationId?: undefined | string;

  /**
   * CI/CD Flow 노드 데이터
   */
  flowNodes?: undefined | CICDNodeData[];

  /**
   * CodeBuild 프로젝트 이름 (Backend 자동 생성)
   */
  codebuildProjectName?: undefined | string;

  /**
   * CloudWatch 로그 그룹 (Backend 자동 생성)
   */
  cloudwatchLogGroup?: undefined | string;

  /**
   * CodeBuild 프로젝트 ARN (Backend 자동 생성)
   */
  codebuildProjectArn?: undefined | string;
};
