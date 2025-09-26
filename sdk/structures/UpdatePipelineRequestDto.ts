import type { PipelineData } from "./PipelineData";
import type { Recordstringstring } from "./Recordstringstring";

export type UpdatePipelineRequestDto = {
  /**
   * 파이프라인 이름
   */
  pipelineName?: undefined | string;

  /**
   * 파이프라인 데이터 (JSON)
   */
  data?: undefined | PipelineData;

  /**
   * env 관련
   */
  env?: null | undefined | Recordstringstring;

  /**
   * 빌드 옵션 관련
   */
  deployOption?:
    | undefined
    | {
        port: number;
        command: string;
      };
};
