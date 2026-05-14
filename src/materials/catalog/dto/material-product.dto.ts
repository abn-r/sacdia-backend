import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryRefDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare label: string;
}

export class ProgramaRefDto {
  @ApiProperty() declare id: number;
  @ApiProperty() declare label: string;
}

export class VariantOptionDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare label: string;
  @ApiProperty() declare stock: number;
}

export class VariantDto {
  @ApiProperty() declare type: string;
  @ApiProperty({ type: [VariantOptionDto] })
  declare options: VariantOptionDto[];
}

export class MaterialProductDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare sku: string;
  @ApiProperty() declare title: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty({ type: CategoryRefDto }) declare cat: CategoryRefDto;
  @ApiProperty({ type: ProgramaRefDto }) declare programa: ProgramaRefDto;
  @ApiProperty() declare price_centavos: number;
  @ApiProperty() declare stock: number;
  @ApiProperty() declare active: boolean;
  @ApiPropertyOptional({ type: VariantDto }) variants?: VariantDto | null;
}

export class PaginatedMaterialProductDto {
  @ApiProperty({ type: [MaterialProductDto] })
  declare data: MaterialProductDto[];
  @ApiProperty() declare total: number;
  @ApiProperty() declare page: number;
  @ApiProperty() declare pageSize: number;
}

export class MaterialCategoryWithCountDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare label: string;
  @ApiPropertyOptional() icon?: string | null;
  @ApiProperty() declare sort_order: number;
  @ApiProperty() declare count: number;
}

export class ProgramaDto {
  @ApiProperty() declare id: number;
  @ApiProperty() declare label: string;
}
