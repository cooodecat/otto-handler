import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Project } from './project.entity';

@Entity()
export class GithubApp {
  @PrimaryColumn()
  installationId: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.githubApps)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  accountLogin: string; // GitHub account login (username or org name)

  @Column()
  accountType: string; // 'User' or 'Organization'

  @OneToMany('Project', 'githubApp')
  projects: Project[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
