import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Re-exported from catalog DTOs and extended with _count.variants for admin list view.

export class InventoryCategoryRefDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare label: string;
}

export class InventoryProgramaRefDto {
  @ApiProperty() declare id: number;
  @ApiProperty() declare label: string;
}

export class InventoryVariantOptionDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare label: string;
  @ApiProperty() declare stock: number;
}

export class InventoryVariantDto {
  @ApiProperty() declare type: string;
  @ApiProperty({ type: [InventoryVariantOptionDto] })
  declare options: InventoryVariantOptionDto[];
}

export class InventoryProductDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare local_field_id: number;
  @ApiProperty() declare sku: string;
  @ApiProperty() declare title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: InventoryCategoryRefDto })
  declare cat: InventoryCategoryRefDto;
  @ApiProperty({ type: InventoryProgramaRefDto })
  declare programa: InventoryProgramaRefDto;
  @ApiProperty() declare price_centavos: number;
  @ApiProperty() declare stock: number;
  @ApiProperty() declare active: boolean;
  @ApiProperty({
    description: 'Total number of variant records for this product',
  })
  declare variant_count: number;
  @ApiPropertyOptional({ type: InventoryVariantDto })
  variants?: InventoryVariantDto | null;
}

export class PaginatedInventoryProductDto {
  @ApiProperty({ type: [InventoryProductDto] })
  declare data: InventoryProductDto[];
  @ApiProperty() declare total: number;
  @ApiProperty() declare page: number;
  @ApiProperty() declare pageSize: number;
}

export class VariantStockUpdateResponseDto {
  @ApiProperty({ type: InventoryVariantOptionDto })
  declare option: InventoryVariantOptionDto;
  @ApiProperty({ type: InventoryProductDto })
  declare product: InventoryProductDto;
}
