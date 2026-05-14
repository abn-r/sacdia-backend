import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: 'Unique product SKU', maxLength: 100 })
  @IsString()
  @MaxLength(100)
  sku: string;

  @ApiProperty({ description: 'Product title', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'Category UUID' })
  @IsUUID()
  material_category_id: string;

  @ApiProperty({ description: 'Club type ID (programa)' })
  @Type(() => Number)
  @IsInt()
  club_type_id: number;

  @ApiProperty({ description: 'Price in centavos (integer, no floats)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_centavos: number;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Initial stock (when product has no variants)', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({ description: 'Whether product is active', default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean = true;
}
