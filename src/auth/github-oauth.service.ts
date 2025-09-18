import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

import type { GithubToken, GitHubTokenType, GithubUserType } from './type';
import { ConfigService } from '@nestjs/config';
import { JwtService } from './jwt.service';
import { GithubAuthRequestDto } from './dtos/request';

@Injectable()
export class GithubOauthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async getGithubToken({
    code,
    state,
  }: GithubAuthRequestDto): Promise<GithubToken | null> {
    const clientId = this.configService.get<string>('OTTO_GITHUB_OAUTH_ID');

    const clientSecret = this.configService.get<string>(
      'OTTO_GITHUB_OAUTH_SECRET',
    );

    try {
      const tokenRes = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            state,
          }),
        },
      );

      if (!tokenRes.ok) {
        throw new Error(`HTTP error! status: ${tokenRes.status}`);
      }

      const tokenResponse = (await tokenRes.json()) as GitHubTokenType;

      return {
        access_token: tokenResponse.access_token ?? '',
        access_token_expired_at: 0,
        refresh_token: '',
        refresh_token_expired_at: 0,
      };
    } catch {
      return null;
    }
  }
  async getUserInfo(
    dto: GithubAuthRequestDto,
  ): Promise<GithubUserType & { access_token: string }> {
    const tokenData = await this.getGithubToken(dto);

    if (tokenData === null) {
      throw new HttpException('GitHub 토큰 획득 실패', HttpStatus.UNAUTHORIZED);
    }
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!userRes.ok) {
        throw new Error(`HTTP error! status: ${userRes.status}`);
      }

      const userData = (await userRes.json()) as GithubUserType;

      return {
        ...userData,
        access_token: tokenData.access_token,
      };
    } catch (err) {
      console.error('[GitHub OAuth] User info fetch error:', err);
      throw new HttpException(`로그인 실패`, HttpStatus.UNAUTHORIZED);
    }
  }
}
