export interface GithubRepositoryResponseDto {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    type: string;
  };
  description: string | null;
  private: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  archived: boolean;
  disabled: boolean;
  pushed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface GithubBranchResponseDto {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface GithubWebhookResponseDto {
  id: number;
  name: string;
  active: boolean;
  events: string[];
  config: {
    url?: string;
    content_type?: string;
    insecure_ssl?: string | number;
  };
  created_at: string;
  updated_at: string;
}
