import type { Recordstringany } from "./Recordstringany";

export type RegisterExecutionDto = {
  context: string;
  functionName: string;
  inputParams?: undefined | Recordstringany;
  metadata?: undefined | Recordstringany;
};
