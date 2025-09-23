import type { Format } from "typia/lib/tags/Format";

import type { Project } from "./Project";
import type { User } from "./User";

export type GithubApp = {
  installationId: string;
  userId: string;
  user: User;
  accountLogin: string;
  accountType: string;
  projects: Project[];
  createdAt: string & Format<"date-time">;
  updatedAt: string & Format<"date-time">;
};
