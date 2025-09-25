import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '../auth/jwt.service';
import { LogsService } from './logs.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';

// Type definitions for Socket.IO engine errors
interface EngineConnectionError {
  code?: string;
  message?: string;
  req?: {
    headers?: {
      origin?: string;
      referer?: string;
    };
  };
  context?: {
    request?: {
      headers?: {
        origin?: string;
        referer?: string;
      };
    };
    transport?: string;
  };
  transport?: string;
}

// Type definitions for Socket.io engine connection properties
interface SocketEngineConnection {
  transport?: {
    name?: string;
  };
  protocol?: number | string;
  closeReason?: string;
}

// Type for accessing Socket.io internal properties safely
type SocketWithConn = Socket & {
  conn?: SocketEngineConnection;
};

// JWT error types
interface JWTTokenExpiredError extends Error {
  name: 'TokenExpiredError';
  expiredAt?: Date;
}

interface JWTNotBeforeError extends Error {
  name: 'NotBeforeError';
  date?: Date;
}

type JWTError = JWTTokenExpiredError | JWTNotBeforeError | Error;

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
export class LogsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(LogsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly logsService: LogsService,
    private readonly logBuffer: LogBufferService,
  ) {}

  afterInit(server: Server): void {
    this.logger.log('LogsGateway initialized');

    if (!server) {
      this.logger.warn('Server is undefined in afterInit');
      return;
    }

    if (!server.engine) {
      this.logger.warn('Server engine is undefined in afterInit');
      return;
    }

    server.engine.on('connection_error', (err: EngineConnectionError) => {
      const origin =
        err?.req?.headers?.origin ?? err?.context?.request?.headers?.origin;
      const referer =
        err?.req?.headers?.referer ?? err?.context?.request?.headers?.referer;
      const transport = err?.context?.transport ?? err?.transport;
      this.logger.warn(
        `Engine connection error - code: ${err?.code ?? 'unknown'}, message: ${
          err?.message ?? 'unknown'
        }, transport: ${transport ?? 'unknown'}, origin: ${
          origin ?? 'unknown'
        }, referer: ${referer ?? 'unknown'}`,
      );
    });

    const logsNamespace = server.of('/logs');
    if (typeof logsNamespace.adapter?.on === 'function') {
      logsNamespace.adapter.on('error', (error) => {
        this.logger.error('Socket adapter error', error as Error);
      });
    }
  }

  handleConnection(client: Socket): void {
    // Log connection attempt with comprehensive details
    const origin = client.handshake.headers.origin;
    const userAgent = client.handshake.headers['user-agent'];

    // Safely access Socket.io internal connection properties
    const socketWithConn = client as SocketWithConn;
    const transport = socketWithConn.conn?.transport?.name ?? 'unknown';
    const protocol = String(socketWithConn.conn?.protocol ?? 'unknown');

    this.logger.log(
      `🔌 WebSocket connection attempt:\n` +
        `  - Client ID: ${client.id}\n` +
        `  - Origin: ${origin || 'unknown'}\n` +
        `  - Transport: ${transport}\n` +
        `  - Protocol: ${protocol}\n` +
        `  - User-Agent: ${userAgent?.substring(0, 100) || 'unknown'}`,
    );

    // JWT 토큰 검증 - auth.token 또는 쿠키에서 추출
    let token = client.handshake.auth.token as string;

    // auth.token이 없으면 쿠키에서 access_token 추출
    if (!token && client.handshake.headers.cookie) {
      const cookies = this.parseCookies(client.handshake.headers.cookie);
      token = cookies['access_token'] || '';
      if (token) {
        this.logger.log(
          `🍪 Token extracted from cookie (length: ${token.length} chars)`,
        );
      } else {
        this.logger.debug(
          `🍪 No access_token found in cookies. Available cookies: ${Object.keys(cookies).join(', ')}`,
        );
      }
    }

    if (!token) {
      this.logger.warn(
        `⚠️ No JWT token supplied:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - Origin: ${origin || 'unknown'}\n` +
          `  - Auth present: ${!!client.handshake.auth}\n` +
          `  - Cookie present: ${!!client.handshake.headers.cookie}`,
      );
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
          `❌ Invalid token:\n` +
            `  - Client ID: ${client.id}\n` +
            `  - Origin: ${origin || 'unknown'}\n` +
            `  - Token length: ${token?.length || 0} chars\n` +
            `  - Token preview: ${token?.substring(0, 20)}...`,
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
        `✅ Client authenticated successfully:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - User ID: ${user.userId}\n` +
          `  - Origin: ${origin || 'unknown'}`,
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
    // Safely access Socket.io internal connection properties
    const socketWithConn = client as SocketWithConn;
    const disconnectReason = socketWithConn.conn?.closeReason ?? 'unknown';
    const transport = socketWithConn.conn?.transport?.name ?? 'unknown';
    const userId =
      ((client.data as Record<string, unknown>)?.userId as string) ?? 'unknown';
    const connectionDuration =
      Date.now() - (client.handshake.issued || Date.now());

    this.logger.log(
      `🔌 Client disconnected:\n` +
        `  - Client ID: ${client.id}\n` +
        `  - User ID: ${userId}\n` +
        `  - Reason: ${disconnectReason}\n` +
        `  - Transport: ${transport}\n` +
        `  - Connection duration: ${(connectionDuration / 1000).toFixed(1)}s`,
    );
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    client: Socket,
    payload: { executionId: string },
  ): Promise<void> {
    const startTime = Date.now();

    try {
      const { executionId } = payload;
      const userId = (client.data as Record<string, unknown>).userId as string;

      this.logger.log(
        `🔔 Subscribe request:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - User ID: ${userId || 'none'}\n` +
          `  - Execution ID: ${executionId || 'none'}`,
      );

      if (!userId) {
        this.logger.warn(
          `🚫 Subscribe rejected - No user ID for client ${client.id}`,
        );
        client.emit('error', { message: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }

      if (!executionId) {
        this.logger.warn(
          `🚫 Subscribe rejected - No execution ID from client ${client.id}`,
        );
        client.emit('error', {
          message: 'Execution ID is required',
          code: 'INVALID_PAYLOAD',
        });
        return;
      }

      // 권한 확인
      this.logger.debug(
        `🔍 Checking access for user ${userId} to execution ${executionId}`,
      );
      const hasAccess = await this.logsService.checkAccess(userId, executionId);

      if (!hasAccess) {
        this.logger.warn(
          `🚫 Access denied:\n` +
            `  - User ID: ${userId}\n` +
            `  - Execution ID: ${executionId}\n` +
            `  - Client ID: ${client.id}`,
        );
        client.emit('error', {
          message: 'Access denied to this execution',
          code: 'ACCESS_DENIED',
        });
        return;
      }

      // Room 참가
      await client.join(`execution:${executionId}`);
      this.logger.log(
        `🚪 Client joined room:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - Room: execution:${executionId}\n` +
          `  - Total rooms: ${client.rooms.size}`,
      );

      // 버퍼된 로그 즉시 전송
      const bufferedLogs = this.logBuffer.getRecentLogs(executionId);
      if (bufferedLogs.length > 0) {
        this.logger.debug(
          `📦 Sending ${bufferedLogs.length} buffered logs to client ${client.id}`,
        );
        client.emit('logs:buffered', bufferedLogs);
      }

      // DB에서 이전 로그 로드
      const historicalLogs = await this.logsService.getHistoricalLogs(
        executionId,
        1000,
      );

      if (historicalLogs.length > 0) {
        this.logger.log(
          `📂 Sending historical logs:\n` +
            `  - Count: ${historicalLogs.length} logs\n` +
            `  - Execution: ${executionId}\n` +
            `  - Client: ${client.id}`,
        );
        client.emit('logs:historical', historicalLogs);
      } else {
        this.logger.debug(
          `📂 No historical logs found for execution ${executionId}`,
        );
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `✅ Subscribe completed successfully:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - Execution ID: ${executionId}\n` +
          `  - Buffered logs sent: ${bufferedLogs.length}\n` +
          `  - Historical logs sent: ${historicalLogs.length}\n` +
          `  - Time taken: ${elapsed}ms`,
      );

      client.emit('subscribed', { executionId });
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const err = error as Error;

      this.logger.error(
        `❌ Subscribe failed:\n` +
          `  - Client ID: ${client.id}\n` +
          `  - Error: ${err.message || 'Unknown error'}\n` +
          `  - Error type: ${err.name || 'UnknownError'}\n` +
          `  - Time elapsed: ${elapsed}ms\n` +
          `  - Stack: ${err.stack?.split('\n').slice(0, 2).join('\n')}`,
      );

      client.emit('error', {
        message: 'Failed to subscribe to execution logs',
        code: 'SUBSCRIBE_FAILED',
        details: err.message,
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
    // Broadcast each log individually for real-time effect
    logs.forEach((log) => {
      this.server.to(`execution:${executionId}`).emit('logs:new', log);
    });
    this.logger.log(
      `Broadcasted ${logs.length} logs to execution:${executionId}`,
    );
  }

  private validateToken(token: string): { userId: string } | null {
    if (!token) {
      this.logger.debug('🔐 No token provided for validation');
      return null;
    }

    try {
      // JWT 검증 - 서명과 만료 시간 체크
      this.logger.debug(
        `🔐 Attempting to verify JWT token (length: ${token.length})`,
      );

      const decoded = this.jwtService.decode<{ sub?: string; userId?: string }>(
        token,
      );

      if (!decoded) {
        this.logger.warn('🔐 JWT verification returned null/undefined');
        return null;
      }

      // sub 필드 우선, 없으면 userId 필드 사용 (하위 호환성)
      const userId = decoded.sub || decoded.userId;
      if (!userId) {
        this.logger.warn(
          `🔐 Token missing user identifier:\n` +
            `  - Has 'sub' field: ${!!decoded.sub}\n` +
            `  - Has 'userId' field: ${!!decoded.userId}\n` +
            `  - Decoded payload keys: ${Object.keys(decoded).join(', ')}`,
        );
        return null;
      }

      this.logger.debug(`🔐 Token validated successfully for user: ${userId}`);
      return { userId };
    } catch (error) {
      const err = error as JWTError;
      const errorName = err.name ?? 'UnknownError';
      const errorMessage = err.message ?? 'No error message';

      // Detailed error logging based on JWT error types
      if (errorName === 'TokenExpiredError') {
        const expiredError = err as JWTTokenExpiredError;
        this.logger.warn(
          `🔐 JWT token expired:\n` +
            `  - Error: ${errorMessage}\n` +
            `  - Expired at: ${expiredError.expiredAt?.toISOString() ?? 'unknown'}`,
        );
      } else if (errorName === 'JsonWebTokenError') {
        this.logger.warn(
          `🔐 JWT malformed or invalid:\n` +
            `  - Error: ${errorMessage}\n` +
            `  - Token preview: ${token.substring(0, 50)}...`,
        );
      } else if (errorName === 'NotBeforeError') {
        const notBeforeError = err as JWTNotBeforeError;
        this.logger.warn(
          `🔐 JWT not active yet:\n` +
            `  - Error: ${errorMessage}\n` +
            `  - Not before: ${notBeforeError.date?.toISOString() ?? 'unknown'}`,
        );
      } else {
        this.logger.error(
          `🔐 Unexpected JWT verification error:\n` +
            `  - Type: ${errorName}\n` +
            `  - Message: ${errorMessage}\n` +
            `  - Stack: ${err.stack?.split('\n').slice(0, 3).join('\n') ?? 'no stack trace'}`,
        );
      }

      return null;
    }
  }

  private parseCookies(cookieString: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieString) return cookies;

    try {
      cookieString.split(';').forEach((cookie) => {
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
