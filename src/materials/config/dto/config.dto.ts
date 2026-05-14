import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape for GET /config and PATCH /config.
 * REQ-CFG-001, REQ-CFG-002
 */
export class ConfigDto {
  @ApiProperty() declare local_field_id: number;
  @ApiPropertyOptional() bank_name?: string | null;
  @ApiPropertyOptional() bank_account_clabe?: string | null;
  @ApiPropertyOptional() account_holder?: string | null;
  @ApiProperty() declare envio_centavos_default: number;
  @ApiPropertyOptional() pickup_address?: string | null;
  @ApiProperty() declare delivery_options: unknown;
  @ApiPropertyOptional() updated_at?: Date | null;
}
