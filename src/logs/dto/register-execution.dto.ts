import { IsString, IsOptional, IsObject, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterExecutionDto {
  @ApiProperty({ description: 'Execution context or identifier' })
  @IsString()
  @IsNotEmpty()
  context: string;

  @ApiProperty({ description: 'Function name being executed' })
  @IsString()
  @IsNotEmpty()
  functionName: string;

  @ApiPropertyOptional({ description: 'Input parameters for the execution' })
  @IsOptional()
  @IsObject()
  inputParams?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}