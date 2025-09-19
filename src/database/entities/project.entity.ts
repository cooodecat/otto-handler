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
import { GithubApp } from './github-app.entity';

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

  @Column({ nullable: true })
  installationId: string | null; // FK to GithubApp

  @ManyToOne('GithubApp', 'projects', {
    nullable: true,
  })
  @JoinColumn({ name: 'installation_id' })
  githubApp: GithubApp | null;

  @Column({ nullable: true })
  githubRepositoryId: string;

  @Column({ nullable: true })
  githubRepositoryName: string;

  @Column({ nullable: true })
  githubOwner: string;

  @Column({ nullable: true })
  selectedBranch: string;

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
