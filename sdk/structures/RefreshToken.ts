import type { Format } from "typia/lib/tags/Format";

import type { User } from "./User";

export type RefreshToken = {
  refreshTokenId: string;
  userId: string;
  user: User;
  token: string;
  expiresAt: string & Format<"date-time">;
  isRevoked: boolean;
  createdAt: string & Format<"date-time">;
  updatedAt: string & Format<"date-time">;
};
