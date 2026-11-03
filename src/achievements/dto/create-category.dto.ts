import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Nombre de la categoría de logro',
    maxLength: 100,
  })
  @IsString()
  @MaxLengthIfString(100)
  declare name: string;

  @ApiPropertyOptional({
    description: 'Descripción de la categoría',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(500)
  description?: string;

  @ApiPropertyOptional({
    description: 'Icono de la categoría (nombre de icono o URL)',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLengthIfString(100)
  icon?: string;

  @ApiPropertyOptional({ description: 'Orden de visualización', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({
    description: 'Estado activo de la categoría',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
