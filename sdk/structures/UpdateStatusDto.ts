import type { Format } from "typia/lib/tags/Format";

import type { Recordstringany } from "./Recordstringany";

export type UpdateStatusDto = {
  status: "pending" | "running" | "success" | "failed";
  completedAt?: undefined | (string & Format<"date-time">);
  metadata?: undefined | Recordstringany;
  errorMessage?: undefined | string;
  archiveUrl?: undefined | string;
};
