import {
  IsString,
  IsInt,
  IsOptional,
  MinLength,
  Min,
  IsPositive,
} from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty } from '@nestjs/swagger';
import { InventoryExtendedFieldsDto } from './inventory-extended-fields.dto';

export class UpdateItemDto extends InventoryExtendedFieldsDto {
  @ApiProperty({
    description: 'Nombre del item',
    example: 'Carpas 4 personas',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLengthIfString(100)
  name?: string;

  @ApiProperty({
    description: 'Descripción detallada del item',
    example: 'Carpas marca Coleman para 4 personas',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
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
