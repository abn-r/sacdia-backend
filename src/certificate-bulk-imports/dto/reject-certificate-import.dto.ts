import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength, IsOptional } from 'class-validator';
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
}
