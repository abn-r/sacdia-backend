import { ApiProperty } from '@nestjs/swagger';

export class OrdenLineDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  product_id: string;

  @ApiProperty({ nullable: true })
  variant_option_id: string | null;

  @ApiProperty()
  qty: number;

  @ApiProperty({ description: 'Snapshotted price at order creation time (centavos)' })
  price_centavos: number;

  @ApiProperty({
    enum: ['pendiente', 'disponible', 'parcial', 'agotado'],
  })
  disponibilidad: string;

  @ApiProperty({ nullable: true })
  qty_disponible: number | null;

  @ApiProperty({ description: 'Computed line total (centavos)' })
  line_total_centavos: number;
}
