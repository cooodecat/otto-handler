export interface CreateProjectRequestDto {
  /** 프로젝트 이름 */
  projectName: string;
  /** 프로젝트 설명 (선택사항) */
  projectDescription?: string;
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
  /** CloudWatch 로그 그룹 */
  cloudwatchLogGroup: string;
  /** CodeBuild 프로젝트 ARN */
  codebuildProjectArn: string;
}
