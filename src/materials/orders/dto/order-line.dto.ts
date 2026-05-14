import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OrderLineProductRefDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare sku: string;
  @ApiProperty() declare title: string;
}

class OrderLineVariantRefDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare label: string;
}

export class OrderLineDto {
  @ApiProperty()
  declare id: string;

  @ApiProperty()
  declare product_id: string;

  @ApiProperty({ nullable: true })
  declare variant_option_id: string | null;

  @ApiProperty()
  declare qty: number;

  @ApiProperty({
    description: 'Snapshotted price at order creation time (centavos)',
  })
  declare price_centavos: number;

  @ApiProperty({
    enum: ['pendiente', 'disponible', 'parcial', 'agotado'],
  })
  declare disponibilidad: string;

  @ApiProperty({ nullable: true })
  declare qty_disponible: number | null;

  @ApiProperty({ description: 'Computed line total (centavos)' })
  declare line_total_centavos: number;

  @ApiPropertyOptional({ type: OrderLineProductRefDto, nullable: true })
  product?: OrderLineProductRefDto | null;

  @ApiPropertyOptional({ type: OrderLineVariantRefDto, nullable: true })
  variant_option?: OrderLineVariantRefDto | null;
}
