import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ResourceQueryDto {
  @ApiPropertyOptional({
    description: 'Filtrar por tipo de recurso',
    enum: ['document', 'audio', 'image', 'video_link', 'text'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['document', 'audio', 'image', 'video_link', 'text'])
  resource_type?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de categoría' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  resource_category_id?: number;

  @ApiPropertyOptional({ description: 'Filtrar por ID de tipo de club' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_type_id?: number;

  @ApiPropertyOptional({
    description: 'Filtrar por nivel de alcance',
    enum: ['system', 'union', 'local_field'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['system', 'union', 'local_field'])
  scope_level?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID del ámbito (union o campo local)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scope_id?: number;

  @ApiPropertyOptional({ description: 'Número de página', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Resultados por página', default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Buscar por título del recurso' })
  @IsOptional()
  @IsString()
  search?: string;
}
