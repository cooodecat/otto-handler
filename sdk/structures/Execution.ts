import type { Format } from "typia/lib/tags/Format";

import type { ExecutionArchive } from "./ExecutionArchive";
import type { ExecutionLog } from "./ExecutionLog";
import type { Pipeline } from "./Pipeline";
import type { Project } from "./Project";
import type { User } from "./User";

export type Execution = {
  executionId: string;
  pipelineId: string;
  pipeline: Pipeline;
  projectId: string;
  project: Project;
  userId: string;
  user: User;
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
  logs: ExecutionLog[];
  archives: ExecutionArchive[];
  isArchived: boolean;
  archiveUrl?: undefined | string;
};
