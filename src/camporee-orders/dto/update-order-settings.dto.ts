import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, Matches } from 'class-validator';

const OFFSET_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class UpdateOrderSettingsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  orders_enabled?: boolean;

  @ApiPropertyOptional({
    example: '2026-08-01T08:00:00-06:00',
    nullable: true,
    description: 'Apertura de pedidos con Z u offset explícito',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_opens_at?: string | null;

  @ApiPropertyOptional({
    example: '2026-08-24T23:59:59-06:00',
    nullable: true,
    description: 'Cierre de pedidos con Z u offset explícito',
  })
  @IsOptional()
  @Matches(OFFSET_TIMESTAMP_PATTERN)
  orders_deadline?: string | null;
}
