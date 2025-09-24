import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { INestApplication } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST 
      ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
      : 'redis://localhost:6379';

    console.log('🔌 Connecting Socket.io to Redis:', redisUrl.replace(/:[^:]*@/, ':****@'));

    const pubClient = createClient({ 
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
      }
    });
    
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    pubClient.on('error', (err) => {
      console.error('Redis Pub Client Error:', err);
    });

    subClient.on('error', (err) => {
      console.error('Redis Sub Client Error:', err);
    });

    this.adapterConstructor = createAdapter(pubClient, subClient);
    console.log('✅ Socket.io Redis adapter connected successfully');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: process.env.NODE_ENV === 'production'
          ? ['https://codecat-otto.shop', 'https://www.codecat-otto.shop']
          : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      // Railway/Vercel specific
      allowEIO3: true,
      maxHttpBufferSize: 1e8, // 100 MB
    });

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
      console.log('🔄 Socket.io using Redis adapter for session management');
    } else {
      console.warn('⚠️ Socket.io running without Redis adapter - sessions will not persist');
    }

    return server;
  }
}