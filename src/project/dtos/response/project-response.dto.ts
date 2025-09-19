import { ProjectStatus } from '../../../database/entities/project.entity';

export interface ProjectResponseDto {
  /** 프로젝트 ID */
  projectId: string;
  /** 사용자 ID */
  userId: string;
  /** 프로젝트 이름 */
  projectName: string;
  /** 프로젝트 설명 */
  projectDescription: string | null;
  /** GitHub 저장소 URL */
  githubRepositoryUrl: string;
  /** GitHub 저장소 이름 */
  githubRepositoryName: string;
  /** GitHub 저장소 ID */
  githubRepositoryId: string;
  /** GitHub 소유자 이름 */
  githubOwner: string;
  /** GitHub 소유자 ID */
  githubOwnerId: string;
  /** 선택된 브랜치 */
  selectedBranch: string;
  /** GitHub App 설치 ID */
  installationId: string;
  /** CodeBuild 프로젝트 이름 */
  codebuildProjectName: string;
  /** 빌드 이미지 */
  buildImage: string;
  /** 컴퓨트 타입 */
  computeType: string;
  /** 빌드 타임아웃 (분) */
  buildTimeout: number;
  /** CloudWatch 로그 그룹 */
  cloudwatchLogGroup: string;
  /** CodeBuild 상태 */
  codebuildStatus: ProjectStatus;
  /** CodeBuild 에러 메시지 */
  codebuildErrorMessage: string | null;
  /** CodeBuild 프로젝트 ARN */
  codebuildProjectArn: string;
  /** 생성일 */
  createdAt: Date;
  /** 수정일 */
  updatedAt: Date;
}
