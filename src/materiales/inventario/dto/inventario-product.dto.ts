import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Re-exported from catalogo DTOs and extended with _count.variants for admin list view.

export class InventarioCategoryRefDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() label: string;
}

export class InventarioProgramaRefDto {
  @ApiProperty() id: number;
  @ApiProperty() label: string;
}

export class InventarioVariantOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() stock: number;
}

export class InventarioVariantDto {
  @ApiProperty() type: string;
  @ApiProperty({ type: [InventarioVariantOptionDto] }) options: InventarioVariantOptionDto[];
}

export class InventarioProductDto {
  @ApiProperty() id: string;
  @ApiProperty() sku: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: InventarioCategoryRefDto }) cat: InventarioCategoryRefDto;
  @ApiProperty({ type: InventarioProgramaRefDto }) programa: InventarioProgramaRefDto;
  @ApiProperty() price_centavos: number;
  @ApiProperty() stock: number;
  @ApiProperty() active: boolean;
  @ApiProperty({ description: 'Total number of variant records for this product' }) variant_count: number;
  @ApiPropertyOptional({ type: InventarioVariantDto }) variants?: InventarioVariantDto | null;
}

export class PaginatedInventarioProductDto {
  @ApiProperty({ type: [InventarioProductDto] }) data: InventarioProductDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class VariantStockUpdateResponseDto {
  @ApiProperty({ type: InventarioVariantOptionDto }) option: InventarioVariantOptionDto;
  @ApiProperty({ type: InventarioProductDto }) product: InventarioProductDto;
}
