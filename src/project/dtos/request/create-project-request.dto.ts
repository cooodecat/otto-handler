import { CICDNodeData } from '../../../database/entities/pipeline.entity';

export interface CreateProjectRequestDto {
  /** 프로젝트 이름 */
  projectName: string;
  /** 프로젝트 설명 (선택사항) */
  projectDescription?: string;
  /** GitHub 저장소 이름 */
  githubRepositoryName: string;
  /** GitHub 저장소 ID */
  githubRepositoryId: string;
  /** GitHub 소유자 이름 */
  githubOwner: string;
  /** 선택된 브랜치 */
  selectedBranch: string;
  /** GitHub App 설치 ID */
  installationId?: string;
  /** CI/CD Flow 노드 데이터 */
  flowNodes?: CICDNodeData[];

  // AWS 관련 필드들은 Backend에서 자동 생성 (Frontend에서 제거)
  /** CodeBuild 프로젝트 이름 (Backend 자동 생성) */
  codebuildProjectName?: string;
  /** CloudWatch 로그 그룹 (Backend 자동 생성) */
  cloudwatchLogGroup?: string;
  /** CodeBuild 프로젝트 ARN (Backend 자동 생성) */
  codebuildProjectArn?: string;
}
