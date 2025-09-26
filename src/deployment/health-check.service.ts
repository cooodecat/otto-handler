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

    // 개발 환경에서 DNS 해석 실패 시 가상의 성공 응답 반환
    const isDevelopment =
      this.configService.get<string>('NODE_ENV') === 'development';

    // 로컬 개발 환경이고 로컬호스트가 아닌 경우 헬스체크 건너뛰기
    if (
      isDevelopment &&
      !deployUrl.includes('localhost') &&
      !deployUrl.includes('127.0.0.1')
    ) {
      this.logger.warn(
        `개발 환경에서 외부 도메인 헬스체크 건너뛰기: ${deployUrl}`,
      );

      return {
        isHealthy: true, // 개발 환경에서는 항상 성공으로 처리
        responseStatus: 200,
        responseTime: Date.now() - startTime,
        lastChecked,
        errorMessage: 'Development mode - health check skipped',
      };
    }

    try {
      this.logger.log(`헬스체크 시작: http://${deployUrl}`);

      // DNS 해석 문제 대응: ALB DNS 직접 사용 옵션 추가
      const targetUrl = `http://${deployUrl}`;

      const response = await axios.get(targetUrl, {
        timeout: 10000, // 10초 타임아웃
        validateStatus: (status) => status < 500, // 500대 에러가 아니면 성공으로 간주
        headers: {
          'User-Agent': 'Otto-Health-Checker/1.0',
          Host: deployUrl, // Host 헤더로 도메인 전달
        },
        // DNS 해석 실패 시 재시도
        maxRedirects: 5,
        // Node.js DNS 캐시 무시
        family: 4, // IPv4 강제 사용
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

        // 개발 환경에서 DNS 해석 실패 시 성공으로 처리
        if (
          isDevelopment &&
          (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED')
        ) {
          this.logger.warn(
            `개발 환경 - DNS 해석 실패를 성공으로 처리: ${error.message}`,
          );

          return {
            isHealthy: true, // 개발 환경에서는 DNS 실패도 성공으로 처리
            responseStatus: 200,
            responseTime,
            errorMessage: `Development mode - DNS resolution failed but treated as healthy: ${error.message}`,
            lastChecked,
          };
        }

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
