import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CodeBuildClient,
  CreateProjectCommand,
  StartBuildCommand,
  BatchGetBuildsCommand,
  DeleteProjectCommand,
  LogsConfigStatusType,
} from '@aws-sdk/client-codebuild';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { BuildSpecGeneratorService } from './buildspec-generator.service';
import { ECRService } from './ecr.service';
import { EventBridgeService } from './eventbridge.service';
import { CloudWatchLogsService } from './cloudwatch-logs.service';
import { Execution } from '../database/entities/execution.entity';
import {
  ExecutionType,
  ExecutionStatus,
} from '../database/entities/execution.entity';

// Flow 노드 타입 (frontend와 동일)
interface AnyCICDNodeData {
  blockType: string;
  groupType: string;
  blockId: string;
  onSuccess: string | null;
  onFailed: string | null;
  [key: string]: any;
}

@Injectable()
export class CodeBuildService {
  private readonly logger = new Logger(CodeBuildService.name);
  private readonly codeBuildClient: CodeBuildClient;
  private readonly stsClient: STSClient;

  constructor(
    @InjectRepository(Execution)
    private readonly executionRepository: Repository<Execution>,
    private readonly buildSpecGenerator: BuildSpecGeneratorService,
    private readonly ecrService: ECRService,
    private readonly eventBridgeService: EventBridgeService,
    private readonly cloudWatchLogsService: CloudWatchLogsService,
  ) {
    const region = process.env.AWS_REGION || 'ap-northeast-2';

    this.codeBuildClient = new CodeBuildClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    this.stsClient = new STSClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  /**
   * CodeBuild 프로젝트 생성
   */
  async createProject(config: {
    userId: string;
    projectId: string;
    projectName: string;
    githubRepositoryUrl: string;
    branch: string;
    flowNodes: AnyCICDNodeData[];
    buildImage?: string;
    computeType?: string;
    timeoutInMinutes?: number;
  }): Promise<{
    arn: string;
    projectName: string;
    logGroup: string;
    ecrRepository: string;
    ecrRepositoryUri: string;
  }> {
    try {
      // 1. buildspec.yml 생성
      const buildSpec = this.buildSpecGenerator.generateBuildSpec(
        config.flowNodes,
      );
      this.logger.log(`Generated buildspec for project ${config.projectId}`);

      // 2. AWS 설정 기본값 처리
      const buildImage = config.buildImage || 'aws/codebuild/standard:7.0';
      const computeType = config.computeType || 'BUILD_GENERAL1_MEDIUM';
      const timeoutInMinutes = config.timeoutInMinutes || 60;

      // 3. AWS Account ID 조회
      const { Account } = await this.stsClient.send(
        new GetCallerIdentityCommand({}),
      );
      const region = process.env.AWS_REGION || 'ap-northeast-2';
      const environment = process.env.NODE_ENV || 'development';

      // 4. Otto 명명 규칙 적용
      const codebuildProjectName = `otto-${environment}-${config.projectId}-build`;
      const cloudwatchLogGroup = `/aws/codebuild/otto/${environment}/${config.userId}/${config.projectId}`;

      // 서비스 역할 설정 - 환경변수가 있으면 사용, 없으면 기본 역할 생성
      const serviceRoleArn =
        process.env.CODEBUILD_SERVICE_ROLE_ARN ||
        `arn:aws:iam::${Account}:role/codebuild-${codebuildProjectName}-service-role`;

      // 5. ECR Repository 생성
      const ecrResult = await this.ecrService.createRepositoryIfNotExists({
        userId: config.userId,
        projectId: config.projectId,
      });

      this.logger.log(`ECR Repository ready: ${ecrResult.repositoryName}`);

      // 6. CloudWatch 로그 그룹 생성 (CodeBuild 프로젝트보다 먼저 생성)
      await this.cloudWatchLogsService.createLogGroup(cloudwatchLogGroup, 7);
      this.logger.log(`CloudWatch log group created: ${cloudwatchLogGroup}`);

      // 7. CodeBuild 프로젝트 생성
      const createProjectInput = {
        name: codebuildProjectName,
        description: `Otto project: ${config.projectName}`,
        source: {
          type: 'GITHUB' as const,
          location: config.githubRepositoryUrl,
          buildspec: buildSpec, // 인라인 buildspec 사용
          gitCloneDepth: 1,
          gitSubmodulesConfig: {
            fetchSubmodules: false,
          },
        },
        sourceVersion: config.branch, // 브랜치 지정
        artifacts: {
          type: 'NO_ARTIFACTS' as const, // ECR 사용하므로 S3 아티팩트 불필요
        },
        environment: {
          type: 'LINUX_CONTAINER' as const,
          image: buildImage,
          computeType: computeType as
            | 'BUILD_GENERAL1_SMALL'
            | 'BUILD_GENERAL1_MEDIUM'
            | 'BUILD_GENERAL1_LARGE'
            | 'BUILD_GENERAL1_2XLARGE',
          privilegedMode: true, // Docker 빌드를 위해 필수
          environmentVariables: [
            {
              name: 'AWS_ACCOUNT_ID',
              value: Account,
            },
            {
              name: 'AWS_DEFAULT_REGION',
              value: region,
            },
            {
              name: 'IMAGE_REPO_NAME',
              value: ecrResult.repositoryName,
            },
            {
              name: 'USER_ID',
              value: config.userId,
            },
            {
              name: 'PROJECT_ID',
              value: config.projectId,
            },
            {
              name: 'PROJECT_NAME',
              value: config.projectName,
            },
            {
              name: 'NODE_ENV',
              value: environment,
            },
          ],
        },
        timeoutInMinutes,
        logsConfig: {
          cloudWatchLogs: {
            status: LogsConfigStatusType.ENABLED,
            groupName: cloudwatchLogGroup,
            // streamName은 AWS에서 자동 생성 (buildId 사용)
          },
        },
        tags: [
          {
            key: 'Project',
            value: 'Otto',
          },
          {
            key: 'Environment',
            value: environment,
          },
          {
            key: 'UserId',
            value: config.userId,
          },
          {
            key: 'ProjectId',
            value: config.projectId,
          },
          {
            key: 'ManagedBy',
            value: 'Otto-System',
          },
        ],
      };

      // 서비스 역할 추가
      const createProjectInputWithRole = {
        ...createProjectInput,
        serviceRole: serviceRoleArn,
      };
      this.logger.log(`Using service role: ${serviceRoleArn}`);

      const result = await this.codeBuildClient.send(
        new CreateProjectCommand(createProjectInputWithRole),
      );

      this.logger.log(
        `CodeBuild project created successfully: ${codebuildProjectName}`,
      );

      // 8. EventBridge Rule 생성 (실시간 로그 이벤트 수신용 - 필수)
      await this.eventBridgeService.createCodeBuildEventRule(
        codebuildProjectName,
      );
      this.logger.log(
        `EventBridge rule created for project: ${codebuildProjectName}`,
      );

      return {
        arn: result.project?.arn || '',
        projectName: codebuildProjectName,
        logGroup: cloudwatchLogGroup,
        ecrRepository: ecrResult.repositoryName,
        ecrRepositoryUri: ecrResult.repositoryUri,
      };
    } catch (error) {
      this.logger.error(
        `Failed to create CodeBuild project: ${(error as Error).message}`,
      );
      throw new Error(
        `CodeBuild 프로젝트 생성 실패: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 빌드 실행
   */
  async startBuild(config: {
    projectName: string;
    userId: string;
    projectId: string;
    pipelineId?: string;
    flowNodes?: AnyCICDNodeData[];
  }): Promise<{
    buildId: string;
    buildNumber: string;
    imageTag: string;
  }> {
    try {
      // flowNodes가 있으면 새로운 buildspec 생성
      let sourceOverrides: { buildspecOverride?: string } | undefined =
        undefined;
      if (config.flowNodes && config.flowNodes.length > 0) {
        const updatedBuildSpec = this.buildSpecGenerator.generateBuildSpec(
          config.flowNodes,
        );
        this.logger.log(`Updated buildspec for runtime: ${updatedBuildSpec}`);
        sourceOverrides = {
          buildspecOverride: updatedBuildSpec,
        };
      }

      const environmentVariablesOverride = [
        {
          name: 'PIPELINE_ID',
          value: config.pipelineId || 'manual',
        },
        {
          name: 'EXECUTION_TIMESTAMP',
          value: new Date().toISOString(),
        },
        // EventBridge 이벤트에서 사용할 메타데이터
        {
          name: 'OTTO_USER_ID',
          value: config.userId,
        },
        {
          name: 'OTTO_PROJECT_ID',
          value: config.projectId,
        },
      ];

      const startBuildResult = await this.codeBuildClient.send(
        new StartBuildCommand({
          projectName: config.projectName,
          environmentVariablesOverride,
          ...sourceOverrides,
        }),
      );

      const buildId = startBuildResult.build?.id;
      const buildArn = startBuildResult.build?.arn;
      const actualBuildNumber = startBuildResult.build?.buildNumber;

      if (!buildId) {
        throw new Error('Failed to get build ID from CodeBuild response');
      }

      this.logger.log(
        `CodeBuild response - buildId: ${buildId}, buildArn: ${buildArn}, buildNumber: ${actualBuildNumber}`,
      );

      // buildId 형식: "projectName:uuid"
      // 실제 빌드 번호는 CodeBuild 내부에서 $CODEBUILD_BUILD_NUMBER로 사용됨
      // 우리는 buildId의 UUID 부분을 사용하지 말고, 실제 sequential number가 필요함

      // buildNumber가 없으면 빌드 정보를 다시 조회
      let buildNumber: string;
      if (actualBuildNumber) {
        buildNumber = actualBuildNumber.toString();
      } else {
        // BatchGetBuilds로 실제 빌드 정보 조회
        const buildInfo = await this.codeBuildClient.send(
          new BatchGetBuildsCommand({
            ids: [buildId],
          }),
        );

        const build = buildInfo.builds?.[0];
        if (build?.buildNumber) {
          buildNumber = build.buildNumber.toString();
        } else {
          // fallback: buildId의 UUID 부분은 사용하지 않고 타임스탬프 사용
          this.logger.warn(
            `Could not get build number from CodeBuild, using timestamp`,
          );
          buildNumber = Date.now().toString();
        }
      }

      this.logger.log(`Using build number: ${buildNumber}`);

      // 이미지 태그 생성
      const imageTag = this.ecrService.generateImageTag({
        userId: config.userId,
        projectId: config.projectId,
        buildNumber,
      });

      this.logger.log(`Build started successfully: ${buildId}`);
      this.logger.log(`Build number extracted: ${buildNumber}`);
      this.logger.log(`Image tag generated: ${imageTag}`);

      // EventBridge 모드에서 execution 레코드 생성
      // (EventBridge IN_PROGRESS 이벤트가 오기 전에 생성)
      if (process.env.USE_EVENTBRIDGE === 'true') {
        try {
          const executionId = buildId.split(':')[1]; // UUID 부분 사용
          const logStreamName = executionId; // CloudWatch 로그 스트림명
          const execution = this.executionRepository.create({
            executionId: executionId,
            executionType: ExecutionType.BUILD,
            status: ExecutionStatus.RUNNING,
            awsBuildId: buildId,
            projectId: config.projectId,
            pipelineId: config.pipelineId || '',
            userId: config.userId,
            logStreamName: logStreamName, // CloudWatch 로그 스트림명 설정
            startedAt: new Date(),
            metadata: {
              source: 'otto-ui',
              buildNumber,
              imageTag,
              projectName: config.projectName,
            },
          });

          await this.executionRepository.save(execution);
          this.logger.log(
            `Created execution record ${executionId} for build ${buildId} with logStream ${logStreamName}`,
          );

          // CloudWatch 폴링은 EventBridge IN_PROGRESS 이벤트에서 시작됨
          // 여기서는 execution 레코드만 생성
        } catch (error) {
          this.logger.error(
            `Failed to create execution record: ${(error as Error).message}`,
          );
          // execution 생성 실패해도 빌드는 계속 진행
        }
      }

      return {
        buildId,
        buildNumber,
        imageTag,
      };
    } catch (error) {
      this.logger.error(`Failed to start build: ${(error as Error).message}`);
      throw new Error(`빌드 실행 실패: ${(error as Error).message}`);
    }
  }

  /**
   * 빌드 상태 조회
   */
  async getBuildStatus(buildId: string): Promise<{
    buildStatus: string;
    currentPhase?: string;
    startTime?: Date;
    endTime?: Date;
    logs?: {
      groupName?: string;
      streamName?: string;
    };
  }> {
    try {
      const result = await this.codeBuildClient.send(
        new BatchGetBuildsCommand({
          ids: [buildId],
        }),
      );

      const build = result.builds?.[0];
      if (!build) {
        throw new Error(`Build not found: ${buildId}`);
      }

      return {
        buildStatus: build.buildStatus || 'UNKNOWN',
        currentPhase: build.currentPhase,
        startTime: build.startTime,
        endTime: build.endTime,
        logs: {
          groupName: build.logs?.groupName,
          streamName: build.logs?.streamName,
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get build status: ${(error as Error).message}`,
      );
      throw new Error(`빌드 상태 조회 실패: ${(error as Error).message}`);
    }
  }

  /**
   * CodeBuild 프로젝트 삭제
   */
  async deleteProject(projectName: string): Promise<void> {
    try {
      // 1. EventBridge Rule 삭제 (있는 경우)
      try {
        await this.eventBridgeService.deleteCodeBuildEventRule(projectName);
        this.logger.log(`EventBridge rule deleted for project: ${projectName}`);
      } catch (error) {
        this.logger.warn(
          `Failed to delete EventBridge rule: ${(error as Error).message}`,
        );
      }

      // 2. CodeBuild 프로젝트 삭제
      await this.codeBuildClient.send(
        new DeleteProjectCommand({
          name: projectName,
        }),
      );

      this.logger.log(`CodeBuild project deleted: ${projectName}`);
    } catch (error) {
      if ((error as Error).name === 'ResourceNotFoundException') {
        this.logger.warn(
          `CodeBuild project not found for deletion: ${projectName}`,
        );
        return;
      }

      this.logger.error(
        `Failed to delete CodeBuild project: ${(error as Error).message}`,
      );
      throw new Error(
        `CodeBuild 프로젝트 삭제 실패: ${(error as Error).message}`,
      );
    }
  }

  /**
   * ECR Repository 삭제 (롤백용)
   */
  async deleteEcrRepository(repositoryName: string): Promise<void> {
    return this.ecrService.deleteRepository(repositoryName);
  }

  /**
   * CloudWatch 로그 그룹 삭제 (롤백용)
   */
  async deleteCloudWatchLogGroup(logGroupName: string): Promise<void> {
    return this.cloudWatchLogsService.deleteLogGroup(logGroupName);
  }
}
