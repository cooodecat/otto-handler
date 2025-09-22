import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Pipeline } from './pipeline.entity';
import { Project } from './project.entity';
import { User } from './user.entity';
import { ExecutionLog } from './execution-log.entity';
import { ExecutionArchive } from './execution-archive.entity';

export enum ExecutionStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
}

export enum ExecutionType {
  BUILD = 'build',
  DEPLOY = 'deploy',
}

@Entity()
export class Execution {
  @PrimaryGeneratedColumn('uuid')
  executionId: string;

  @Column()
  pipelineId: string;

  @ManyToOne(() => Pipeline)
  @JoinColumn({ name: 'pipeline_id' })
  pipeline: Pipeline;

  @Column()
  projectId: string;

  @ManyToOne(() => Project)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: ExecutionType })
  executionType: ExecutionType;

  @Column({
    type: 'enum',
    enum: ExecutionStatus,
    default: ExecutionStatus.PENDING,
  })
  status: ExecutionStatus;

  @Column({ nullable: true })
  awsBuildId?: string;

  @Column({ nullable: true })
  awsDeploymentId?: string;

  @Column({ nullable: true })
  logStreamName?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    branch?: string;
    commitId?: string;
    triggeredBy?: string;
    [key: string]: any;
  };

  @CreateDateColumn()
  startedAt: Date;

  @Column({ nullable: true })
  completedAt?: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ExecutionLog, (log) => log.execution)
  logs: ExecutionLog[];

  @OneToMany(() => ExecutionArchive, (archive) => archive.execution)
  archives: ExecutionArchive[];

  @Column({ default: false })
  isArchived: boolean;

  @Column({ nullable: true })
  archiveUrl?: string;
}
