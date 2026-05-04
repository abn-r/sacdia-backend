import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class UpdateRequirementProgressDto {
  @ApiProperty({ description: 'ID del requisito del honor' })
  @IsInt()
  declare requirementId: number;

  @ApiProperty({ description: 'Indica si el requisito fue completado' })
  @IsBoolean()
  declare completed: boolean;

  @ApiPropertyOptional({
    description: 'Respuesta de texto del usuario al requisito',
    maxLength: 800,
  })
  @IsOptional()
  @IsString()
  @MaxLength(800)
  textResponse?: string | null;

  @ApiPropertyOptional({
    description: 'Notas opcionales del miembro sobre el requisito',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class BulkUpdateRequirementProgressDto {
  @ApiProperty({
    description: 'Lista de actualizaciones de progreso por requisito',
    type: [UpdateRequirementProgressDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50, {
    message: 'Se pueden actualizar un máximo de 50 requisitos a la vez',
  })
  @ValidateNested({ each: true })
  @Type(() => UpdateRequirementProgressDto)
  declare requirements: UpdateRequirementProgressDto[];
}

// ---------------------------------------------------------------------------
// Evidence DTOs
// ---------------------------------------------------------------------------

export enum EvidenceType {
  IMAGE = 'IMAGE',
  FILE = 'FILE',
  LINK = 'LINK',
}

export class CreateEvidenceLinkDto {
  @ApiProperty({ description: 'URL del enlace externo' })
  @IsUrl()
  declare url: string;
}

export class DeleteEvidenceDto {
  @ApiProperty({ description: 'ID de la evidencia a eliminar' })
  @IsInt()
  declare evidenceId: number;
}

// ---------------------------------------------------------------------------
// Admin — Requirement management DTOs
// ---------------------------------------------------------------------------

export class CreateRequirementDto {
  @ApiProperty({ description: 'ID del honor' })
  @IsInt()
  declare honorId: number;

  @ApiPropertyOptional({
    description: 'ID del requisito padre (null = top-level)',
  })
  @IsOptional()
  @IsInt()
  parentId?: number | null;

  @ApiProperty({ description: 'Número de orden del requisito' })
  @IsInt()
  declare requirementNumber: number;

  @ApiPropertyOptional({
    description: 'Etiqueta visual (e.g., "1", "a", "ii")',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  displayLabel?: string | null;

  @ApiProperty({ description: 'Texto del requisito' })
  @IsString()
  declare requirementText: string;

  @ApiPropertyOptional({
    description: 'Texto de referencia (tablas, material adicional)',
  })
  @IsOptional()
  @IsString()
  referenceText?: string | null;

  @ApiPropertyOptional({
    description: 'Es un grupo de selección (elegí N de M)',
  })
  @IsOptional()
  @IsBoolean()
  isChoiceGroup?: boolean;

  @ApiPropertyOptional({ description: 'Mínimo de opciones a completar' })
  @IsOptional()
  @IsInt()
  choiceMin?: number | null;

  @ApiPropertyOptional({ description: 'Requiere evidencia obligatoria' })
  @IsOptional()
  @IsBoolean()
  requiresEvidence?: boolean;
}

export class UpdateRequirementDto {
  @ApiPropertyOptional({ description: 'Número de orden' })
  @IsOptional()
  @IsInt()
  requirementNumber?: number;

  @ApiPropertyOptional({ description: 'Etiqueta visual' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  displayLabel?: string | null;

  @ApiPropertyOptional({ description: 'Texto del requisito' })
  @IsOptional()
  @IsString()
  requirementText?: string;

  @ApiPropertyOptional({ description: 'Texto de referencia' })
  @IsOptional()
  @IsString()
  referenceText?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasSubItems?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isChoiceGroup?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  choiceMin?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresEvidence?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  needsReview?: boolean;
}

export class ReorderRequirementsDto {
  @ApiProperty({
    description: 'Lista de IDs en el nuevo orden',
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  declare requirementIds: number[];
}

export class BatchReviewDto {
  @ApiProperty({ description: 'IDs de requisitos a aprobar', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  declare requirementIds: number[];

  @ApiProperty({ description: 'true = aprobar, false = rechazar' })
  @IsBoolean()
  declare approved: boolean;
}
