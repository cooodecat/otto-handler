import type { Format } from "typia/lib/tags/Format";

import type { ExecutionLog } from "./ExecutionLog";

export type ExecutionResponseDto = {
  executionId: string;
  pipelineId: string;
  projectId: string;
  userId: string;
  executionType: "build" | "deploy";
  status: "pending" | "running" | "success" | "failed";
  awsBuildId?: undefined | string;
  awsDeploymentId?: undefined | string;
  logStreamName?: undefined | string;
  metadata?:
    | undefined
    | ({
        branch?: undefined | string;
        commitId?: undefined | string;
        triggeredBy?: undefined | string;
      } & {
        [key: string]: any;
      });
  startedAt: string & Format<"date-time">;
  completedAt?: undefined | (string & Format<"date-time">);
  updatedAt: string & Format<"date-time">;
  isArchived: boolean;
  archiveUrl?: undefined | string;
  logs?: undefined | ExecutionLog[];
  logCount?: undefined | number;
};
