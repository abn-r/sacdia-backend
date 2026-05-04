import {
  IsString,
  IsInt,
  IsPositive,
  IsOptional,
  MinLength,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateItemDto {
  @ApiProperty({
    description: 'Nombre del item',
    example: 'Carpas 4 personas',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  declare name: string;

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
  })
  @IsInt()
  @IsPositive()
  declare inventory_category_id: number;

  @ApiProperty({
    description: 'Cantidad disponible',
    example: 8,
  })
  @IsInt()
  @Min(0)
  declare amount: number;

  @ApiProperty({
    description: 'Tipo de instancia de club (adv, pathf, mg)',
    example: 'pathf',
  })
  @IsString()
  declare instanceType: 'adv' | 'pathf' | 'mg';
}
