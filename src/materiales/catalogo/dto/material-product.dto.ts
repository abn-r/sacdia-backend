import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryRefDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() label: string;
}

export class ProgramaRefDto {
  @ApiProperty() id: number;
  @ApiProperty() label: string;
}

export class VariantOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty() stock: number;
}

export class VariantDto {
  @ApiProperty() type: string;
  @ApiProperty({ type: [VariantOptionDto] }) options: VariantOptionDto[];
}

export class MaterialProductDto {
  @ApiProperty() id: string;
  @ApiProperty() sku: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: CategoryRefDto }) cat: CategoryRefDto;
  @ApiProperty({ type: ProgramaRefDto }) programa: ProgramaRefDto;
  @ApiProperty() price_centavos: number;
  @ApiProperty() stock: number;
  @ApiProperty() active: boolean;
  @ApiPropertyOptional({ type: VariantDto }) variants?: VariantDto | null;
}

export class PaginatedMaterialProductDto {
  @ApiProperty({ type: [MaterialProductDto] }) data: MaterialProductDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class MaterialCategoryWithCountDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() label: string;
  @ApiPropertyOptional() icon?: string | null;
  @ApiProperty() sort_order: number;
  @ApiProperty() count: number;
}

export class ProgramaDto {
  @ApiProperty() id: number;
  @ApiProperty() label: string;
}
