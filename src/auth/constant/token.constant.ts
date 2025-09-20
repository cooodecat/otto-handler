export const TOKEN_CONSTANTS = {
  ACCESS_TOKEN_TTL_SEC: 60 * 15, // 15분
  REFRESH_TOKEN_TTL_SEC: 60 * 60 * 24 * 14, // 14일
  ACCESS_TOKEN_COOKIE: 'access_token',
  REFRESH_TOKEN_COOKIE: 'refresh_token',
  COOKIE_SECURE: process.env.NODE_ENV === 'production',
  COOKIE_HTTP_ONLY: true,
  COOKIE_SAME_SITE: 'lax' as const,
};
