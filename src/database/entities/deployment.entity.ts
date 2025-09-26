import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Pipeline } from './pipeline.entity';
import { Project } from './project.entity';

export enum DeploymentStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DEPLOYING_ECS = 'DEPLOYING_ECS',
  CONFIGURING_ALB = 'CONFIGURING_ALB',
  WAITING_HEALTH_CHECK = 'WAITING_HEALTH_CHECK',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  ROLLED_BACK = 'ROLLED_BACK',
}

export enum DeploymentType {
  INITIAL = 'INITIAL',
  UPDATE = 'UPDATE',
  ROLLBACK = 'ROLLBACK',
}

@Entity('deployments')
@Index('IDX_deployment_pipeline_id', ['pipelineId'])
@Index('IDX_deployment_user_id', ['userId'])
@Index('IDX_deployment_status', ['status'])
@Index('IDX_deployment_deploy_url', ['deployUrl'])
export class Deployment {
  @PrimaryGeneratedColumn('uuid')
  deploymentId: string;

  @Column({ type: 'varchar' })
  pipelineId: string;

  @Column({ type: 'varchar' })
  userId: string;

  @Column({ type: 'varchar' })
  projectId: string;

  @Column({
    type: 'enum',
    enum: DeploymentStatus,
    default: DeploymentStatus.PENDING,
  })
  status: DeploymentStatus;

  @Column({
    type: 'enum',
    enum: DeploymentType,
    default: DeploymentType.INITIAL,
  })
  deploymentType: DeploymentType;

  @Column({ type: 'varchar', length: 500, nullable: true })
  deployUrl: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ecsServiceArn: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ecsClusterArn: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  targetGroupArn: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  albArn: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  albDnsName: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ecrImageUri: string | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deployedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Pipeline, (pipeline) => pipeline.deployments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'pipeline_id' })
  pipeline: Pipeline;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;
}
