import { IsOptional, IsString, IsNumber, IsEnum, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { LogLevel } from '../../database/entities/execution-log.entity';

export class LogQueryDto {
  @ApiPropertyOptional({ description: 'Filter by log level', enum: LogLevel })
  @IsOptional()
  @IsEnum(LogLevel)
  level?: LogLevel;

  @ApiPropertyOptional({ description: 'Search keyword in log messages' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Start timestamp for filtering logs' })
  @IsOptional()
  @Type(() => Date)
  startTime?: Date;

  @ApiPropertyOptional({ description: 'End timestamp for filtering logs' })
  @IsOptional()
  @Type(() => Date)
  endTime?: Date;

  @ApiPropertyOptional({ 
    description: 'Number of logs to return per page', 
    minimum: 1,
    maximum: 1000,
    default: 100
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(1000)
  limit?: number = 100;

  @ApiPropertyOptional({ 
    description: 'Page number for pagination', 
    minimum: 1,
    default: 1
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ 
    description: 'Sort order for logs', 
    enum: ['asc', 'desc'],
    default: 'desc'
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ description: 'Filter by source (e.g., function name, module)' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ description: 'Include raw CloudWatch logs' })
  @IsOptional()
  @Type(() => Boolean)
  includeRaw?: boolean = false;
}