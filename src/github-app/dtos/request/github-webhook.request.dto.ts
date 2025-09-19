export interface GitHubWebhookPayload {
  action?: string;
  installation?: {
    id: number;
    account: {
      login: string;
      id: number;
      type: 'User' | 'Organization';
    };
  };
  repository?: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
  };
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  }>;
  pusher?: {
    name: string;
    email: string;
  };
  pull_request?: {
    number: number;
    title: string;
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
    };
  };
  repositories_added?: Array<{
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
  }>;
  repositories_removed?: Array<{
    id: number;
    node_id: string;
    name: string;
    full_name: string;
    private: boolean;
  }>;
  sender?: {
    login: string;
    id: number;
    node_id: string;
    avatar_url: string;
    type: string;
  };
}

export interface GitHubInstallationWebhookPayload extends GitHubWebhookPayload {
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
      type: 'User' | 'Organization';
    };
  };
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend';
}

export interface GitHubInstallationDetails {
  id: number;
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
}

export interface GitHubPushWebhookPayload extends GitHubWebhookPayload {
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
  };
  ref: string;
  before: string;
  after: string;
  commits: Array<{
    id: string;
    message: string;
    author: {
      name: string;
      email: string;
    };
  }>;
  pusher: {
    name: string;
    email: string;
  };
}
