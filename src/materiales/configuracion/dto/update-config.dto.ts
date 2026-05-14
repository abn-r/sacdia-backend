import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * Partial update DTO for MaterialConfig.
 * CLABE: 18-digit string, no checksum in v1 (deferred to v1.1 per design A-open).
 */
export class UpdateConfigDto {
  @ApiPropertyOptional({ description: 'Bank name' })
  @IsOptional()
  @IsString()
  bank_name?: string;

  @ApiPropertyOptional({
    description: '18-digit CLABE number',
    example: '012345678901234567',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{18}$/, {
    message: 'bank_account_clabe must be exactly 18 digits',
  })
  bank_account_clabe?: string;

  @ApiPropertyOptional({ description: 'Account holder name' })
  @IsOptional()
  @IsString()
  account_holder?: string;

  @ApiPropertyOptional({
    description: 'Default shipping cost in centavos',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  envio_centavos_default?: number;

  @ApiPropertyOptional({ description: 'Pickup address (if applicable)' })
  @IsOptional()
  @IsString()
  pickup_address?: string;

  @ApiPropertyOptional({
    description: 'Delivery options (JSON array)',
    type: 'array',
    items: { type: 'object' },
  })
  @IsOptional()
  @IsArray()
  delivery_options?: unknown[];
}
