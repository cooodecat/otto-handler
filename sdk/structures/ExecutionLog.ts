import type { Format } from "typia/lib/tags/Format";

import type { Execution } from "./Execution";

export type ExecutionLog = {
  id: number;
  executionId: string;
  execution: Execution;
  timestamp: string & Format<"date-time">;
  message: string;
  level: "info" | "warning" | "error";
  metadata?: any | undefined;
  createdAt: string & Format<"date-time">;
};
