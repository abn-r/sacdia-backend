import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateResourceCategoryDto {
  @ApiProperty({ description: 'Nombre de la categoría', maxLength: 100 })
  @IsString()
  @MaxLengthIfString(100)
  declare name: string;

  @ApiPropertyOptional({ description: 'Descripción de la categoría' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Estado activo (default true)' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
