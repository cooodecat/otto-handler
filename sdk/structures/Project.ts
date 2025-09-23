import type { Format } from "typia/lib/tags/Format";

import type { GithubApp } from "./GithubApp";
import type { Pipeline } from "./Pipeline";
import type { User } from "./User";

export type Project = {
  projectId: string;
  userId: string;
  user: User;
  projectName: string;
  projectDescription: null | string;
  installationId: null | string;
  githubApp: null | GithubApp;
  githubRepositoryId: string;
  githubRepositoryName: string;
  githubOwner: string;
  selectedBranch: string;
  codebuildProjectName: null | string;
  buildImage: string;
  computeType: string;
  buildTimeout: number;
  cloudwatchLogGroup: null | string;
  codebuildStatus: null | "FAILED" | "CREATED" | "SUCCESS" | "IN_PROGRESS";
  codebuildErrorMessage: null | string;
  codebuildProjectArn: null | string;
  ecrRepository: null | string;
  latestImageTag: null | string;
  pipelines: Pipeline[];
  createdAt: string & Format<"date-time">;
  updatedAt: string & Format<"date-time">;
};
