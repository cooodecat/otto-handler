export interface GitHubTokenType {
  access_token?: string;
  token_type?: 'bearer';
  scope?: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}
