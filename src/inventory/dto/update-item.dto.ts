import {
  IsString,
  IsInt,
  IsOptional,
  MinLength,
  MaxLength,
  Min,
  IsPositive,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateItemDto {
  @ApiProperty({
    description: 'Nombre del item',
    example: 'Carpas 4 personas',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name?: string;

  @ApiProperty({
    description: 'Descripción detallada del item',
    example: 'Carpas marca Coleman para 4 personas',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    description: 'ID de la categoría de inventario',
    example: 1,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  inventory_category_id?: number;

  @ApiProperty({
    description: 'Cantidad disponible',
    example: 8,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;
}
