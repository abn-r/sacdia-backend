import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { certification_component_type_enum } from '@prisma/client';

export class UpsertComponentDto {
  @ApiProperty({
    enum: certification_component_type_enum,
    example: certification_component_type_enum.TEXT_RESPONSE,
  })
  @IsEnum(certification_component_type_enum)
  component_type!: certification_component_type_enum;

  @ApiProperty({
    example: 'Describe tu experiencia de liderazgo',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label!: string;

  @ApiPropertyOptional({ example: 'Responde en al menos 200 palabras' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({
    description:
      'Configuración específica del tipo de componente (validada por tipo)',
    example: { min_length: 200 },
  })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    description: 'honor_id FK (requerido para LINKED_HONOR)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  honor_id?: number;

  @ApiPropertyOptional({
    description: 'activity_type_id FK (requerido para LINKED_ACTIVITY)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  activity_type_id?: number;
}

export class UpsertSectionDto {
  @ApiProperty({ example: 'Liderazgo de unidad', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Evidencia de liderazgo práctico' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Sube al menos dos evidencias' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({ type: [UpsertComponentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertComponentDto)
  components!: UpsertComponentDto[];
}

export class UpsertModuleDto {
  @ApiProperty({ example: 'Módulo 1 — Liderazgo', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Fundamentos de liderazgo de club' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiProperty({ type: [UpsertSectionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertSectionDto)
  sections!: UpsertSectionDto[];
}

export class UpsertCertificationTreeDto {
  @ApiProperty({
    type: [UpsertModuleDto],
    description:
      'Árbol completo de módulos/secciones/componentes. Reemplaza la estructura existente de la versión DRAFT.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertModuleDto)
  modules!: UpsertModuleDto[];
}
