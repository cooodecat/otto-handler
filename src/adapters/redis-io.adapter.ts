import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { INestApplication } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisUrl =
      process.env.REDIS_URL || process.env.REDIS_HOST
        ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`
        : 'redis://localhost:6379';

    console.log(
      '🔌 Connecting Socket.io to Redis:',
      redisUrl.replace(/:[^:]*@/, ':****@'),
    );

    const pubClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
      },
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

  createIOServer(port: number, options?: ServerOptions): Server {
    // Build CORS origins list based on environment
    const corsOrigins = (() => {
      if (process.env.NODE_ENV === 'production') {
        const origins: string[] = [];
        
        // Add CORS_ORIGIN environment variable origins
        if (process.env.CORS_ORIGIN) {
          origins.push(
            ...process.env.CORS_ORIGIN.split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }
        
        // Add FRONTEND_URL
        if (process.env.FRONTEND_URL) {
          origins.push(process.env.FRONTEND_URL);
          // Also add www variant if not present
          if (process.env.FRONTEND_URL.includes('://') && !process.env.FRONTEND_URL.includes('www.')) {
            const wwwUrl = process.env.FRONTEND_URL.replace('://', '://www.');
            origins.push(wwwUrl);
          }
        }
        
        // Fallback to known production domains
        if (origins.length === 0) {
          origins.push('https://codecat-otto.shop', 'https://www.codecat-otto.shop');
        }
        
        return Array.from(new Set(origins));
      } else {
        return [
          process.env.FRONTEND_URL || 'http://localhost:5173',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
        ];
      }
    })();

    console.log('Redis adapter CORS origins:', corsOrigins);

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: corsOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
        allowedHeaders: ['content-type', 'authorization'],
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      // Railway/Vercel specific
      allowEIO3: true,
      maxHttpBufferSize: 1e8, // 100 MB
      // Additional production optimizations
      ...(process.env.NODE_ENV === 'production' && {
        perMessageDeflate: false, // Disable compression for better performance
        httpCompression: false,
      }),
    }) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
      console.log('🔄 Socket.io using Redis adapter for session management');
    } else {
      console.warn(
        '⚠️ Socket.io running without Redis adapter - sessions will not persist',
      );
    }

    return server;
  }
}
