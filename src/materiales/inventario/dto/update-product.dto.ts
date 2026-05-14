import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateProductDto {
  @ApiPropertyOptional({ description: 'Product title', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Product description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Price in centavos (integer)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_centavos?: number;

  @ApiPropertyOptional({ description: 'Direct product-level stock (only for products without variants)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({ description: 'Whether product is active' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
