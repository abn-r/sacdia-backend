import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadEvidenceDto {
  @ApiProperty({
    description: 'URL del archivo subido',
    example: 'https://storage.example.com/evidence/file.pdf',
  })
  @IsString()
  file_url: string;

  @ApiProperty({
    description: 'Nombre del archivo',
    example: 'acta-reunion-enero.pdf',
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  file_name: string;

  @ApiPropertyOptional({
    description: 'Notas adicionales sobre la evidencia',
    example: 'Acta de la reunión del 15 de enero',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
