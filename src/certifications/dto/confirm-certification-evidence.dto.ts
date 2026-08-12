import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';

export class ConfirmCertificationEvidenceDto {
  @ApiProperty({
    description: 'ID de la evidencia creada durante el presign',
    example: 10,
  })
  @IsInt()
  @IsPositive()
  declare evidence_id: number;

  @ApiPropertyOptional({
    description: 'Checksum SHA-256 del archivo, en hexadecimal (64 caracteres)',
  })
  @IsOptional()
  @IsString()
  @Length(64, 64)
  checksum_sha256?: string;
}
