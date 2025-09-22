import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Execution } from './execution.entity';

@Entity()
export class ExecutionArchive {
  @PrimaryGeneratedColumn('uuid')
  archiveId: string;

  @Column('uuid')
  executionId: string;

  @ManyToOne(() => Execution, (execution) => execution.archives)
  @JoinColumn({ name: 'execution_id' })
  execution: Execution;

  @Column()
  s3Bucket: string;

  @Column()
  s3Key: string;

  @Column()
  logLineCount: number;

  @Column({ nullable: true })
  compressedSize?: number;

  @Column({ nullable: true })
  uncompressedSize?: number;

  @CreateDateColumn()
  archivedAt: Date;
}