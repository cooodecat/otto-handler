import type { Format } from "typia/lib/tags/Format";

import type { Execution } from "./Execution";

export type ExecutionArchive = {
  archiveId: string;
  executionId: string;
  execution: Execution;
  s3Bucket: string;
  s3Key: string;
  logLineCount: number;
  compressedSize?: undefined | number;
  uncompressedSize?: undefined | number;
  archivedAt: string & Format<"date-time">;
};
