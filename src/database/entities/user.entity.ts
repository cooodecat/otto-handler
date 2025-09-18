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
import { EncryptionTransformer } from '../transformers/encryption.transformer';

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

  @Column({
    nullable: true,
    type: 'varchar',
    transformer: new EncryptionTransformer(),
  })
  githubAccessToken: string | null;

  @OneToMany(() => Project, (project) => project.user)
  projects: Project[];

  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refreshTokens: RefreshToken[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
