import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Execution } from './execution.entity';

export enum LogLevel {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}

@Entity()
@Index('idx_execution_timestamp', ['executionId', 'timestamp'])
@Index('idx_created_at', ['createdAt'])
export class ExecutionLog {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column('uuid')
  executionId: string;

  @ManyToOne(() => Execution, (execution) => execution.logs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'execution_id' })
  execution: Execution;

  @Column('timestamp')
  timestamp: Date;

  @Column('text')
  message: string;

  @Column({
    type: 'enum',
    enum: LogLevel,
    default: LogLevel.INFO,
  })
  level: LogLevel;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt: Date;
}