import { IsEnum, IsOptional, IsObject, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExecutionStatus } from '../../database/entities/execution.entity';

export class UpdateStatusDto {
  @ApiProperty({ enum: ExecutionStatus, description: 'New execution status' })
  @IsEnum(ExecutionStatus)
  status: ExecutionStatus;

  @ApiPropertyOptional({ description: 'Completion timestamp' })
  @IsOptional()
  completedAt?: Date;

  @ApiPropertyOptional({ description: 'Additional metadata to update' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Error message if status is FAILED' })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Archive URL if execution is completed' })
  @IsOptional()
  @IsString()
  archiveUrl?: string;
}
