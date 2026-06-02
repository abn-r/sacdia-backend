import {
  IsString,
  MaxLength,
  IsOptional,
  IsIn,
  IsInt,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateResourceDto {
  @ApiProperty({ description: 'Título del recurso', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  declare title: string;

  @ApiPropertyOptional({ description: 'Descripción del recurso' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Tipo de recurso',
    enum: ['document', 'audio', 'image', 'video_link', 'text'],
  })
  @IsString()
  @IsIn(['document', 'audio', 'image', 'video_link', 'text'])
  declare resource_type: string;

  @ApiPropertyOptional({ description: 'ID de la categoría del recurso' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  resource_category_id?: number;

  @ApiPropertyOptional({
    description: 'ID del tipo de club. NULL = aplica a todos los tipos de club',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  club_type_id?: number;

  @ApiProperty({
    description: 'Nivel de alcance del recurso',
    enum: ['system', 'division', 'union', 'local_field'],
  })
  @IsString()
  @IsIn(['system', 'division', 'union', 'local_field'])
  declare scope_level: string;

  @ApiPropertyOptional({
    description:
      'ID del ámbito (division_id, union_id o local_field_id). NULL para scope system.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  scope_id?: number;

  @ApiPropertyOptional({
    description: 'URL externa para recursos de tipo video_link',
    maxLength: 1000,
  })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1000)
  external_url?: string;

  @ApiPropertyOptional({
    description: 'Contenido de texto para recursos de tipo text',
  })
  @IsOptional()
  @IsString()
  content?: string;
}
