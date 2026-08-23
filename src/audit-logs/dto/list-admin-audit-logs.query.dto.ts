import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListAdminAuditLogsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by entity_type' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  entity_type?: string;

  @ApiPropertyOptional({ description: 'Filter by actor user UUID' })
  @IsOptional()
  @IsUUID()
  actor_user_id?: string;

  @ApiPropertyOptional({
    description: 'Filter by action (CREATED, UPDATED, DELETED, or domain)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ enum: ['succeeded', 'failed'] })
  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  result?: 'succeeded' | 'failed';

  @ApiPropertyOptional({ enum: ['http', 'service'] })
  @IsOptional()
  @IsIn(['http', 'service'])
  source?: 'http' | 'service';

  @ApiPropertyOptional({
    description: 'Inclusive lower bound (ISO date or datetime)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound (ISO date or datetime)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by club_id' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  club_id?: number;

  @ApiPropertyOptional({ description: 'Filter by correlation UUID' })
  @IsOptional()
  @IsUUID()
  correlation_id?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiPropertyOptional({
    description: 'audit_log_id cursor from previous next_cursor',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  cursor?: string;
}
