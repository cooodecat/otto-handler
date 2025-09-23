export type TestLogDto = {
  message: string;
  level?: undefined | "error" | "info" | "warning";
  phase?: undefined | string;
};
