export type GithubAuthRequestDto = {
  /**
   * 깃허브 로그인 callback code
   */
  code: string;

  /**
   * 깃허브로부터 돌아온 state
   */
  state: string;
};
