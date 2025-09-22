import { DataSource } from 'typeorm';
import { Execution, ExecutionStatus, ExecutionType } from '../entities/execution.entity';
import { User } from '../entities/user.entity';
import { Pipeline } from '../entities/pipeline.entity';
import { Project, ProjectStatus } from '../entities/project.entity';
import { v4 as uuidv4 } from 'uuid';

export class ExecutionSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    const executionRepository = this.dataSource.getRepository(Execution);
    const userRepository = this.dataSource.getRepository(User);
    const pipelineRepository = this.dataSource.getRepository(Pipeline);
    const projectRepository = this.dataSource.getRepository(Project);

    // Check if data already exists
    const existingExecutions = await executionRepository.count();
    if (existingExecutions > 0) {
      console.log('Executions already seeded, skipping...');
      return;
    }

    // Create test user if not exists
    let user = await userRepository.findOne({
      where: { email: 'test@example.com' },
    });

    if (!user) {
      user = userRepository.create({
        userId: uuidv4(),
        email: 'test@example.com',
        githubUserName: 'testuser',
        githubId: '123456',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await userRepository.save(user);
    }

    // Create test project if not exists
    let project = await projectRepository.findOne({
      where: { projectName: 'Test Project' },
    });

    if (!project) {
      project = projectRepository.create({
        projectId: uuidv4(),
        userId: user.userId,
        projectName: 'Test Project',
        projectDescription: 'Test project for seeding',
        githubRepositoryName: 'test-repo',
        githubOwner: 'testuser',
        selectedBranch: 'main',
        codebuildProjectName: 'test-build-project',
        cloudwatchLogGroup: '/aws/codebuild/test-project',
        codebuildStatus: ProjectStatus.SUCCESS,
        codebuildProjectArn: 'arn:aws:codebuild:us-east-1:123456789012:project/test-project',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await projectRepository.save(project);
    }

    // Create test pipeline if not exists
    let pipeline = await pipelineRepository.findOne({
      where: { projectId: project.projectId },
    });

    if (!pipeline) {
      pipeline = pipelineRepository.create({
        pipelineId: uuidv4(),
        projectId: project.projectId,
        pipelineName: 'Test Pipeline',
        pipelineDescription: 'Test pipeline for seeding',
        buildCommand: 'npm run build',
        deployCommand: 'npm run deploy',
        environmentVariables: JSON.stringify([
          { key: 'NODE_ENV', value: 'production' },
          { key: 'API_URL', value: 'https://api.example.com' },
        ]),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await pipelineRepository.save(pipeline);
    }

    // Create sample executions
    const executions = [
      {
        executionId: uuidv4(),
        pipelineId: pipeline.pipelineId,
        projectId: project.projectId,
        userId: user.userId,
        executionType: ExecutionType.BUILD,
        status: ExecutionStatus.SUCCESS,
        awsBuildId: 'test-build-001',
        logStreamName: 'test-stream-001',
        metadata: {
          branch: 'main',
          commitId: 'abc123def',
          triggeredBy: 'webhook',
          duration: 180,
        },
        startedAt: new Date(Date.now() - 3600000), // 1 hour ago
        completedAt: new Date(Date.now() - 3000000), // 50 minutes ago
        isArchived: false,
      },
      {
        executionId: uuidv4(),
        pipelineId: pipeline.pipelineId,
        projectId: project.projectId,
        userId: user.userId,
        executionType: ExecutionType.DEPLOY,
        status: ExecutionStatus.RUNNING,
        awsDeploymentId: 'test-deploy-002',
        logStreamName: 'test-stream-002',
        metadata: {
          branch: 'develop',
          commitId: 'def456ghi',
          triggeredBy: 'manual',
        },
        startedAt: new Date(Date.now() - 600000), // 10 minutes ago
        isArchived: false,
      },
      {
        executionId: uuidv4(),
        pipelineId: pipeline.pipelineId,
        projectId: project.projectId,
        userId: user.userId,
        executionType: ExecutionType.BUILD,
        status: ExecutionStatus.FAILED,
        awsBuildId: 'test-build-003',
        logStreamName: 'test-stream-003',
        metadata: {
          branch: 'feature/test',
          commitId: 'ghi789jkl',
          triggeredBy: 'schedule',
          errorMessage: 'Build failed: Tests did not pass',
        },
        startedAt: new Date(Date.now() - 7200000), // 2 hours ago
        completedAt: new Date(Date.now() - 6900000), // 1h 55min ago
        isArchived: true,
        archiveUrl: 's3://test-bucket/archives/test-build-003.tar.gz',
      },
      {
        executionId: uuidv4(),
        pipelineId: pipeline.pipelineId,
        projectId: project.projectId,
        userId: user.userId,
        executionType: ExecutionType.BUILD,
        status: ExecutionStatus.PENDING,
        metadata: {
          branch: 'staging',
          commitId: 'jkl012mno',
          triggeredBy: 'api',
        },
        startedAt: new Date(),
        isArchived: false,
      },
    ];

    // Save executions
    for (const executionData of executions) {
      const execution = executionRepository.create(executionData);
      await executionRepository.save(execution);
    }

    console.log(`✅ Seeded ${executions.length} executions`);
  }
}