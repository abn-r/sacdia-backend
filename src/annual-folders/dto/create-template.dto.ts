import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Nombre del template de carpeta anual de evidencias',
    example: 'Carpeta Conquistadores 2026',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  declare name: string;

  @ApiProperty({
    description:
      'ID del tipo de club (1: Aventureros, 2: Conquistadores, 3: Guías Mayores)',
    example: 2,
  })
  @IsInt()
  declare club_type_id: number;

  @ApiProperty({
    description: 'ID del año eclesiástico',
    example: 1,
  })
  @IsInt()
  declare ecclesiastical_year_id: number;

  @ApiPropertyOptional({
    description: 'Si el template está activo',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    required: false,
    type: Number,
    description:
      'ID de la unión propietaria del template (exclusivo con owner_local_field_id)',
    example: 1,
  })
  @IsOptional()
  @IsNumber()
  owner_union_id?: number;

  @ApiPropertyOptional({
    required: false,
    type: Number,
    description:
      'ID del campo local propietario del template (exclusivo con owner_union_id)',
    example: 3,
  })
  @IsOptional()
  @IsNumber()
  owner_local_field_id?: number;
}
