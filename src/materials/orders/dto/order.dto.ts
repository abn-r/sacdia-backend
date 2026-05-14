import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderLineDto } from './order-line.dto';

export class OrderDto {
  @ApiProperty()
  declare id: string;

  @ApiProperty({ nullable: true })
  declare folio_referencia: string | null;

  @ApiProperty({
    enum: ['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'],
  })
  declare estado: string;

  @ApiProperty()
  declare club_section_id: number;

  @ApiProperty()
  declare created_by: string;

  @ApiProperty({ nullable: true })
  declare approved_by: string | null;

  @ApiProperty({ nullable: true })
  declare validated_by: string | null;

  @ApiProperty({ nullable: true })
  declare delivered_by: string | null;

  @ApiProperty({ nullable: true })
  declare cancelled_by: string | null;

  @ApiProperty()
  declare subtotal_centavos: number;

  @ApiProperty()
  declare envio_centavos: number;

  @ApiProperty()
  declare total_centavos: number;

  @ApiProperty({ enum: ['recoger', 'envio'] })
  declare entrega: string;

  @ApiProperty({ nullable: true })
  declare notas: string | null;

  @ApiProperty({ nullable: true })
  declare cancel_reason: string | null;

  @ApiProperty()
  declare refund_pending: boolean;

  // Bank snapshot fields (populated at approval time)
  @ApiProperty({ nullable: true })
  declare bank_name: string | null;

  @ApiProperty({ nullable: true })
  declare bank_account_clabe: string | null;

  @ApiProperty({ nullable: true })
  declare account_holder: string | null;

  @ApiProperty({ nullable: true })
  declare pickup_address: string | null;

  @ApiProperty()
  declare created_at: Date;

  @ApiProperty({ nullable: true })
  declare approved_at: Date | null;

  @ApiProperty({ nullable: true })
  declare paid_at: Date | null;

  @ApiProperty({ nullable: true })
  declare delivered_at: Date | null;

  @ApiProperty({ nullable: true })
  declare cancelled_at: Date | null;

  @ApiProperty({ type: [OrderLineDto] })
  declare lines: OrderLineDto[];

  /**
   * Comprobantes count placeholder — will carry a signed-URL array in PR4.
   * For PR3a, always 0.
   */
  @ApiProperty({
    description: 'Number of comprobantes attached (PR4 fills the array)',
  })
  declare comprobantes_count: number;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      nombre: { type: 'string', nullable: true },
      club: { type: 'string', nullable: true },
      user_id: { type: 'string' },
    },
  })
  director?: {
    nombre: string | null;
    club: string | null;
    user_id: string;
  } | null;

  @ApiPropertyOptional({
    type: 'object',
    properties: {
      local_field_id: { type: 'number' },
      name: { type: 'string', nullable: true },
      abbreviation: { type: 'string', nullable: true },
    },
  })
  local_field?: {
    local_field_id: number;
    name: string | null;
    abbreviation: string | null;
  };
}
