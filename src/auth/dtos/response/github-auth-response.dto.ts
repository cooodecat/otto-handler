import { AuthResponseEnum } from '../../constant';

export interface LoginResponseDto {
  /**
   * 상태 메시지
   */
  message: AuthResponseEnum;
  /**
   * 엑세스 토큰
   */
  accessToken: string;
  /**
   * 리프래시 토큰
   */
  refreshToken: string;
  /**
   * 엑세스 토큰 만료
   */
  accessTokenExpiresIn: number;
  /**
   * 리프레시 토큰 만료
   */
  refreshTokenExpiresIn: number;
}
