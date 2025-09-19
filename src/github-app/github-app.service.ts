import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { Octokit } from '@octokit/rest';
import type { App } from '@octokit/app';
import { Project } from '../database/entities/project.entity';
import { GithubApp } from '../database/entities/github-app.entity';
import { User } from '../database/entities/user.entity';
import {
  GithubRepositoryResponseDto,
  GithubBranchResponseDto,
  GithubInstallationResponseDto,
  GithubInstallationUrlResponseDto,
  GetRepositoriesRequestDto,
  GetBranchesRequestDto,
} from './dtos';
import { GITHUB_APP_ERRORS } from './constant/github-app.constants';

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  private app: App;

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(GithubApp)
    private readonly githubAppRepository: Repository<GithubApp>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {
    const appId = this.configService.get<string>('GITHUB_APP_ID');
    const privateKey = this.configService.get<string>('GITHUB_APP_PRIVATE_KEY');

    if (!appId || !privateKey) {
      this.logger.error('GitHub App configuration missing');
      throw new Error('GitHub App configuration missing');
    }

    this.initializeApp(appId, privateKey).catch((error) => {
      this.logger.error('Failed to initialize GitHub App:', error);
      throw new Error('Failed to initialize GitHub App');
    });
  }

  private async initializeApp(appId: string, privateKey: string) {
    const { App } = await import('@octokit/app');
    
    // Private key 포맷 정리
    let formattedPrivateKey = privateKey;
    
    // 이스케이프된 \n을 실제 개행문자로 변환
    if (formattedPrivateKey.includes('\\n')) {
      formattedPrivateKey = formattedPrivateKey.replace(/\\n/g, '\n');
    }
    
    // PEM 형식 헤더/푸터 확인 및 추가
    if (!formattedPrivateKey.includes('-----BEGIN') && !formattedPrivateKey.includes('-----END')) {
      this.logger.error('Private key is missing PEM headers');
      throw new Error('Invalid private key format');
    }
    
    this.app = new App({
      appId: parseInt(appId),
      privateKey: formattedPrivateKey,
    });
    
    this.logger.log('GitHub App initialized successfully');
  }

  /**
   * GitHub App Installation의 리포지토리 목록 조회
   */
  async getInstallationRepositories(
    params: GetRepositoriesRequestDto,
  ): Promise<GithubRepositoryResponseDto[]> {
    try {
      const installationId = parseInt(params.installation_id);
      const octokit = await this.app.getInstallationOctokit(installationId);

      // Installation octokit으로 installation repositories 목록 조회
      const { data } = await (
        octokit as Octokit
      ).request('GET /installation/repositories', {
        per_page: 100,
      });

      return data.repositories.map((repo) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        owner: {
          login: repo.owner.login,
          id: repo.owner.id,
          avatar_url: repo.owner.avatar_url,
          type: repo.owner.type,
        },
        description: repo.description,
        private: repo.private,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        default_branch: repo.default_branch,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count,
        open_issues_count: repo.open_issues_count,
        archived: repo.archived,
        disabled: repo.disabled,
        pushed_at: repo.pushed_at,
        created_at: repo.created_at!,
        updated_at: repo.updated_at,
      }));
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get repositories for installation ${params.installation_id}:`,
        error,
      );
      throw new NotFoundException(GITHUB_APP_ERRORS.INSTALLATION_NOT_FOUND);
    }
  }

  /**
   * 특정 리포지토리의 브랜치 목록 조회
   */
  async getRepositoryBranches(
    installationId: string,
    params: GetBranchesRequestDto,
  ): Promise<GithubBranchResponseDto[]> {
    try {
      const octokit = await this.app.getInstallationOctokit(
        parseInt(installationId),
      );

      const { data } = await (
        octokit as Octokit
      ).request('GET /repos/{owner}/{repo}/branches', {
        owner: params.owner,
        repo: params.repo,
        per_page: 100,
      });

      return data;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get branches for ${params.owner}/${params.repo}:`,
        error,
      );
      throw new BadRequestException('Failed to fetch repository branches');
    }
  }

  /**
   * 프로젝트의 브랜치 목록 조회 (프로젝트 ID로)
   */
  async getProjectBranches(
    projectId: string,
    userId: string,
  ): Promise<GithubBranchResponseDto[]> {
    const project = await this.projectRepository.findOne({
      where: { projectId, userId },
      relations: ['githubApp'],
    });

    if (
      !project ||
      !project.githubApp ||
      !project.githubRepositoryName ||
      !project.githubOwner ||
      !project.installationId
    ) {
      throw new NotFoundException('Project or GitHub configuration not found');
    }

    return this.getRepositoryBranches(project.installationId, {
      owner: project.githubOwner,
      repo: project.githubRepositoryName,
    });
  }

  /**
   * 사용자가 접근할 수 있는 리포지토리 목록 조회 (여러 installation 통합)
   */
  async getUserRepositories(
    userId: string,
  ): Promise<GithubRepositoryResponseDto[]> {
    try {
      // 사용자의 모든 GitHub App 설치에서 installation ID 수집
      const githubApps = await this.githubAppRepository.find({
        where: { userId },
      });

      const installationIds = githubApps.map((app) => app.installationId);

      if (installationIds.length === 0) {
        return [];
      }

      const allRepositories: GithubRepositoryResponseDto[] = [];

      for (const installationId of installationIds) {
        try {
          const repositories = await this.getInstallationRepositories({
            installation_id: installationId,
          });
          allRepositories.push(...repositories);
        } catch (error) {
          this.logger.warn(
            `Failed to get repositories for installation ${installationId}:`,
            error,
          );
        }
      }

      // 중복 제거 (repository ID 기준)
      return allRepositories.filter(
        (repo, index, self) =>
          index === self.findIndex((r) => r.id === repo.id),
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get user repositories for user ${userId}:`,
        error,
      );
      throw new BadRequestException('Failed to fetch user repositories');
    }
  }

  /**
   * 사용자의 GitHub App 설치 목록 조회 (Vercel 스타일 계정 선택용)
   */
  async getUserInstallations(
    userId: string,
  ): Promise<GithubInstallationResponseDto[]> {
    try {
      // 사용자의 모든 GitHub App 설치 정보
      const githubApps = await this.githubAppRepository.find({
        where: { userId },
        order: { createdAt: 'DESC' },
      });

      const installations: GithubInstallationResponseDto[] = [];

      for (const githubApp of githubApps) {
        try {
          // DB에 저장된 정보로 Installation 응답 구성 (API 호출 없이)
          installations.push({
            id: githubApp.installationId,
            account: {
              login: githubApp.accountLogin,
              id: 0, // GitHub user ID는 DB에 없으므로 0으로 설정
              type: githubApp.accountType as 'User' | 'Organization',
              avatar_url: `https://github.com/${githubApp.accountLogin}.png`,
            },
            repository_selection: 'selected', // 기본값
            created_at: githubApp.createdAt.toISOString(),
            updated_at: githubApp.updatedAt.toISOString(),
          });
        } catch (error) {
          this.logger.warn(
            `Failed to process installation ${githubApp.installationId}:`,
            error,
          );
        }
      }

      return installations;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to get user installations for user ${userId}:`,
        error,
      );
      throw new BadRequestException('Failed to fetch user installations');
    }
  }

  /**
   * GitHub App 설치 URL 생성
   */
  getInstallationUrl(): GithubInstallationUrlResponseDto {
    const appSlug = this.configService.get<string>('GITHUB_APP_SLUG');

    if (!appSlug) {
      throw new BadRequestException('GitHub App slug not configured');
    }

    return {
      installation_url: `https://github.com/apps/${appSlug}/installations/new`,
      app_slug: appSlug,
    };
  }
}
