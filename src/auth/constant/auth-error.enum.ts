export enum AuthErrorEnum {
  LOGIN_FAIL = '아이디나 비밀번호가 틀립니다',
  GITHUB_USER = '깃허브로 로그인 해주세요',
  REFRESH_FAIL = '세션이 만료되었어요. 다시 로그인 해주세요',
  EMAIL_ALREADY_EXISTS = '이미 가입된 이메일입니다',
  NOT_VALID_USER = '로그인이 필요합니다',
  NOT_VALID_ROLE = '권한이 필요합니다',
}
