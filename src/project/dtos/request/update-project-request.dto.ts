export interface UpdateProjectRequestDto {
  /** 프로젝트 이름 */
  projectName?: string;
  /** 프로젝트 설명 */
  projectDescription?: string;
  /** 선택된 브랜치 */
  selectedBranch?: string;
}
