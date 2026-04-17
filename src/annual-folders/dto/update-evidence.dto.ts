import { IsString, IsOptional, MaxLength, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEvidenceDto {
  @ApiPropertyOptional({
    description: 'URL del archivo subido',
    example: 'https://storage.example.com/evidence/file.pdf',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  file_url?: string;

  @ApiPropertyOptional({
    description: 'Nombre del archivo',
    example: 'acta-reunion-enero.pdf',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre la evidencia',
    example: 'Acta de la reunión del 15 de enero',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
