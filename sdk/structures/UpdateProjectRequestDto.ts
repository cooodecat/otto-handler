export type UpdateProjectRequestDto = {
  /**
   * 프로젝트 이름
   */
  projectName?: undefined | string;

  /**
   * 프로젝트 설명
   */
  projectDescription?: undefined | string;

  /**
   * 선택된 브랜치
   */
  selectedBranch?: undefined | string;
};
