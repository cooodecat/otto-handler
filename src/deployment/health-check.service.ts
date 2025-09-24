import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  constructor(private configService: ConfigService) {}

  /**
   * HTTP 헬스체크 수행
   * 배포된 사이트의 상태를 확인 (CORS 우회를 위해 백엔드에서 처리)
   */
  async checkDeploymentHealth(deployUrl: string): Promise<{
    isHealthy: boolean;
    responseStatus: number;
    responseTime: number;
    errorMessage?: string;
    lastChecked: Date;
  }> {
    const startTime = Date.now();
    const lastChecked = new Date();

    try {
      this.logger.log(`헬스체크 시작: http://${deployUrl}`);

      const response = await axios.get(`http://${deployUrl}`, {
        timeout: 10000, // 10초 타임아웃
        validateStatus: (status) => status < 500, // 500대 에러가 아니면 성공으로 간주
        headers: {
          'User-Agent': 'Otto-Health-Checker/1.0',
        },
      });

      const responseTime = Date.now() - startTime;
      const isHealthy = response.status < 500;

      this.logger.log(
        `헬스체크 완료: ${response.status} (${responseTime}ms) - ${
          isHealthy ? '건강' : '비건강'
        }`,
      );

      return {
        isHealthy,
        responseStatus: response.status,
        responseTime,
        lastChecked,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (axios.isAxiosError(error)) {
        const status = error.response?.status || 0;
        const isHealthy = status > 0 && status < 500; // 응답은 있지만 500대 에러가 아니면 건강

        this.logger.warn(
          `헬스체크 에러: ${status || 'NETWORK_ERROR'} (${responseTime}ms) - ${error.message}`,
        );

        return {
          isHealthy,
          responseStatus: status,
          responseTime,
          errorMessage: error.message,
          lastChecked,
        };
      }

      this.logger.error(`헬스체크 실패: ${error} (${responseTime}ms)`);

      return {
        isHealthy: false,
        responseStatus: 0,
        responseTime,
        errorMessage: error instanceof Error ? error.message : String(error),
        lastChecked,
      };
    }
  }
}
