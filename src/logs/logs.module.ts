import { Module } from '@nestjs/common';
import { CloudwatchService } from './services/cloudwatch/cloudwatch.service';
import { LogBufferService } from './services/log-buffer/log-buffer.service';

@Module({
  providers: [CloudwatchService, LogBufferService]
})
export class LogsModule {}
