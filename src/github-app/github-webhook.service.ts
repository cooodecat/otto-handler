import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../database/entities/project.entity';
import { GithubApp } from '../database/entities/github-app.entity';
import { User } from '../database/entities/user.entity';

import type { GitHubWebhookPayload, GitHubInstallationDetails } from './dtos';

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(GithubApp)
    private readonly githubAppRepository: Repository<GithubApp>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Push 이벤트 처리
   */
  async handlePushEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.repository || !payload.installation || !payload.ref) {
      this.logger.warn('Invalid push event payload');
      return;
    }

    const branchName = payload.ref.replace('refs/heads/', '');
    const installationId = payload.installation.id.toString();
    const repositoryId = payload.repository.id.toString();

    this.logger.log(
      `Processing push to ${payload.repository.full_name}:${branchName} (${payload.after})`,
    );

    // 해당 브랜치를 사용하는 프로젝트들 찾기
    const projects = await this.projectRepository.find({
      where: {
        installationId,
        githubRepositoryId: repositoryId,
        selectedBranch: branchName,
      },
      relations: ['user', 'githubApp'],
    });

    if (projects.length === 0) {
      this.logger.debug(
        `No projects found for ${payload.repository.full_name}:${branchName}`,
      );
      return;
    }

    // 각 프로젝트에 대해 Otto 파이프라인 실행
    for (const project of projects) {
      try {
        this.triggerOttoPipeline(project, payload);
      } catch (error) {
        this.logger.error(
          `Failed to trigger pipeline for project ${project.projectId}:`,
          error,
        );
      }
    }
  }

  /**
   * 브랜치 생성 이벤트 처리
   */
  handleBranchCreateEvent(payload: GitHubWebhookPayload): void {
    if (!payload.repository || !payload.ref) {
      return;
    }

    const branchName = payload.ref;
    this.logger.log(
      `New branch created: ${payload.repository.full_name}:${branchName}`,
    );

    // 브랜치 생성은 로깅만 하고 특별한 처리는 하지 않음
    // 필요하면 자동으로 해당 브랜치의 프로젝트를 생성하는 로직 추가 가능
  }

  /**
   * 브랜치 삭제 이벤트 처리
   */
  async handleBranchDeleteEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.repository || !payload.ref) {
      return;
    }

    const branchName = payload.ref;
    this.logger.log(
      `Branch deleted: ${payload.repository.full_name}:${branchName}`,
    );

    // 삭제된 브랜치를 사용하는 프로젝트가 있다면 경고 로그
    const affectedProjects = await this.projectRepository.count({
      where: {
        githubRepositoryId: payload.repository.id.toString(),
        selectedBranch: branchName,
      },
    });

    if (affectedProjects > 0) {
      this.logger.warn(
        `${affectedProjects} projects are using deleted branch ${payload.repository.full_name}:${branchName}`,
      );
    }
  }

  /**
   * Pull Request 이벤트 처리
   */
  async handlePullRequestEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.repository || !payload.pull_request || !payload.installation) {
      return;
    }

    const action = payload.action;
    const prNumber = payload.pull_request.number;
    const sourceBranch = payload.pull_request.head.ref;
    const targetBranch = payload.pull_request.base.ref;

    this.logger.log(
      `PR ${action}: ${payload.repository.full_name}#${prNumber} (${sourceBranch} → ${targetBranch})`,
    );

    // PR 이벤트에 따른 처리 (opened, synchronize, closed 등)
    if (action === 'opened' || action === 'synchronize') {
      // PR이 열리거나 업데이트되면 소스 브랜치에 대해 빌드 실행
      const projects = await this.projectRepository.find({
        where: {
          installationId: payload.installation.id.toString(),
          githubRepositoryId: payload.repository.id.toString(),
          selectedBranch: sourceBranch,
        },
        relations: ['user', 'githubApp'],
      });

      for (const project of projects) {
        try {
          this.triggerOttoPipeline(project, payload, `PR #${prNumber}`);
        } catch (error) {
          this.logger.error(
            `Failed to trigger PR pipeline for project ${project.projectId}:`,
            error,
          );
        }
      }
    }
  }

  /**
   * GitHub App 설치 이벤트 처리
   */
  async handleInstallationEvent(payload: GitHubWebhookPayload): Promise<void> {
    if (!payload.installation || !payload.action) {
      this.logger.warn('Installation event received without installation data');
      return;
    }

    const typedPayload = payload as Required<
      Pick<GitHubWebhookPayload, 'installation' | 'action'>
    >;
    const action = typedPayload.action;
    const installation = typedPayload.installation;

    this.logger.log(
      `🔧 GitHub App installation ${action}: ${installation.account.login} (${installation.id})`,
    );

    const installationDetails: GitHubInstallationDetails = {
      id: installation.id,
      account: installation.account,
    };

    switch (action) {
      case 'created':
        await this.handleInstallationCreated(
          installationDetails,
          payload.sender,
        );
        break;
      case 'deleted':
        await this.handleInstallationDeleted(installationDetails);
        break;
      case 'suspend':
        this.handleInstallationSuspended(installationDetails);
        break;
      case 'unsuspend':
        this.handleInstallationUnsuspended(installationDetails);
        break;
    }
  }

  /**
   * GitHub App 리포지토리 설치 변경 이벤트 처리
   */
  async handleInstallationRepositoriesEvent(
    payload: GitHubWebhookPayload,
  ): Promise<void> {
    if (!payload.installation || !payload.action) {
      return;
    }

    const action = payload.action;
    const installation = payload.installation;
    const installationId = installation.id.toString();

    this.logger.log(
      `Installation repositories ${action} for installation ${installationId}`,
    );

    // GitHub App 레코드가 없으면 생성 (기존 설치에 리포지토리 추가하는 경우)
    await this.ensureGithubAppRecord(installation);

    if (action === 'added' && payload.repositories_added) {
      this.logger.log(
        `Added repositories: ${payload.repositories_added.map((repo) => repo.full_name).join(', ')}`,
      );
    } else if (action === 'removed' && payload.repositories_removed) {
      this.logger.log(
        `Removed repositories: ${payload.repositories_removed.map((repo) => repo.full_name).join(', ')}`,
      );
    }
  }

  /**
   * GitHub App 레코드가 없으면 생성
   */
  private async ensureGithubAppRecord(
    installation: GitHubWebhookPayload['installation'],
  ): Promise<void> {
    if (!installation) {
      this.logger.warn('No installation data provided');
      return;
    }

    const installationId = installation.id.toString();
    this.logger.log(
      `🔍 Checking GitHub App record for installation ${installationId}`,
    );

    // 기존 레코드 확인
    const existingGithubApp = await this.githubAppRepository.findOne({
      where: { installationId },
    });

    if (existingGithubApp) {
      this.logger.log(
        `✅ GitHub App record already exists for installation ${installationId}`,
      );
      return; // 이미 존재함
    }

    this.logger.log(
      `📝 No existing GitHub App record found, creating new one for installation ${installationId}`,
    );

    // GitHub 사용자 ID로 Otto 사용자 찾기
    this.logger.log(
      `🔍 Looking for Otto user with githubId: ${installation.account.id}`,
    );
    const user = await this.userRepository.findOne({
      where: { githubId: installation.account.id },
    });

    if (!user) {
      this.logger.error(
        `❌ No Otto user found for GitHub user ${installation.account.login} (${installation.account.id}). User needs to login to Otto first.`,
      );
      return;
    }

    this.logger.log(
      `✅ Found Otto user: ${user.userId} for GitHub user ${installation.account.login}`,
    );

    try {
      // GitHub App 레코드 생성
      const githubApp = this.githubAppRepository.create({
        installationId,
        userId: user.userId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      });

      this.logger.log(`💾 Saving GitHub App record:`, {
        installationId,
        userId: user.userId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      });

      const savedGithubApp = await this.githubAppRepository.save(githubApp);
      this.logger.log(
        `✅ Successfully created GithubApp record for installation ${installationId} (${installation.account.login})`,
        savedGithubApp,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to save GitHub App record for installation ${installationId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Otto 파이프라인 실행
   */
  private triggerOttoPipeline(
    project: Project,
    _payload: GitHubWebhookPayload,
    context?: string,
  ): void {
    const pipelineContext = context || 'Push Event';

    this.logger.log(
      `Triggering Otto pipeline for project ${project.projectName} (${project.projectId}) - ${pipelineContext}`,
    );

    // TODO: Otto 파이프라인 실행 로직 구현
    // 예시:
    // await this.pipelineService.triggerPipeline({
    //   projectId: project.projectId,
    //   repositoryId: project.githubRepositoryId,
    //   branch: project.selectedBranch,
    //   commitSha: payload.after,
    //   commits: payload.commits,
    //   pusher: payload.pusher,
    //   context: pipelineContext
    // });

    this.logger.debug(`Pipeline triggered for project ${project.projectId}`);
  }

  /**
   * GitHub App 설치 생성 처리
   */
  private async handleInstallationCreated(
    installation: GitHubInstallationDetails,
    sender?: GitHubWebhookPayload['sender'],
  ): Promise<void> {
    // Organization 설치인 경우 sender ID 사용, 개인 설치인 경우 account ID 사용
    const searchUserId =
      installation.account.type === 'Organization' && sender
        ? sender.id
        : installation.account.id;

    this.logger.log(
      `🔍 Looking for Otto user with GitHub ID: ${searchUserId} (${installation.account.type === 'Organization' ? 'sender' : 'account'} ID)`,
    );

    // GitHub 사용자 ID로 Otto 사용자 찾기
    const user = await this.userRepository.findOne({
      where: { githubId: searchUserId },
    });

    if (!user) {
      this.logger.warn(
        `⚠️ No Otto user found for GitHub ID ${searchUserId}. Installation: ${installation.account.login} (${installation.account.id}), Sender: ${sender?.login || 'unknown'} (${sender?.id || 'unknown'}). User needs to login to Otto first.`,
      );
      return;
    }

    this.logger.log(
      `✅ Found Otto user: ${user.userId} for GitHub ID ${searchUserId}`,
    );

    // GithubApp 엔티티 생성 또는 업데이트
    const existingGithubApp = await this.githubAppRepository.findOne({
      where: { installationId: installation.id.toString() },
    });

    if (!existingGithubApp) {
      const githubApp = this.githubAppRepository.create({
        installationId: installation.id.toString(),
        userId: user.userId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      });

      await this.githubAppRepository.save(githubApp);
      this.logger.log(
        `✅ Created GithubApp record for installation ${installation.id} (${installation.account.login})`,
      );
    }
  }

  /**
   * GitHub App 설치 삭제 처리
   */
  private async handleInstallationDeleted(
    installation: GitHubInstallationDetails,
  ): Promise<void> {
    const installationId = installation.id.toString();

    // 관련 프로젝트들의 상태 업데이트
    await this.projectRepository.update(
      { installationId },
      { installationId: undefined },
    );

    // GithubApp 엔티티 삭제
    await this.githubAppRepository.delete({ installationId });

    this.logger.log(
      `Cleaned up data for deleted installation ${installationId}`,
    );
  }

  /**
   * GitHub App 설치 일시 중단 처리
   */
  private handleInstallationSuspended(
    installation: GitHubInstallationDetails,
  ): void {
    // 일시 중단된 설치의 프로젝트들 비활성화 등의 처리
    this.logger.log(`Installation ${installation.id} suspended`);
  }

  /**
   * GitHub App 설치 일시 중단 해제 처리
   */
  private handleInstallationUnsuspended(
    installation: GitHubInstallationDetails,
  ): void {
    // 일시 중단 해제된 설치의 프로젝트들 활성화 등의 처리
    this.logger.log(`Installation ${installation.id} unsuspended`);
  }
}
