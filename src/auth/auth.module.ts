import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from './jwt.service';
import { AuthService } from './auth.service';
import { GithubOauthService } from './github-oauth.service';
import { AuthController } from './auth.controller';
import { User } from '../database/entities/user.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  exports: [JwtService],
  providers: [AuthService, JwtService, GithubOauthService],
  controllers: [AuthController],
})
export class AuthModule {}
