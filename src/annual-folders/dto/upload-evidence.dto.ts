import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadEvidenceDto {
  @ApiPropertyOptional({
    description: 'Notas adicionales sobre la evidencia',
    example: 'Acta de la reunión del 15 de enero',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}
