import type { Format } from "typia/lib/tags/Format";

import type { Project } from "./Project";
import type { Recordstringstring } from "./Recordstringstring";

export type Pipeline = {
  pipelineId: string;
  projectId: string;
  project: Project;
  data: any;
  pipelineName: string;
  ecrImageUri: null | string;
  imageTag: null | string;
  deployUrl: null | string;
  env: null | Recordstringstring;
  deployOption: {
    port: number;
    command: string;
  };
  createdAt: string & Format<"date-time">;
  updatedAt: string & Format<"date-time">;
};
