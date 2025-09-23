import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '../auth/jwt.service';
import { LogsService } from './logs.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin:
      process.env.NODE_ENV === 'production'
        ? ['https://codecat-otto.shop', 'https://www.codecat-otto.shop']
        : [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175',
          ],
    credentials: true,
  },
  namespace: '/logs',
})
export class LogsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LogsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly logsService: LogsService,
    private readonly logBuffer: LogBufferService,
  ) {}

  handleConnection(client: Socket): void {
    // JWT 토큰 검증 (개발 환경에서는 선택적)
    const token = client.handshake.auth.token as string;

    // 개발 환경에서는 토큰이 없어도 허용
    if (process.env.NODE_ENV === 'development' && !token) {
      (client.data as Record<string, unknown>).userId = 'dev-user';
      this.logger.log(`Client connected (dev mode): ${client.id}`);
      return;
    }

    try {
      const user = this.validateToken(token);
      if (!user) {
        this.logger.warn(`Invalid token for client ${client.id}`);
        // 개발 환경에서는 토큰 검증 실패해도 연결 허용
        if (process.env.NODE_ENV === 'development') {
          (client.data as Record<string, unknown>).userId = 'dev-user-no-auth';
          this.logger.log(`Client connected (dev mode, no auth): ${client.id}`);
          return;
        }
        client.disconnect();
        return;
      }

      (client.data as Record<string, unknown>).userId = user.userId;
      this.logger.log(`Client connected: ${client.id}, User: ${user.userId}`);
    } catch (error) {
      this.logger.error(
        `Authentication failed for client ${client.id}:`,
        error,
      );
      // 개발 환경에서는 에러가 있어도 연결 허용
      if (process.env.NODE_ENV === 'development') {
        (client.data as Record<string, unknown>).userId = 'dev-user-error';
        this.logger.log(
          `Client connected (dev mode, auth error): ${client.id}`,
        );
        return;
      }
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    client: Socket,
    payload: { executionId: string },
  ): Promise<void> {
    try {
      const { executionId } = payload;
      const userId = (client.data as Record<string, unknown>).userId as string;

      if (!userId) {
        client.emit('error', { message: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      if (!executionId) {
        client.emit('error', {
          message: 'Execution ID is required',
          code: 'INVALID_PAYLOAD',
        });
        return;
      }

      // 권한 확인
      const hasAccess = await this.logsService.checkAccess(userId, executionId);
      if (!hasAccess) {
        client.emit('error', {
          message: 'Access denied to this execution',
          code: 'ACCESS_DENIED',
        });
        return;
      }

      // Room 참가
      await client.join(`execution:${executionId}`);
      this.logger.log(
        `Client ${client.id} joined room execution:${executionId}`,
      );

      // 버퍼된 로그 즉시 전송
      const bufferedLogs = this.logBuffer.getRecentLogs(executionId);
      if (bufferedLogs.length > 0) {
        client.emit('logs:buffered', bufferedLogs);
      }

      // DB에서 이전 로그 로드
      const historicalLogs = await this.logsService.getHistoricalLogs(
        executionId,
        1000,
      );
      if (historicalLogs.length > 0) {
        client.emit('logs:historical', historicalLogs);
      }

      client.emit('subscribed', { executionId });
    } catch (error) {
      this.logger.error(
        `Error in handleSubscribe for client ${client.id}:`,
        error,
      );
      client.emit('error', {
        message: 'Failed to subscribe to execution logs',
        code: 'SUBSCRIBE_FAILED',
      });
    }
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    client: Socket,
    payload: { executionId: string },
  ): Promise<void> {
    const { executionId } = payload;
    await client.leave(`execution:${executionId}`);
    this.logger.log(`Client ${client.id} left room execution:${executionId}`);
    client.emit('unsubscribed', { executionId });
  }

  // CloudWatch에서 새 로그 수신 시 호출
  broadcastLogs(executionId: string, logs: any[]): void {
    // Broadcast each log individually for real-time effect
    logs.forEach((log) => {
      this.server.to(`execution:${executionId}`).emit('logs:new', log);
    });
    this.logger.debug(
      `Broadcasted ${logs.length} logs to execution:${executionId}`,
    );
  }

  // 실행 상태 변경 알림
  broadcastStatusChange(executionId: string, status: string): void {
    this.server
      .to(`execution:${executionId}`)
      .emit('status:changed', { executionId, status });
    this.logger.log(
      `Broadcasted status change to execution:${executionId}: ${status}`,
    );
  }

  // 실행 완료 알림
  broadcastExecutionComplete(executionId: string, status: string): void {
    this.server
      .to(`execution:${executionId}`)
      .emit('execution:complete', { executionId, status });
    this.logger.log(
      `Broadcasted execution complete to execution:${executionId}: ${status}`,
    );
  }

  private validateToken(token: string): { userId: string } | null {
    if (!token) {
      return null;
    }

    try {
      const decoded = this.jwtService.decode<{ userId: string }>(token);
      if (!decoded || !decoded.userId) {
        return null;
      }
      return decoded;
    } catch (error) {
      this.logger.error('Token validation error:', error);
      return null;
    }
  }
}
