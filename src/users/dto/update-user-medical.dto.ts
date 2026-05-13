import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ── Severity enum (mirrors Postgres severity_level ENUM) ─────────────────────

export enum SeverityLevel {
  leve = 'leve',
  media = 'media',
  alta = 'alta',
}

// ── Per-entry DTOs ────────────────────────────────────────────────────────────

export class AllergyEntryDto {
  @ApiProperty({ example: 1, description: 'ID de la alergia del catálogo' })
  @IsInt()
  id!: number;

  @ApiProperty({
    enum: SeverityLevel,
    example: SeverityLevel.leve,
    description: 'Nivel de severidad de la alergia',
  })
  @IsEnum(SeverityLevel)
  severity!: SeverityLevel;
}

export class DiseaseEntryDto {
  @ApiProperty({ example: 5, description: 'ID de la enfermedad del catálogo' })
  @IsInt()
  id!: number;

  @ApiPropertyOptional({
    example: 2018,
    description: 'Año desde el cual el usuario padece la enfermedad (1900–2100)',
    minimum: 1900,
    maximum: 2100,
  })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  since_year?: number;
}

export class MedicineEntryDto {
  @ApiProperty({
    example: 7,
    description: 'ID del medicamento del catálogo',
  })
  @IsInt()
  id!: number;

  @ApiPropertyOptional({
    example: '5 mg cada 8 hs',
    description: 'Dosis del medicamento (máximo 255 caracteres)',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  dose?: string;
}

// ── Top-level request DTOs ────────────────────────────────────────────────────

export class UpdateUserAllergiesDto {
  @ApiProperty({
    type: [AllergyEntryDto],
    description: 'Lista de alergias activas con su nivel de severidad',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AllergyEntryDto)
  allergies!: AllergyEntryDto[];
}

export class UpdateUserDiseasesDto {
  @ApiProperty({
    type: [DiseaseEntryDto],
    description: 'Lista de enfermedades activas con año de inicio opcional',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DiseaseEntryDto)
  diseases!: DiseaseEntryDto[];
}

export class UpdateUserMedicinesDto {
  @ApiProperty({
    type: [MedicineEntryDto],
    description: 'Lista de medicamentos activos con dosis opcional',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MedicineEntryDto)
  medicines!: MedicineEntryDto[];
}
