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
import { User } from './user.entity';
import { Pipeline } from './pipeline.entity';
export enum ProjectStatus {
  FAILED = 'FAILED',
  CREATED = 'CREATED',
  SUCCESS = 'SUCCESS',
  IN_PROGRESS = 'IN_PROGRESS',
}
@Entity()
export class Project {
  @PrimaryGeneratedColumn('uuid')
  projectId: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.projects)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  projectName: string;

  @Column({ nullable: true, type: 'varchar' })
  projectDescription: string | null;

  @Column()
  githubRepositoryUrl: string;

  @Column()
  githubRepositoryName: string;

  @Column()
  githubRepositoryId: string;

  @Column()
  githubOwner: string;
  @Column()
  githubOwnerId: string;

  @Column()
  selectedBranch: string;
  @Column()
  installationId: string;

  @Column()
  codebuildProjectName: string;

  @Column({ default: 'aws/codebuild/standard:7.0' })
  buildImage: string;

  @Column({ default: 'BUILD_GENERAL1_MEDIUM' })
  computeType: string;

  @Column({ default: 60 })
  buildTimeout: number;

  @Column()
  cloudwatchLogGroup: string;
  @Column()
  codebuildStatus: ProjectStatus;

  @Column({ nullable: true, type: 'varchar' })
  codebuildErrorMessage: string | null;
  @Column()
  codebuildProjectArn: string;

  @OneToMany(() => Pipeline, (pipeline) => pipeline.project)
  pipelines: Pipeline[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
