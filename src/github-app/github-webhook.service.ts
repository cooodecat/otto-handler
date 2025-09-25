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
    // sender 정보도 함께 전달
    await this.ensureGithubAppRecord(installation, payload.sender);

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
    sender?: GitHubWebhookPayload['sender'],
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

    let user: User | null = null;

    // Organization vs Personal account 구분 처리
    if (installation.account.type === 'Organization' && sender) {
      // Organization: sender ID로 사용자 찾기
      this.logger.log(
        `🔍 Organization install - Looking for Otto user with sender githubId: ${sender.id} (${sender.login})`,
      );
      user = await this.userRepository.findOne({
        where: { githubId: sender.id },
      });

      if (!user) {
        // sender username으로 재시도
        user = await this.userRepository.findOne({
          where: { githubUserName: sender.login },
        });
      }
    } else {
      // Personal account: account ID로 사용자 찾기
      this.logger.log(
        `🔍 Personal install - Looking for Otto user with account githubId: ${installation.account.id} (${installation.account.login})`,
      );
      user = await this.userRepository.findOne({
        where: { githubId: installation.account.id },
      });
    }

    if (!user) {
      this.logger.error(
        `❌ No Otto user found for GitHub ${installation.account.type} ${installation.account.login} (${installation.account.id}). ` +
          `${installation.account.type === 'Organization' && sender ? `Sender: ${sender.login} (${sender.id}). ` : ''}` +
          `User needs to login to Otto first.`,
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
    this.logger.log(
      `[Installation] Processing created event for ${installation.account.login} (${installation.account.type})`,
    );

    // 디버깅: 현재 DB의 모든 사용자 조회
    const allUsers = await this.userRepository.find({
      select: ['userId', 'githubId', 'githubUserName', 'email'],
    });
    this.logger.log(
      `[Installation Debug] Total users in DB: ${allUsers.length}`,
    );
    allUsers.forEach((u) => {
      this.logger.log(
        `[Installation Debug] User in DB: githubId=${u.githubId}, githubUserName=${u.githubUserName}, userId=${u.userId}`,
      );
    });

    let user: User | null = null;
    const searchAttempts: string[] = [];

    // Organization과 User 타입에 따라 다른 검색 전략 사용
    if (installation.account.type === 'Organization') {
      // Organization 설치: sender(설치한 사람)로 검색
      if (sender) {
        // 1. sender ID로 시도
        searchAttempts.push(`sender.id=${sender.id}`);
        this.logger.log(
          `[Installation] Organization install - Searching by sender GitHub ID: ${sender.id} (${sender.login})`,
        );
        user = await this.userRepository.findOne({
          where: { githubId: sender.id },
        });
        if (user) {
          this.logger.log(
            `[Installation] ✅ Found user by sender ID: ${user.githubUserName} (${user.userId})`,
          );
        } else {
          this.logger.log(
            `[Installation] ❌ No user found with githubId=${sender.id}`,
          );

          // 2. sender username으로 시도
          searchAttempts.push(`sender.username=${sender.login}`);
          this.logger.log(
            `[Installation] Trying sender GitHub username: ${sender.login}`,
          );
          user = await this.userRepository.findOne({
            where: { githubUserName: sender.login },
          });
          if (user) {
            this.logger.log(
              `[Installation] ✅ Found user by username: ${user.githubUserName} (${user.userId})`,
            );
          } else {
            this.logger.log(
              `[Installation] ❌ No user found with githubUserName=${sender.login}`,
            );
          }
        }
      }
    } else {
      // Personal account 설치: account ID로 검색
      searchAttempts.push(`account.id=${installation.account.id}`);
      this.logger.log(
        `[Installation] Personal install - Searching by account GitHub ID: ${installation.account.id} (${installation.account.login})`,
      );
      user = await this.userRepository.findOne({
        where: { githubId: installation.account.id },
      });
      if (user) {
        this.logger.log(
          `[Installation] ✅ Found user by account ID: ${user.githubUserName} (${user.userId})`,
        );
      } else {
        this.logger.log(
          `[Installation] ❌ No user found with githubId=${installation.account.id}`,
        );

        // 개인 계정인데도 못 찾은 경우 username으로 시도
        searchAttempts.push(`account.username=${installation.account.login}`);
        this.logger.log(
          `[Installation] Trying account GitHub username: ${installation.account.login}`,
        );
        user = await this.userRepository.findOne({
          where: { githubUserName: installation.account.login },
        });
        if (user) {
          this.logger.log(
            `[Installation] ✅ Found user by username: ${user.githubUserName} (${user.userId})`,
          );
        } else {
          this.logger.log(
            `[Installation] ❌ No user found with githubUserName=${installation.account.login}`,
          );
        }
      }
    }

    if (!user) {
      this.logger.error(
        `[Installation] ❌ Failed to find Otto user after ${searchAttempts.length} attempts: [${searchAttempts.join(', ')}]. ` +
          `Installation: ${installation.account.login} (ID: ${installation.account.id}, Type: ${installation.account.type}), ` +
          `Sender: ${sender?.login || 'unknown'} (ID: ${sender?.id || 'unknown'}). ` +
          `User must login to Otto first with the GitHub account that will install the app.`,
      );
      return;
    }

    this.logger.log(
      `[Installation] ✅ Found Otto user: ${user.userId} (${user.githubUserName}) after ${searchAttempts.length} attempt(s)`,
    );

    // 같은 계정의 이전 Installation 정리 (선택적)
    // 새 Installation이 생성되면 같은 계정의 이전 것들은 사실상 무효화됨
    const previousInstallations = await this.githubAppRepository.find({
      where: {
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        userId: user.userId,
      },
    });

    if (previousInstallations.length > 0) {
      this.logger.log(
        `[Installation] Found ${previousInstallations.length} previous installation(s) for ${installation.account.login}`,
      );

      // 이전 Installation들 삭제 (선택적 - 히스토리를 유지하려면 주석 처리)
      // for (const prev of previousInstallations) {
      //   await this.githubAppRepository.delete({ installationId: prev.installationId });
      //   this.logger.log(`[Installation] Removed old installation ${prev.installationId}`);
      // }
    }

    // GithubApp 엔티티 생성 또는 업데이트
    const installationId = installation.id.toString();
    const existingGithubApp = await this.githubAppRepository.findOne({
      where: { installationId },
    });

    if (existingGithubApp) {
      this.logger.log(
        `[Installation] GitHub App record already exists for installation ${installationId}, updating it`,
      );
      // 기존 레코드가 있어도 업데이트 (사용자나 계정 정보가 변경될 수 있음)
      existingGithubApp.userId = user.userId;
      existingGithubApp.accountLogin = installation.account.login;
      existingGithubApp.accountType = installation.account.type;
      await this.githubAppRepository.save(existingGithubApp);
      this.logger.log(
        `[Installation] ✅ Updated existing GitHub App record for installation ${installationId}`,
      );
      return;
    }

    try {
      const githubApp = this.githubAppRepository.create({
        installationId,
        userId: user.userId,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
      });

      this.logger.log(
        `[Installation] 💾 Attempting to save new GitHub App record:`,
        {
          installationId,
          userId: user.userId,
          accountLogin: installation.account.login,
          accountType: installation.account.type,
        },
      );

      await this.githubAppRepository.save(githubApp);

      this.logger.log(
        `[Installation] ✅ Successfully created GitHub App record for installation ${installationId} (${installation.account.login})`,
      );

      // 저장 확인
      const verifyGithubApp = await this.githubAppRepository.findOne({
        where: { installationId },
        relations: ['user'],
      });

      if (verifyGithubApp) {
        this.logger.log(
          `[Installation] ✅ Verified: GitHub App record exists in DB with installationId=${verifyGithubApp.installationId}, userId=${verifyGithubApp.userId}`,
        );
      } else {
        this.logger.error(
          `[Installation] ❌ Verification failed: Could not find the saved GitHub App record`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[Installation] ❌ Failed to save GitHub App record for installation ${installationId}:`,
        error,
      );
      // error 스택 트레이스도 로그에 포함
      if (error instanceof Error) {
        this.logger.error(`[Installation] Error details: ${error.message}`);
        this.logger.error(`[Installation] Stack trace: ${error.stack}`);
      }
      throw error;
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
