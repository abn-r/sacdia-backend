import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CERTIFICATE_IMPORT_COMMENT_MAX_LENGTH,
  CERTIFICATE_IMPORT_REJECTION_REASON_MAX_LENGTH,
} from '../certificate-bulk-imports.types';

export class RejectCertificateImportDto {
  @ApiProperty({
    description: 'Motivo visible para que el miembro pueda corregir y reenviar',
    minLength: 1,
    maxLength: CERTIFICATE_IMPORT_REJECTION_REASON_MAX_LENGTH,
    example: 'La imagen no permite verificar la fecha de certificación.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(CERTIFICATE_IMPORT_REJECTION_REASON_MAX_LENGTH)
  declare reason: string;
}

export class ApproveCertificateImportDto {
  @ApiPropertyOptional({
    description: 'Comentario opcional del revisor de Campo Local',
    maxLength: CERTIFICATE_IMPORT_COMMENT_MAX_LENGTH,
    example: 'Comprobante revisado contra certificado adjunto.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CERTIFICATE_IMPORT_COMMENT_MAX_LENGTH)
  comment?: string;

  @ApiPropertyOptional({
    description:
      'Inscripción operativa no investida del mismo usuario, clase y periodo. Confirma acreditar sobre esa fila.',
    example: 4001,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  reconcile_enrollment_id?: number;

  @ApiPropertyOptional({
    description:
      'modified_at de esa inscripción, en ISO-8601. Si cambió, la aprobación no escribe.',
    example: '2026-03-01T12:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  expected_modified_at?: string;
}
