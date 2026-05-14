import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response shape for GET /configuracion and PATCH /configuracion.
 * REQ-CFG-001, REQ-CFG-002
 */
export class ConfigDto {
  @ApiPropertyOptional() bank_name?: string | null;
  @ApiPropertyOptional() bank_account_clabe?: string | null;
  @ApiPropertyOptional() account_holder?: string | null;
  @ApiProperty() declare envio_centavos_default: number;
  @ApiPropertyOptional() pickup_address?: string | null;
  @ApiProperty() declare delivery_options: unknown;
  @ApiProperty() declare updated_at: Date;
}
