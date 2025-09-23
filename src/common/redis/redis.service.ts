import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly eventTTL = 3600; // 1 hour

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.client = new Redis({
      host,
      port,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.client.on('connect', () => {
      this.logger.log('Redis client connected');
    });

    this.client.on('error', (error) => {
      this.logger.error('Redis client error:', error);
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
    });
  }

  async checkDuplicate(eventId: string): Promise<boolean> {
    try {
      const key = `eventbridge:event:${eventId}`;
      const value = JSON.stringify({
        timestamp: new Date().toISOString(),
        processed: true,
      });

      // SETNX - SET if Not eXists
      const result = await this.client.setnx(key, value);

      if (result === 1) {
        // Key was set successfully, now set expiration
        await this.client.expire(key, this.eventTTL);
        return true;
      }

      // Key already exists, it's a duplicate
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to check duplicate for event ${eventId}:`,
        error,
      );
      throw error;
    }
  }

  async saveEventHistory(eventId: string, eventData: any): Promise<void> {
    try {
      const historyKey = `eventbridge:history:${eventId}`;
      await this.client.setex(
        historyKey,
        this.eventTTL,
        JSON.stringify({
          ...eventData,
          processedAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to save event history for ${eventId}:`, error);
    }
  }

  async getEventHistory(eventId: string): Promise<unknown> {
    try {
      const historyKey = `eventbridge:history:${eventId}`;
      const data = await this.client.get(historyKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      this.logger.error(`Failed to get event history for ${eventId}:`, error);
      return null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.log('Redis client disconnected');
  }
}
