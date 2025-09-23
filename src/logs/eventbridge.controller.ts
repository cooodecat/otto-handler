import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { EventBridgeService } from './eventbridge.service';
import type { EventBridgeEvent } from './eventbridge.service';
import { ConfigService } from '@nestjs/config';

@ApiTags('EventBridge')
@Controller('events')
export class EventBridgeController {
  private readonly logger = new Logger(EventBridgeController.name);
  private readonly apiKey: string;

  constructor(
    private readonly eventBridgeService: EventBridgeService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.get<string>('API_KEY', 'local-dev-key');
  }

  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if an event is duplicate' })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiResponse({ status: 200, description: 'Returns duplicate check result' })
  async checkDuplicate(
    @Headers('x-api-key') apiKey: string,
    @Body() body: { eventId: string },
  ): Promise<{ isDuplicate: boolean }> {
    this.validateApiKey(apiKey);

    if (!body.eventId) {
      throw new BadRequestException('Event ID is required');
    }

    const isNew = await this.eventBridgeService.checkDuplicate(body.eventId);
    return { isDuplicate: !isNew };
  }

  @Post('process')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process EventBridge event' })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiResponse({ status: 200, description: 'Event processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid event format' })
  async processEvent(
    @Headers('x-api-key') apiKey: string,
    @Body() event: EventBridgeEvent,
  ): Promise<{ success: boolean; message: string }> {
    this.validateApiKey(apiKey);

    try {
      this.logger.log(
        `Received EventBridge event: ${event.id}, Source: ${event.source}`,
      );
      
      // Debug: Log full event details
      this.logger.log(`Event detail-type: ${event['detail-type']}`);
      this.logger.log(`Event detail: ${JSON.stringify(event.detail)}`);

      // Debug: Log full event details
      this.logger.log(`Event detail-type: ${event['detail-type']}`);
      this.logger.log(`Event detail: ${JSON.stringify(event.detail)}`);

      if (!event.id || !event.source || !event.detail) {
        throw new BadRequestException('Invalid event format');
      }

      if (event.source !== 'aws.codebuild') {
        this.logger.warn(
          `Ignoring non-CodeBuild event from source: ${event.source}`,
        );
        return {
          success: true,
          message: `Event from ${event.source} ignored`,
        };
      }

      await this.eventBridgeService.processEvent(event);

      return {
        success: true,
        message: 'Event processed successfully',
      };
    } catch (error: unknown) {
      this.logger.error('Failed to process event:', error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      const errorObj = error as { message?: string };
      return {
        success: false,
        message: errorObj.message || 'Failed to process event',
      };
    }
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test EventBridge endpoint' })
  @ApiResponse({ status: 200, description: 'Test successful' })
  test(): {
    success: boolean;
    message: string;
    eventBridgeEnabled: boolean;
    timestamp: string;
  } {
    return {
      success: true,
      message: 'EventBridge endpoint is working',
      eventBridgeEnabled: this.eventBridgeService.isEventBridgeEnabled(),
      timestamp: new Date().toISOString(),
    };
  }

  private validateApiKey(apiKey: string): void {
    if (!apiKey || apiKey !== this.apiKey) {
      this.logger.warn('Invalid API key attempt');
      throw new BadRequestException('Invalid API key');
    }
  }
}
