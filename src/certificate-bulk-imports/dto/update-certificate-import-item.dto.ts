import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CertificateBulkImportItemType } from '../certificate-bulk-imports.types';

export class UpdateCertificateImportItemDto {
  @ApiPropertyOptional({
    description: 'Tipo de fila detectada o corregida por el miembro',
    enum: CertificateBulkImportItemType,
    example: CertificateBulkImportItemType.HONOR,
  })
  @IsOptional()
  @IsEnum(CertificateBulkImportItemType)
  item_type?: CertificateBulkImportItemType;

  @ApiPropertyOptional({
    description: 'ID de la especialidad/honor seleccionada',
    minimum: 1,
    example: 12,
  })
  @ValidateIf(
    (dto: UpdateCertificateImportItemDto) =>
      dto.item_type === CertificateBulkImportItemType.HONOR &&
      dto.mark_as_ready === true,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  honor_id?: number;

  @ApiPropertyOptional({
    description: 'ID de la clase progresiva seleccionada',
    minimum: 1,
    example: 3,
  })
  @ValidateIf(
    (dto: UpdateCertificateImportItemDto) =>
      dto.item_type === CertificateBulkImportItemType.CLASS &&
      dto.mark_as_ready === true,
  )
  @Type(() => Number)
  @IsInt()
  @Min(1)
  class_id?: number;

  @ApiPropertyOptional({
    description: 'Nombre detectado por OCR antes de vincular al catálogo',
    maxLength: 255,
    example: 'Primeros Auxilios',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  detected_name?: string;

  @ApiPropertyOptional({
    description: 'Fecha detectada por OCR en formato ISO yyyy-mm-dd',
    example: '2026-04-12',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  detected_date?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de completado/certificación confirmada por el miembro en formato ISO yyyy-mm-dd',
    example: '2026-04-12',
  })
  @ValidateIf(
    (dto: UpdateCertificateImportItemDto) => dto.mark_as_ready === true,
  )
  @IsDateString({ strict: true })
  completed_at?: string;

  @ApiPropertyOptional({
    description: 'Confianza general del OCR entre 0 y 1',
    minimum: 0,
    maximum: 1,
    example: 0.82,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  ocr_confidence?: number;

  @ApiPropertyOptional({
    description: 'Confianza por campo, por ejemplo nombre/fecha/tipo',
    example: { name: 0.8, date: 0.7, type: 0.9 },
  })
  @IsOptional()
  @IsObject()
  field_confidence?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Indica que el miembro considera la fila lista para enviar a validación',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  mark_as_ready?: boolean;
}
