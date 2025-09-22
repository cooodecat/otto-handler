import { DataSource } from 'typeorm';
import { ExecutionLog, LogLevel } from '../entities/execution-log.entity';
import { Execution } from '../entities/execution.entity';

export class LogSeeder {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    const logRepository = this.dataSource.getRepository(ExecutionLog);
    const executionRepository = this.dataSource.getRepository(Execution);

    // Check if logs already exist
    const existingLogs = await logRepository.count();
    if (existingLogs > 0) {
      console.log('Logs already seeded, skipping...');
      return;
    }

    // Get all executions
    const executions = await executionRepository.find();
    if (executions.length === 0) {
      console.log('No executions found. Please run execution seeder first.');
      return;
    }

    const logTemplates = {
      build: {
        pending: [
          { level: LogLevel.INFO, message: 'Build job queued' },
          { level: LogLevel.INFO, message: 'Waiting for available build agent' },
        ],
        running: [
          { level: LogLevel.INFO, message: 'Build agent assigned' },
          { level: LogLevel.INFO, message: 'Cloning repository...' },
          { level: LogLevel.INFO, message: 'Installing dependencies...' },
          { level: LogLevel.INFO, message: 'Running npm install' },
          { level: LogLevel.INFO, message: 'Building application...' },
          { level: LogLevel.INFO, message: 'Running npm run build' },
          { level: LogLevel.WARNING, message: 'Warning: Using legacy peer deps' },
          { level: LogLevel.INFO, message: 'Running tests...' },
          { level: LogLevel.INFO, message: 'All tests passed (42 total)' },
        ],
        success: [
          { level: LogLevel.INFO, message: 'Build completed successfully' },
          { level: LogLevel.INFO, message: 'Build artifacts saved' },
          { level: LogLevel.INFO, message: 'Total build time: 180 seconds' },
        ],
        failed: [
          { level: LogLevel.ERROR, message: 'Build failed with exit code 1' },
          { level: LogLevel.ERROR, message: 'Test suite failed: 5 tests failed' },
          { level: LogLevel.ERROR, message: 'Error: Cannot find module "@/components"' },
          { level: LogLevel.ERROR, message: 'Build process terminated' },
        ],
      },
      deploy: {
        pending: [
          { level: LogLevel.INFO, message: 'Deployment job queued' },
          { level: LogLevel.INFO, message: 'Preparing deployment configuration' },
        ],
        running: [
          { level: LogLevel.INFO, message: 'Starting deployment process' },
          { level: LogLevel.INFO, message: 'Downloading build artifacts' },
          { level: LogLevel.INFO, message: 'Validating deployment configuration' },
          { level: LogLevel.INFO, message: 'Creating new task definition' },
          { level: LogLevel.INFO, message: 'Updating ECS service' },
          { level: LogLevel.INFO, message: 'Waiting for service to stabilize' },
          { level: LogLevel.WARNING, message: 'Warning: High memory usage detected' },
          { level: LogLevel.INFO, message: 'Health checks in progress' },
        ],
        success: [
          { level: LogLevel.INFO, message: 'Deployment completed successfully' },
          { level: LogLevel.INFO, message: 'All health checks passed' },
          { level: LogLevel.INFO, message: 'New version is now live' },
        ],
        failed: [
          { level: LogLevel.ERROR, message: 'Deployment failed' },
          { level: LogLevel.ERROR, message: 'Health check failed after 5 attempts' },
          { level: LogLevel.ERROR, message: 'Rolling back to previous version' },
          { level: LogLevel.INFO, message: 'Rollback completed' },
        ],
      },
    };

    const logsToCreate = [];

    for (const execution of executions) {
      const type = execution.executionType.toLowerCase();
      const status = execution.status.toLowerCase();
      
      // Get appropriate log templates
      const templates = logTemplates[type]?.[status] || logTemplates.build.running;
      
      // Create logs with incremental timestamps
      let baseTime = new Date(execution.startedAt);
      
      for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        const timestamp = new Date(baseTime.getTime() + (i * 5000)); // 5 seconds apart
        
        const log = logRepository.create({
          executionId: execution.executionId,
          timestamp,
          level: template.level,
          message: template.message,
          metadata: {
            source: type === 'build' ? 'CodeBuild' : 'CodeDeploy',
            logGroup: `/aws/codebuild/test-project`,
            logStream: execution.logStreamName || 'test-stream',
            sequenceNumber: i + 1,
          },
          createdAt: timestamp,
        });
        
        logsToCreate.push(log);
      }

      // Add some additional logs for running executions
      if (status === 'running') {
        const additionalLogs = [
          { level: LogLevel.INFO, message: 'Processing step 1 of 10...' },
          { level: LogLevel.INFO, message: 'Processing step 2 of 10...' },
          { level: LogLevel.INFO, message: 'Processing step 3 of 10...' },
          { level: LogLevel.WARNING, message: 'Retrying failed operation...' },
          { level: LogLevel.INFO, message: 'Operation succeeded on retry' },
        ];

        for (let i = 0; i < additionalLogs.length; i++) {
          const template = additionalLogs[i];
          const timestamp = new Date(baseTime.getTime() + ((templates.length + i) * 5000));
          
          const log = logRepository.create({
            executionId: execution.executionId,
            timestamp,
            level: template.level,
            message: template.message,
            metadata: {
              source: type === 'build' ? 'CodeBuild' : 'CodeDeploy',
              logGroup: `/aws/codebuild/test-project`,
              logStream: execution.logStreamName || 'test-stream',
              sequenceNumber: templates.length + i + 1,
            },
            createdAt: timestamp,
          });
          
          logsToCreate.push(log);
        }
      }
    }

    // Save all logs
    await logRepository.save(logsToCreate);
    console.log(`✅ Seeded ${logsToCreate.length} logs for ${executions.length} executions`);
  }
}