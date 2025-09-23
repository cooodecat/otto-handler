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
  data: any;

  @Column()
  pipelineName: string;

  @Column({ type: 'varchar', nullable: true })
  ecrImageUri: string | null; // 빌드된 이미지 전체 URI (예: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/otto/development/user123/proj456:build-789)

  @Column({ type: 'varchar', nullable: true })
  imageTag: string | null; // 이미지 태그만 (예: build-789)

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
