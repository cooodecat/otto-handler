import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import fastifyCookie from '@fastify/cookie';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
async function bootstrap() {
  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV !== 'production',
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
  );
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET ?? 'dev-cookie-secret',
  });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      'health',
      'docs',
      'test-sse.html',
      'test-oauth.html',
      'test-callback.html',
    ],
  });
  app.enableCors({
    origin:
      process.env.NODE_ENV === 'production'
        ? ['https://codecat-otto.shop', 'https://www.codecat-otto.shop']
        : [process.env.FRONTEND_URL || 'http://localhost:3000'],
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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
