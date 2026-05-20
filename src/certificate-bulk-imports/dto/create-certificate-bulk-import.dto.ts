import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  CERTIFICATE_IMPORT_MAX_FILES,
  CERTIFICATE_IMPORT_MAX_ITEMS,
} from '../certificate-bulk-imports.types';
import { UpdateCertificateImportItemDto } from './update-certificate-import-item.dto';

export class CertificateBulkImportFileDto {
  @ApiProperty({
    description: 'URL o key del archivo ya cargado en storage',
    maxLength: 500,
    example: 'https://cdn.sacdia.app/evidence/certificado.jpg',
  })
  @IsString()
  @MaxLength(500)
  declare file_url: string;

  @ApiProperty({
    description: 'Nombre original o visible del archivo',
    maxLength: 255,
    example: 'certificado-investidura.jpg',
  })
  @IsString()
  @MaxLength(255)
  declare file_name: string;

  @ApiProperty({
    description: 'MIME type del archivo',
    maxLength: 50,
    example: 'image/jpeg',
  })
  @IsString()
  @MaxLength(50)
  declare file_type: string;

  @ApiPropertyOptional({
    description: 'Texto OCR bruto si el cliente/proveedor ya lo generó',
  })
  @IsOptional()
  @IsString()
  ocr_raw_text?: string;
}

export class CreateCertificateBulkImportDto {
  @ApiProperty({
    description: 'Archivos comprobantes/certificados a procesar',
    type: [CertificateBulkImportFileDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CERTIFICATE_IMPORT_MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => CertificateBulkImportFileDto)
  declare files: CertificateBulkImportFileDto[];

  @ApiPropertyOptional({
    description: 'Payload OCR bruto para auditoría y depuración',
  })
  @IsOptional()
  @IsObject()
  raw_ocr_payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Filas iniciales detectadas o precargadas. Normalmente las crea el OCR backend.',
    type: [UpdateCertificateImportItemDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CERTIFICATE_IMPORT_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => UpdateCertificateImportItemDto)
  items?: UpdateCertificateImportItemDto[];
}
