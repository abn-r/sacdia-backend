import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditActorDto } from '../../clubs/dto/overview.dto';

export class AdminAuditLogListItemDto {
  @ApiProperty({ description: 'audit_log_id serialized as string (BigInt)' })
  declare audit_log_id: string;

  @ApiProperty()
  declare entity_type: string;

  @ApiProperty()
  declare entity_id: string;

  @ApiProperty()
  declare action: string;

  @ApiProperty()
  declare result: string;

  @ApiProperty()
  declare source: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  declare summary: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  declare club_id: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  declare correlation_id: string | null;

  @ApiPropertyOptional({ nullable: true, type: AuditActorDto })
  declare actor: AuditActorDto | null;

  @ApiProperty({ description: 'ISO 8601 timestamp' })
  declare created_at: string;
}

export class AdminAuditLogPageDto {
  @ApiProperty({ type: [AdminAuditLogListItemDto] })
  declare items: AdminAuditLogListItemDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'Pass as cursor= to fetch the next page',
  })
  declare next_cursor: string | null;
}

export class AdminAuditLogDetailDto extends AdminAuditLogListItemDto {
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Domain changes only. Never a request body.',
  })
  declare changes: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  declare request_context: Record<string, unknown> | null;
}
