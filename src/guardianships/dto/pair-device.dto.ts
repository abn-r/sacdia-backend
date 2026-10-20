import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const DEVICE_PLATFORMS = ['ios', 'android'] as const;

/**
 * POST /auth/device/pair. The token is validated by the SERVICE, not here: a
 * malformed token must get the same 400 DEVICE_PAIRING_TOKEN_INVALID as an
 * expired or unknown one. `label` and `app_version` are free text from the
 * child's phone: bounded here, sanitized by the service.
 */
export class PairDeviceDto {
  @ApiProperty({
    description:
      'The single-use token read from the QR (`sacdia://pair?t=<token>`).',
  })
  @IsString()
  @MaxLength(256)
  declare pairing_token: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsIn([...DEVICE_PLATFORMS])
  declare platform: (typeof DEVICE_PLATFORMS)[number];

  @ApiPropertyOptional({
    description: 'App version, e.g. 2.4.0 (<= 32 chars kept).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  declare app_version?: string;

  @ApiPropertyOptional({
    description:
      'Name of the phone, e.g. "Tablet de Ana" (sanitized, <= 40 chars kept).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  declare label?: string;
}
