import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES } from '../evidence/certification-evidence.constants';

export class PresignCertificationCloseoutEvidenceDto {
  @ApiProperty({
    description: 'Nombre original del archivo (solo se conserva la extensión)',
    example: 'acta-junta.pdf',
  })
  @IsString()
  @MaxLength(255)
  declare file_name: string;

  @ApiProperty({
    description: 'Tipo MIME declarado del archivo',
    enum: CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES,
  })
  @IsIn(CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES)
  declare mime_type: string;

  @ApiProperty({
    description: 'Tamaño declarado del archivo en bytes',
    example: 204800,
  })
  @IsInt()
  @IsPositive()
  declare file_size: number;
}

export class ConfirmCertificationCloseoutEvidenceDto {
  @ApiProperty({
    description: 'ID del comprobante de junta creado durante el presign',
    example: 10,
  })
  @IsInt()
  @IsPositive()
  declare closeout_evidence_id: number;

  @ApiPropertyOptional({
    description: 'Checksum SHA-256 del archivo, en hexadecimal (64 caracteres)',
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  checksum_sha256?: string;
}

export class RequestCertificationCloseoutChangesDto {
  @ApiProperty({
    description: 'Comentario obligatorio explicando qué se debe corregir',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  declare comment: string;
}
