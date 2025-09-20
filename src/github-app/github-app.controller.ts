import { Controller, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { GithubAppService } from './github-app.service';
import { TypedParam, TypedException, TypedRoute } from '@nestia/core';
import { CommonErrorResponseDto } from '../common/dtos';
import { AuthGuard } from '../common/decorator';
import type {
  GithubRepositoryResponseDto,
  GithubBranchResponseDto,
  GithubInstallationResponseDto,
  GithubInstallationUrlResponseDto,
} from './dtos';
import type { IRequestType } from '../common/type';

@Controller('/github-app')
export class GithubAppController {
  constructor(private readonly githubAppService: GithubAppService) {}

  /**
   * @tag github-app
   * @summary GitHub App Installation의 리포지토리 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Installation을 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/installations/:installationId/repositories')
  @AuthGuard()
  async getInstallationRepositories(
    @TypedParam('installationId') installationId: string,
  ): Promise<GithubRepositoryResponseDto[]> {
    return this.githubAppService.getInstallationRepositories({
      installation_id: installationId,
    });
  }

  /**
   * @tag github-app
   * @summary 특정 리포지토리의 브랜치 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Repository를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get(
    '/installations/:installationId/repositories/:owner/:repo/branches',
  )
  @AuthGuard()
  async getRepositoryBranches(
    @TypedParam('installationId') installationId: string,
    @TypedParam('owner') owner: string,
    @TypedParam('repo') repo: string,
  ): Promise<GithubBranchResponseDto[]> {
    return this.githubAppService.getRepositoryBranches(installationId, {
      owner,
      repo,
    });
  }

  /**
   * @tag github-app
   * @summary 프로젝트의 브랜치 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.NOT_FOUND,
    description: 'Project를 찾을 수 없음',
  })
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/projects/:projectId/branches')
  @AuthGuard()
  async getProjectBranches(
    @TypedParam('projectId') projectId: string,
    @Req() req: IRequestType,
  ): Promise<GithubBranchResponseDto[]> {
    return this.githubAppService.getProjectBranches(projectId, req.user.userId);
  }

  /**
   * @tag github-app
   * @summary 사용자가 접근할 수 있는 모든 리포지토리 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/repositories')
  @AuthGuard()
  async getUserRepositories(
    @Req() req: IRequestType,
  ): Promise<GithubRepositoryResponseDto[]> {
    return this.githubAppService.getUserRepositories(req.user.userId);
  }

  /**
   * @tag github-app
   * @summary 사용자의 GitHub App 설치 목록 조회
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/installations')
  @AuthGuard()
  async getUserInstallations(
    @Req() req: IRequestType,
  ): Promise<GithubInstallationResponseDto[]> {
    return this.githubAppService.getUserInstallations(req.user.userId);
  }

  /**
   * @tag github-app
   * @summary GitHub App 설치 URL 생성
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: '인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Get('/installation-url')
  @AuthGuard()
  getInstallationUrl(): GithubInstallationUrlResponseDto {
    return this.githubAppService.getInstallationUrl();
  }
}
