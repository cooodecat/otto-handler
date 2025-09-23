import type { Format } from "typia/lib/tags/Format";

import type { GithubApp } from "./GithubApp";
import type { Project } from "./Project";
import type { RefreshToken } from "./RefreshToken";

export type User = {
  userId: string;
  email: string;
  githubUserName: string;
  githubAvatarUrl: string;
  githubId: number;
  projects: Project[];
  refreshTokens: RefreshToken[];
  githubApps: GithubApp[];
  createdAt: string & Format<"date-time">;
  updatedAt: string & Format<"date-time">;
};
