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
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
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

  async handleConnection(client: Socket): Promise<void> {
    // JWT 토큰 검증
    const token = client.handshake.auth.token;
    try {
      const user = await this.validateToken(token);
      if (!user) {
        this.logger.warn(`Invalid token for client ${client.id}`);
        client.disconnect();
        return;
      }
      
      client.data.userId = user.userId;
      this.logger.log(`Client connected: ${client.id}, User: ${user.userId}`);
    } catch (error) {
      this.logger.error(`Authentication failed for client ${client.id}:`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  private async validateToken(token: string): Promise<any> {
    if (!token) {
      return null;
    }

    try {
      const decoded = this.jwtService.decode(token);
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
