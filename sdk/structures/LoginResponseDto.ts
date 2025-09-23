export type LoginResponseDto = {
  /**
   * 상태 메시지
   */
  message:
    | "\uB85C\uADF8\uC778 \uC131\uACF5"
    | "\uD68C\uC6D0\uAC00\uC785 \uC131\uACF5";

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
};
