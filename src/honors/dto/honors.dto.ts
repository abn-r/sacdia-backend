import {
  ArrayNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsDateString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

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

export class CreateUserHonorDto {
  @ApiProperty({ description: 'ID del honor/especialidad' })
  @IsInt()
  declare honorId: number;

  @ApiPropertyOptional({ description: 'Fecha de registro/inicio del honor' })
  @IsOptional()
  @IsDateString()
  date?: string;

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
    description: 'URLs de imágenes de evidencia',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[] | null;

  @ApiPropertyOptional({
    description: 'URL del documento adicional',
  })
  @IsOptional()
  @IsString()
  document?: string | null;
}

export class BulkCreateUserHonorsDto {
  @ApiProperty({
    description: 'Listado de honores a registrar',
    type: [CreateUserHonorDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateUserHonorDto)
  declare honors: CreateUserHonorDto[];
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
