import type { Format } from "typia/lib/tags/Format";

export type LogQueryDto = {
  level?: undefined | "info" | "warning" | "error";
  keyword?: undefined | string;
  startTime?: undefined | (string & Format<"date-time">);
  endTime?: undefined | (string & Format<"date-time">);
  limit?: undefined | number;
  page?: undefined | number;
  sortOrder?: undefined | "asc" | "desc";
  source?: undefined | string;
  includeRaw?: undefined | boolean;
};
