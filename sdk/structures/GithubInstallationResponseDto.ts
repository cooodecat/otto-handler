export type GithubInstallationResponseDto = {
  id: string;
  account: {
    login: string;
    id: number;
    type: "User" | "Organization";
    avatar_url: string;
  };
  repository_selection: "all" | "selected";
  created_at: string;
  updated_at: string;
};
