import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from './jwt.service';
import { randomBytes } from 'crypto';
import { GithubOauthService } from './github-oauth.service';
import type { FastifyReply } from 'fastify';
import { AuthErrorEnum, AuthResponseEnum, TOKEN_CONSTANTS } from './constant';
import { GithubAuthRequestDto, LoginResponseDto } from './dtos';
import { User } from '../database/entities/user.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly githubOauthService: GithubOauthService,
  ) {}

  /**
   * 리프레시 토큰으로 로그인 (토큰 회전)
   * - 전달받은 refresh 토큰을 조회
   * - 만료/미존재 시 Unauthorized
   * - 기존 토큰 레코드는 삭제하고, 새 JWT 토큰을 발급/저장
   * - 새 access, refresh 토큰과 TTL 반환
   */
  async loginByRefresh(
    refreshToken: string,
    response?: FastifyReply,
  ): Promise<LoginResponseDto> {
    const nowSec: number = Math.floor(Date.now() / 1000);
    const accessTokenExpiresIn: number = TOKEN_CONSTANTS.ACCESS_TOKEN_TTL_SEC;
    const refreshTokenExpiresIn: number = TOKEN_CONSTANTS.REFRESH_TOKEN_TTL_SEC;

    const existing = await this.refreshTokenRepository.findOne({
      where: { token: refreshToken, isRevoked: false },
      relations: ['user'],
    });

    if (!existing) {
      throw new UnauthorizedException(AuthErrorEnum.REFRESH_FAIL);
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      // 만료된 토큰은 정리
      await this.refreshTokenRepository.remove(existing);
      throw new UnauthorizedException(AuthErrorEnum.REFRESH_FAIL);
    }

    // 기존 토큰 삭제
    await this.refreshTokenRepository.remove(existing);

    // 우리만의 JWT 토큰 생성
    const newJwtAccessToken: string = this.jwtService.encode(
      {
        sub: existing.userId,
      },
      { expiresIn: `${accessTokenExpiresIn}s` },
    );

    const newRefreshToken: string = randomBytes(64).toString('hex');
    const newExpiresAt: Date = new Date(
      (nowSec + refreshTokenExpiresIn) * 1000,
    );

    // 새 refresh token 저장
    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId: existing.userId,
      token: newRefreshToken,
      expiresAt: newExpiresAt,
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

    const result = {
      message: AuthResponseEnum.LOGIN_SUCCESS,
      accessToken: newJwtAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresIn,
      refreshTokenExpiresIn,
    };

    // 응답이 제공된 경우 쿠키 설정
    if (response) {
      this.setAuthCookies(response, result.accessToken, result.refreshToken);
    }

    return result;
  }

  /**
   * 로그아웃 처리 (특정 refresh token 삭제 + 쿠키 제거)
   */
  async logout(
    refreshToken: string,
    response: FastifyReply,
  ): Promise<{ message: string }> {
    try {
      // 해당 refresh token 삭제
      const token = await this.refreshTokenRepository.findOne({
        where: { token: refreshToken },
      });
      if (token) {
        await this.refreshTokenRepository.remove(token);
      }
    } catch (error) {
      // 토큰이 존재하지 않아도 로그아웃은 성공으로 처리
      console.warn('Refresh token not found during logout:', error);
    }

    // 쿠키 제거
    this.clearAuthCookies(response);

    return { message: '로그아웃되었습니다.' };
  }

  /**
   * GitHub OAuth 인증 처리 (전체 프로세스 + 쿠키 설정)
   */
  async authenticateWithGithub(
    body: GithubAuthRequestDto,
    response: FastifyReply,
  ): Promise<LoginResponseDto> {
    const githubUser = await this.githubOauthService.getUserInfo(body);

    const result = await this.createOrUpdateGithubUser({
      id: githubUser.id,
      node_id: githubUser.node_id,
      login: githubUser.login,
      name: githubUser.name,
      email: githubUser.email,
      avatar_url: githubUser.avatar_url,
    });

    this.setAuthCookies(response, result.accessToken, result.refreshToken);

    return result;
  }

  /**
   * 인증 쿠키 설정
   */
  setAuthCookies(
    response: FastifyReply,
    accessToken: string,
    refreshToken: string,
  ): void {
    response.setCookie(TOKEN_CONSTANTS.ACCESS_TOKEN_COOKIE, accessToken, {
      httpOnly: TOKEN_CONSTANTS.COOKIE_HTTP_ONLY,
      secure: TOKEN_CONSTANTS.COOKIE_SECURE,
      sameSite: TOKEN_CONSTANTS.COOKIE_SAME_SITE,
      path: '/',
      maxAge: TOKEN_CONSTANTS.ACCESS_TOKEN_TTL_SEC,
    });

    response.setCookie(TOKEN_CONSTANTS.REFRESH_TOKEN_COOKIE, refreshToken, {
      httpOnly: TOKEN_CONSTANTS.COOKIE_HTTP_ONLY,
      secure: TOKEN_CONSTANTS.COOKIE_SECURE,
      sameSite: TOKEN_CONSTANTS.COOKIE_SAME_SITE,
      path: '/',
      maxAge: TOKEN_CONSTANTS.REFRESH_TOKEN_TTL_SEC,
    });
  }

  /**
   * 인증 쿠키 제거 (private helper)
   */
  private clearAuthCookies(response: FastifyReply): void {
    response.clearCookie(TOKEN_CONSTANTS.ACCESS_TOKEN_COOKIE, {
      path: '/',
    });

    response.clearCookie(TOKEN_CONSTANTS.REFRESH_TOKEN_COOKIE, {
      path: '/',
    });
  }

  /**
   * GitHub OAuth 사용자 생성/로그인
   */
  async createOrUpdateGithubUser(githubUser: {
    id: number;
    node_id?: string;
    login: string;
    name?: string;
    email?: string;
    avatar_url?: string;
  }): Promise<LoginResponseDto> {
    const nowSec: number = Math.floor(Date.now() / 1000);
    const accessTokenExpiresIn: number = TOKEN_CONSTANTS.ACCESS_TOKEN_TTL_SEC;
    const refreshTokenExpiresIn: number = TOKEN_CONSTANTS.REFRESH_TOKEN_TTL_SEC;

    // 기존 사용자 찾기 또는 새로 생성
    let user = await this.userRepository.findOne({
      where: { githubId: githubUser.id },
    });

    if (!user) {
      // 새 사용자 생성
      const newUser = this.userRepository.create({
        email: githubUser.email || `${githubUser.login}@github.local`,
        githubUserName: githubUser.login,
        githubAvatarUrl: githubUser.avatar_url || '',
        githubId: githubUser.id,
      });
      user = await this.userRepository.save(newUser);
    } else {
      // 기존 사용자 정보 업데이트
      user.githubUserName = githubUser.login;
      if (githubUser.email) user.email = githubUser.email;
      if (githubUser.avatar_url) user.githubAvatarUrl = githubUser.avatar_url;
      user = await this.userRepository.save(user);
    }

    // 우리만의 JWT 토큰 생성
    const jwtAccessToken = this.jwtService.encode(
      {
        sub: user.userId,
      },
      { expiresIn: `${accessTokenExpiresIn}s` },
    );

    const refreshToken = randomBytes(64).toString('hex');
    const refreshTokenExpiresAt = new Date(
      (nowSec + refreshTokenExpiresIn) * 1000,
    );

    // 새 refresh token 저장
    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId: user.userId,
      token: refreshToken,
      expiresAt: refreshTokenExpiresAt,
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      message: AuthResponseEnum.LOGIN_SUCCESS,
      accessToken: jwtAccessToken,
      refreshToken,
      accessTokenExpiresIn,
      refreshTokenExpiresIn,
    };
  }
}
