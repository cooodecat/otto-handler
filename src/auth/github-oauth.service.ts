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
    const clientId = this.configService.get<string>(
      'OTTO_GITHUB_OAUTH_CLIENT_ID',
    );

    const clientSecret = this.configService.get<string>(
      'OTTO_GITHUB_OAUTH_SECRET',
    );

    try {
      console.log('[GitHub OAuth] Requesting token with:', {
        code: code?.substring(0, 8) + '...',
        state: state?.substring(0, 8) + '...',
        clientId: clientId?.substring(0, 8) + '...',
        hasClientSecret: !!clientSecret,
      });

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
        const errorText = await tokenRes.text();
        console.error('[GitHub OAuth] Token request failed:', {
          status: tokenRes.status,
          error: errorText,
        });
        throw new Error(`HTTP error! status: ${tokenRes.status}`);
      }

      const tokenResponse = (await tokenRes.json()) as GitHubTokenType;

      if (tokenResponse.error) {
        console.error('[GitHub OAuth] GitHub API error:', tokenResponse);
        return null;
      }

      if (!tokenResponse.access_token) {
        console.error(
          '[GitHub OAuth] No access token in response:',
          tokenResponse,
        );
        return null;
      }

      console.log('[GitHub OAuth] Token received successfully');

      return {
        access_token: tokenResponse.access_token,
        access_token_expired_at: 0,
        refresh_token: '',
        refresh_token_expired_at: 0,
      };
    } catch (error) {
      console.error('[GitHub OAuth] Token fetch error:', error);
      return null;
    }
  }
  async getUserInfo(
    dto: GithubAuthRequestDto,
  ): Promise<GithubUserType & { access_token: string }> {
    const tokenData = await this.getGithubToken(dto);

    if (tokenData === null) {
      console.error('[GitHub OAuth] Failed to get GitHub token');
      throw new HttpException('GitHub 토큰 획득 실패', HttpStatus.UNAUTHORIZED);
    }

    console.log('[GitHub OAuth] Fetching user info with access token');
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!userRes.ok) {
        const errorText = await userRes.text();
        console.error('[GitHub OAuth] User info request failed:', {
          status: userRes.status,
          error: errorText,
        });
        throw new Error(`HTTP error! status: ${userRes.status}`);
      }

      const userData = (await userRes.json()) as GithubUserType;

      console.log('[GitHub OAuth] User info retrieved:', {
        id: userData.id,
        login: userData.login,
        email: userData.email,
      });

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
