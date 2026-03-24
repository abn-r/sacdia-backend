import { IsString, IsInt, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Nombre del template de carpeta anual',
    example: 'Carpeta Conquistadores 2026',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({
    description: 'ID del tipo de club (1: Aventureros, 2: Conquistadores, 3: Guías Mayores)',
    example: 2,
  })
  @IsInt()
  club_type_id: number;

  @ApiProperty({
    description: 'ID del año eclesiástico',
    example: 1,
  })
  @IsInt()
  ecclesiastical_year_id: number;

  @ApiPropertyOptional({
    description: 'Si el template está activo',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
