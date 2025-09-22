import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataStrategyFactory } from './data-strategy.config';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [DataStrategyFactory],
  exports: [DataStrategyFactory],
})
export class StrategyModule {}