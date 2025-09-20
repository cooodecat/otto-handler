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

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
