import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import fastifyCookie from '@fastify/cookie';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger';
import { NestiaSwaggerComposer } from '@nestia/sdk';
import { RedisIoAdapter } from './adapters/redis-io.adapter';

async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'production',
    trustProxy: true, // Important for Railway/Vercel
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET ?? 'dev-cookie-secret',
  });

  // Setup Redis adapter for Socket.io if Redis is available
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    const redisIoAdapter = new RedisIoAdapter(app);
    try {
      await redisIoAdapter.connectToRedis();
      app.useWebSocketAdapter(redisIoAdapter);
      console.log('📡 WebSocket adapter: Redis (distributed)');
    } catch (error) {
      console.error('❌ Failed to connect Redis adapter:', error);
      console.log('📡 WebSocket adapter: In-memory (fallback)');
    }
  } else {
    console.log('📡 WebSocket adapter: In-memory (no Redis configured)');
  }

  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      'docs',
      'test-sse.html',
      'test-oauth.html',
      'test-callback.html',
    ],
  });
  // Build CORS origins list consistently across the app
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
        if (
          process.env.FRONTEND_URL.includes('://') &&
          !process.env.FRONTEND_URL.includes('www.')
        ) {
          const wwwUrl = process.env.FRONTEND_URL.replace('://', '://www.');
          origins.push(wwwUrl);
        }
      }

      // Fallback to known production domains
      if (origins.length === 0) {
        origins.push(
          'https://codecat-otto.shop',
          'https://www.codecat-otto.shop',
        );
      }

      const uniqueOrigins = Array.from(new Set(origins));
      console.log('🌐 CORS origins configured:', uniqueOrigins);
      return uniqueOrigins;
    } else {
      return [
        process.env.FRONTEND_URL || 'http://localhost:5173',
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175',
      ];
    }
  })();

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'X-Requested-With',
      'Accept',
    ],
  });
  if (process.env.NODE_ENV !== 'production') {
    const document = await NestiaSwaggerComposer.document(app, {
      openapi: '3.1',
      servers: [
        {
          url: `http://localhost:${process.env.OTTO_HANDLER_SERVER_PORT || 4000}/api/v1`,
          description: 'Localhost',
        },
      ],
      security: {
        bearer: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
        },
      },
    });

    SwaggerModule.setup('docs', app, document as OpenAPIObject);
  }

  const port = process.env.PORT ?? 3000;
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

  await app.listen(port, host);

  console.log(`🚀 Server is running on http://${host}:${port}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API Base Path: /api/v1`);
}
void bootstrap();
