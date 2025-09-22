import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExecutionStatus, ExecutionType } from '../../database/entities/execution.entity';
import { ExecutionLog } from '../../database/entities/execution-log.entity';

export class ExecutionResponseDto {
  @ApiProperty({ description: 'Execution ID' })
  executionId: string;

  @ApiProperty({ description: 'Pipeline ID' })
  pipelineId: string;

  @ApiProperty({ description: 'Project ID' })
  projectId: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ enum: ExecutionType, description: 'Type of execution' })
  executionType: ExecutionType;

  @ApiProperty({ enum: ExecutionStatus, description: 'Execution status' })
  status: ExecutionStatus;

  @ApiPropertyOptional({ description: 'AWS Build ID' })
  awsBuildId?: string;

  @ApiPropertyOptional({ description: 'AWS Deployment ID' })
  awsDeploymentId?: string;

  @ApiPropertyOptional({ description: 'CloudWatch log stream name' })
  logStreamName?: string;

  @ApiPropertyOptional({ description: 'Execution metadata' })
  metadata?: {
    branch?: string;
    commitId?: string;
    triggeredBy?: string;
    [key: string]: any;
  };

  @ApiProperty({ description: 'Execution start time' })
  startedAt: Date;

  @ApiPropertyOptional({ description: 'Execution completion time' })
  completedAt?: Date;

  @ApiProperty({ description: 'Last update time' })
  updatedAt: Date;

  @ApiProperty({ description: 'Archive status' })
  isArchived: boolean;

  @ApiPropertyOptional({ description: 'Archive URL' })
  archiveUrl?: string;

  @ApiPropertyOptional({ description: 'Execution logs', type: [ExecutionLog] })
  logs?: ExecutionLog[];

  @ApiPropertyOptional({ description: 'Total log count' })
  logCount?: number;
}