import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Re-exported from catalogo DTOs and extended with _count.variants for admin list view.

export class InventarioCategoryRefDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare label: string;
}

export class InventarioProgramaRefDto {
  @ApiProperty() declare id: number;
  @ApiProperty() declare label: string;
}

export class InventarioVariantOptionDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare label: string;
  @ApiProperty() declare stock: number;
}

export class InventarioVariantDto {
  @ApiProperty() declare type: string;
  @ApiProperty({ type: [InventarioVariantOptionDto] })
  declare options: InventarioVariantOptionDto[];
}

export class InventarioProductDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare sku: string;
  @ApiProperty() declare title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: InventarioCategoryRefDto })
  declare cat: InventarioCategoryRefDto;
  @ApiProperty({ type: InventarioProgramaRefDto })
  declare programa: InventarioProgramaRefDto;
  @ApiProperty() declare price_centavos: number;
  @ApiProperty() declare stock: number;
  @ApiProperty() declare active: boolean;
  @ApiProperty({
    description: 'Total number of variant records for this product',
  })
  declare variant_count: number;
  @ApiPropertyOptional({ type: InventarioVariantDto })
  variants?: InventarioVariantDto | null;
}

export class PaginatedInventarioProductDto {
  @ApiProperty({ type: [InventarioProductDto] }) declare data: InventarioProductDto[];
  @ApiProperty() declare total: number;
  @ApiProperty() declare page: number;
  @ApiProperty() declare pageSize: number;
}

export class VariantStockUpdateResponseDto {
  @ApiProperty({ type: InventarioVariantOptionDto })
  declare option: InventarioVariantOptionDto;
  @ApiProperty({ type: InventarioProductDto }) declare product: InventarioProductDto;
}
