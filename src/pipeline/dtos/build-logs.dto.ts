export interface GetBuildLogsRequestDto {
  buildId: string;
  nextToken?: string;
  limit?: number;
}

export interface BuildLogEntry {
  timestamp: number;
  message: string;
  ingestionTime: number;
}

export interface GetBuildLogsResponseDto {
  logs: BuildLogEntry[];
  nextForwardToken?: string;
  nextBackwardToken?: string;
  buildStatus?: string;
  logGroup?: string;
  logStream?: string;
}
