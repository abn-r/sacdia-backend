import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { MaxLengthIfString } from '../../../common/validation/max-length-if-string.decorator';

export class CreateProductDto {
  @ApiProperty({ description: 'Unique product SKU', maxLength: 100 })
  @IsString()
  @MaxLengthIfString(100)
  declare sku: string;

  @ApiProperty({ description: 'Product title', maxLength: 200 })
  @IsString()
  @MaxLengthIfString(200)
  declare title: string;

  @ApiProperty({ description: 'Category UUID' })
  @IsUUID()
  declare material_category_id: string;

  @ApiProperty({ description: 'Club type ID (programa)' })
  @Type(() => Number)
  @IsInt()
  declare club_type_id: number;

  @ApiProperty({ description: 'Price in centavos (integer, no floats)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  declare price_centavos: number;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Initial stock (when product has no variants)',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    description: 'Whether product is active',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean = true;
}
