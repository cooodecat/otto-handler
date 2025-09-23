export type GithubBranchResponseDto = {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
};
