export * from './github-webhook.request.dto';

export interface GetRepositoriesRequestDto {
  installation_id: string;
}

export interface GetBranchesRequestDto {
  owner: string;
  repo: string;
}
