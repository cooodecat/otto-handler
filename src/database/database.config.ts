import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { Pipeline } from './entities/pipeline.entity';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Project } from './entities/project.entity';

@Injectable()
export class DatabaseConfigService implements TypeOrmOptionsFactory {
  constructor(private configService: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    console.log(this.configService.get<string>('DATABASE_URL'));
    return {
      type: 'postgres',
      url:
        this.configService.get<string>('DATABASE_URL') ||
        'postgresql://postgres:password@localhost:5432/otto',
      entities: [Pipeline, User, RefreshToken, Project],
      synchronize: this.configService.get<string>('NODE_ENV') !== 'production',
      logging: this.configService.get<string>('NODE_ENV') === 'development',
      namingStrategy: new SnakeNamingStrategy(),
    };
  }
}
