export interface GithubInstallationResponseDto {
  id: string; // installationId
  account: {
    login: string; // @username or @orgname
    id: number;
    type: 'User' | 'Organization';
    avatar_url: string;
  };
  repository_selection: 'all' | 'selected';
  created_at: string;
  updated_at: string;
}

export interface GithubInstallationUrlResponseDto {
  installation_url: string;
  app_slug: string;
}
