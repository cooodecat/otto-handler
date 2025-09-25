import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '../auth/jwt.service';
import { LogsService } from './logs.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin:
      process.env.NODE_ENV === 'production'
        ? (() => {
            const list: string[] = [];
            // Add CORS_ORIGIN environment variable origins
            if (process.env.CORS_ORIGIN) {
              list.push(
                ...process.env.CORS_ORIGIN.split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              );
            }
            // Add FRONTEND_URL if different
            if (process.env.FRONTEND_URL) {
              list.push(process.env.FRONTEND_URL);
              // Also add www variant if not present
              if (
                process.env.FRONTEND_URL.includes('://') &&
                !process.env.FRONTEND_URL.includes('www.')
              ) {
                const wwwUrl = process.env.FRONTEND_URL.replace(
                  '://',
                  '://www.',
                );
                list.push(wwwUrl);
              }
            }
            // Fallback to known production domains
            if (list.length === 0) {
              list.push(
                'https://codecat-otto.shop',
                'https://www.codecat-otto.shop',
              );
            }
            // De-duplicate and log for debugging
            const uniqueOrigins = Array.from(new Set(list));
            console.log('WebSocket CORS origins:', uniqueOrigins);
            return uniqueOrigins;
          })()
        : [
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175',
          ],
    credentials: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type', 'authorization'],
  },
  namespace: '/logs',
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  // Allow EIO3 for better compatibility
  allowEIO3: true,
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
    // Log connection attempt with details
    const origin = client.handshake.headers.origin;
    this.logger.log(
      `WebSocket connection attempt from: ${origin || 'unknown origin'}`,
    );

    // JWT 토큰 검증 - auth.token 또는 쿠키에서 추출
    let token = client.handshake.auth.token as string;
    
    // auth.token이 없으면 쿠키에서 access_token 추출
    if (!token && client.handshake.headers.cookie) {
      const cookies = this.parseCookies(client.handshake.headers.cookie);
      token = cookies['access_token'] || '';
      if (token) {
        this.logger.log('Token extracted from cookie');
      }
    }

    // 개발 환경에서는 토큰이 없어도 허용
    if (process.env.NODE_ENV === 'development' && !token) {
      (client.data as Record<string, unknown>).userId = 'dev-user';
      this.logger.log(`Client connected (dev mode): ${client.id}`);
      return;
    }

    try {
      const user = this.validateToken(token);
      if (!user) {
        this.logger.warn(
          `Invalid token for client ${client.id} from ${origin}`,
        );
        // 개발 환경에서는 토큰 검증 실패해도 연결 허용
        if (process.env.NODE_ENV === 'development') {
          (client.data as Record<string, unknown>).userId = 'dev-user-no-auth';
          this.logger.log(`Client connected (dev mode, no auth): ${client.id}`);
          return;
        }
        // Send error message before disconnecting
        client.emit('error', {
          message: 'Authentication failed: Invalid token',
          code: 'AUTH_FAILED',
        });
        client.disconnect();
        return;
      }

      (client.data as Record<string, unknown>).userId = user.userId;
      this.logger.log(
        `Client connected: ${client.id}, User: ${user.userId}, Origin: ${origin}`,
      );
    } catch (error) {
      this.logger.error(
        `Authentication failed for client ${client.id} from ${origin}:`,
        error as Error,
      );
      // 개발 환경에서는 에러가 있어도 연결 허용
      if (process.env.NODE_ENV === 'development') {
        (client.data as Record<string, unknown>).userId = 'dev-user-error';
        this.logger.log(
          `Client connected (dev mode, auth error): ${client.id}`,
        );
        return;
      }
      // Send error message before disconnecting
      client.emit('error', {
        message: 'Authentication error',
        code: 'AUTH_ERROR',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
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
      this.logger.log(
        `Fetched ${historicalLogs.length} historical logs for execution ${executionId}`,
      );
      if (historicalLogs.length > 0) {
        client.emit('logs:historical', historicalLogs);
        this.logger.log(
          `Emitted ${historicalLogs.length} historical logs to client ${client.id}`,
        );
      }

      client.emit('subscribed', { executionId });
    } catch (error) {
      this.logger.error(
        `Error in handleSubscribe for client ${client.id}:`,
        error as Error,
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

  // Event listener for new logs from LogBufferService
  @OnEvent('logs.new')
  handleNewLogs(payload: { executionId: string; logs: unknown[] }): void {
    const { executionId, logs } = payload;
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

  // 로그 브로드캐스트
  broadcastLogs(executionId: string, logs: unknown[]): void {
    this.server.to(`execution:${executionId}`).emit('logs:new', logs);
    this.logger.log(
      `Broadcasted ${logs.length} logs to execution:${executionId}`,
    );
  }

  private validateToken(token: string): { userId: string } | null {
    if (!token) {
      return null;
    }

    try {
      // JWT 디코딩 - sub 필드 지원 (HTTP 인증과 통일)
      const decoded = this.jwtService.decode<{ sub?: string; userId?: string }>(token);
      if (!decoded) {
        return null;
      }
      
      // sub 필드 우선, 없으면 userId 필드 사용 (하위 호환성)
      const userId = decoded.sub || decoded.userId;
      if (!userId) {
        this.logger.warn('Token missing both sub and userId fields');
        return null;
      }
      
      return { userId };
    } catch (error) {
      this.logger.error('Token validation error:', error as Error);
      return null;
    }
  }

  private parseCookies(cookieString: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieString) return cookies;
    
    try {
      cookieString.split(';').forEach(cookie => {
        const [key, ...rest] = cookie.trim().split('=');
        if (key) {
          cookies[key] = decodeURIComponent(rest.join('='));
        }
      });
    } catch (error) {
      this.logger.error('Cookie parsing error:', error);
    }
    
    return cookies;
  }
}
