import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const CONSENT_QUEUE_DEFAULT_LIMIT = 50;
export const CONSENT_QUEUE_MAX_LIMIT = 100;

/** Page of GET /coordination/me/consent-pending (offset pagination). */
export class CoordinatorConsentPendingQueryDto {
  @ApiPropertyOptional({
    default: CONSENT_QUEUE_DEFAULT_LIMIT,
    minimum: 1,
    maximum: CONSENT_QUEUE_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONSENT_QUEUE_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
