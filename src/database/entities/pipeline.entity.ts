import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';

// CICD Flow Node 인터페이스 정의
export interface CICDNodeData {
  blockType: string;
  groupType: string;
  blockId: string;
  onSuccess: string | null;
  onFailed: string | null;
  [key: string]: unknown; // Dynamic properties for different node types
}

// Pipeline data structure 인터페이스 정의
export interface PipelineData {
  flowNodes?: CICDNodeData[];
  [key: string]: unknown; // Allow for additional pipeline configuration
}

@Entity()
export class Pipeline {
  @PrimaryGeneratedColumn('uuid')
  pipelineId: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, (project) => project.pipelines)
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column({ type: 'json' })
  data: PipelineData;

  @Column()
  pipelineName: string;

  @Column({ type: 'varchar', nullable: true })
  ecrImageUri: string | null; // 빌드된 이미지 전체 URI (예: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/otto/development/user123/proj456:build-789)

  @Column({ type: 'varchar', nullable: true })
  imageTag: string | null; // 이미지 태그만 (예: build-789)

  @Column({ type: 'varchar', nullable: true, default: null })
  deployUrl: string | null;

  @Column({ type: 'json', nullable: true, default: null })
  env: Record<string, string> | null;

  @Column({ type: 'json', nullable: true, default: null })
  deployOption: { port: number; command: string };
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
