import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from './project.entity';
import { RefreshToken } from './refresh-token.entity';

@Entity()
export class User {
  @PrimaryGeneratedColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column()
  email: string;

  @Column()
  githubUserName: string;

  @Column()
  githubAvatarUrl: string;

  @Column()
  githubId: number;

  @OneToMany(() => Project, (project) => project.user)
  projects: Project[];

  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refreshTokens: RefreshToken[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
