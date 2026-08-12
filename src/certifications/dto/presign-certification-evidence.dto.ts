import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsPositive, IsString, MaxLength } from 'class-validator';
import { CERTIFICATION_EVIDENCE_ALLOWED_MIME_TYPES } from '../evidence/certification-evidence.constants';

export class PresignCertificationEvidenceDto {
  @ApiProperty({
    description:
      'ID del componente FILE_EVIDENCE dentro de la sección al que pertenece la evidencia',
    example: 5,
  })
  @IsInt()
  @IsPositive()
  declare component_id: number;

  @ApiProperty({
    description: 'Nombre original del archivo (solo se conserva la extensión)',
    example: 'comprobante.pdf',
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
