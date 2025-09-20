export const GITHUB_APP_CONSTANTS = {
  // GitHub API URLs
  GITHUB_API_BASE_URL: 'https://api.github.com',
  GITHUB_APP_API_VERSION: '2022-11-28',

  // Default webhook events
  DEFAULT_WEBHOOK_EVENTS: ['push', 'create', 'delete', 'pull_request'],

  // Content types
  WEBHOOK_CONTENT_TYPE: {
    JSON: 'json',
    FORM: 'form',
  } as const,
} as const;

export const GITHUB_APP_ERRORS = {
  INSTALLATION_NOT_FOUND: 'GitHub App installation not found',
  REPOSITORY_NOT_FOUND: 'Repository not found',
  WEBHOOK_CREATION_FAILED: 'Failed to create webhook',
  AUTHENTICATION_FAILED: 'GitHub App authentication failed',
  RATE_LIMIT_EXCEEDED: 'GitHub API rate limit exceeded',
} as const;
