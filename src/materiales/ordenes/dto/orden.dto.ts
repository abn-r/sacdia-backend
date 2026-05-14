import { ApiProperty } from '@nestjs/swagger';
import { OrdenLineDto } from './orden-line.dto';

export class OrdenDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  folio_referencia: string | null;

  @ApiProperty({
    enum: ['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'],
  })
  estado: string;

  @ApiProperty()
  club_section_id: number;

  @ApiProperty()
  created_by: string;

  @ApiProperty({ nullable: true })
  approved_by: string | null;

  @ApiProperty({ nullable: true })
  validated_by: string | null;

  @ApiProperty({ nullable: true })
  delivered_by: string | null;

  @ApiProperty({ nullable: true })
  cancelled_by: string | null;

  @ApiProperty()
  subtotal_centavos: number;

  @ApiProperty()
  envio_centavos: number;

  @ApiProperty()
  total_centavos: number;

  @ApiProperty({ enum: ['recoger', 'envio'] })
  entrega: string;

  @ApiProperty({ nullable: true })
  notas: string | null;

  @ApiProperty({ nullable: true })
  cancel_reason: string | null;

  @ApiProperty()
  refund_pending: boolean;

  // Bank snapshot fields (populated at approval time)
  @ApiProperty({ nullable: true })
  bank_name: string | null;

  @ApiProperty({ nullable: true })
  bank_account_clabe: string | null;

  @ApiProperty({ nullable: true })
  account_holder: string | null;

  @ApiProperty({ nullable: true })
  pickup_address: string | null;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ nullable: true })
  approved_at: Date | null;

  @ApiProperty({ nullable: true })
  paid_at: Date | null;

  @ApiProperty({ nullable: true })
  delivered_at: Date | null;

  @ApiProperty({ nullable: true })
  cancelled_at: Date | null;

  @ApiProperty({ type: [OrdenLineDto] })
  lines: OrdenLineDto[];

  /**
   * Comprobantes count placeholder — will carry a signed-URL array in PR4.
   * For PR3a, always 0.
   */
  @ApiProperty({
    description: 'Number of comprobantes attached (PR4 fills the array)',
  })
  comprobantes_count: number;
}
