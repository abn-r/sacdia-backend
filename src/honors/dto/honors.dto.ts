import {
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsDateString,
  IsUrl,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartHonorDto {
  @ApiPropertyOptional({ description: 'Fecha de inicio del honor' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class UpdateUserHonorDto {
  @ApiPropertyOptional({ description: 'Honor validado por instructor' })
  @IsOptional()
  @IsBoolean()
  validate?: boolean;

  @ApiPropertyOptional({
    description: 'URL del certificado (pasar null o string vacío para limpiar)',
  })
  @IsOptional()
  @IsString()
  certificate?: string | null;

  @ApiPropertyOptional({
    description:
      'URLs de imágenes de evidencia (pasar null o array vacío para limpiar)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[] | null;

  @ApiPropertyOptional({
    description:
      'URL del documento adicional (pasar null o string vacío para limpiar)',
  })
  @IsOptional()
  @IsString()
  document?: string | null;

  @ApiPropertyOptional({ description: 'Fecha de completación' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class HonorFiltersDto {
  @ApiPropertyOptional({ description: 'Filtrar por categoría de honor' })
  @IsOptional()
  @IsInt()
  categoryId?: number;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de club' })
  @IsOptional()
  @IsInt()
  clubTypeId?: number;

  @ApiPropertyOptional({
    description:
      'Filtrar por nivel de habilidad (1=Básico, 2=Avanzado, 3=Máster)',
    minimum: 1,
    maximum: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  skillLevel?: number;
}
