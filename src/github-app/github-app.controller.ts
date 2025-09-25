import { Controller, HttpCode, HttpStatus, Logger, Req } from '@nestjs/common';
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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GithubApp } from '../database/entities/github-app.entity';
import { User } from '../database/entities/user.entity';

@Controller('/github-app')
export class GithubAppController {
  private readonly logger = new Logger(GithubAppController.name);

  constructor(
    private readonly githubAppService: GithubAppService,
    @InjectRepository(GithubApp)
    private readonly githubAppRepository: Repository<GithubApp>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

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

  /**
   * @tag github-app
   * @summary [디버그] GitHub App 설치 상태 확인
   * @description 현재 DB에 저장된 모든 GitHub App 설치 정보와 사용자 정보를 조회합니다
   */
  @HttpCode(200)
  @TypedRoute.Get('/debug/installations')
  async debugInstallations(): Promise<{
    installations: any[];
    users: any[];
    totalInstallations: number;
    totalUsers: number;
  }> {
    this.logger.log('[Debug] Fetching all GitHub App installations');

    const installations = await this.githubAppRepository.find({
      relations: ['user'],
    });

    const users = await this.userRepository.find({
      select: ['userId', 'githubId', 'githubUserName', 'email'],
    });

    const result = {
      installations: installations.map((inst) => ({
        installationId: inst.installationId,
        accountLogin: inst.accountLogin,
        accountType: inst.accountType,
        userId: inst.userId,
        userName: inst.user?.githubUserName,
        userGithubId: inst.user?.githubId,
        createdAt: inst.createdAt,
        updatedAt: inst.updatedAt,
      })),
      users: users.map((user) => ({
        userId: user.userId,
        githubId: user.githubId,
        githubUserName: user.githubUserName,
        email: user.email,
      })),
      totalInstallations: installations.length,
      totalUsers: users.length,
    };

    this.logger.log(
      `[Debug] Found ${installations.length} installations and ${users.length} users`,
    );

    return result;
  }
}
