import {
  Controller,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import type { GithubAuthRequestDto, LoginResponseDto } from './dtos';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TypedBody, TypedException, TypedRoute } from '@nestia/core';
import { TOKEN_CONSTANTS } from './constant';
import { CommonErrorResponseDto } from '../common/dtos';

@Controller('/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * @tag auth
   * @summary GitHub OAuth 로그인
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: 'GitHub 인증 실패',
  })
  @HttpCode(200)
  @TypedRoute.Post('/github')
  async authGithubSignIn(
    @TypedBody() body: GithubAuthRequestDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<LoginResponseDto> {
    return this.authService.authenticateWithGithub(body, res);
  }

  /**
   * @tag auth
   * @summary Refresh Token으로 로그인
   */
  @TypedException<CommonErrorResponseDto>({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Refresh Token이 유효하지 않음',
  })
  @HttpCode(200)
  @TypedRoute.Post('/refresh')
  async authRefreshSignIn(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<LoginResponseDto> {
    const refreshToken = req.cookies?.[TOKEN_CONSTANTS.REFRESH_TOKEN_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    return this.authService.loginByRefresh(refreshToken, res);
  }

  /**
   * @tag auth
   * @summary 로그아웃
   */
  @HttpCode(200)
  @TypedRoute.Post('/logout')
  async authSignOut(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ message: string }> {
    const refreshToken =
      req.cookies?.[TOKEN_CONSTANTS.REFRESH_TOKEN_COOKIE] || '';

    return this.authService.logout(refreshToken, res);
  }
}
