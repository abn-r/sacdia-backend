import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class UpsertCertificationVersionDto {
  @ApiPropertyOptional({
    description: 'Título visible de esta versión de la certificación',
    example: 'Certificación de Guía Mayor — 2026',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    description: 'Descripción de esta versión',
    example: 'Actualización de requisitos para el ciclo 2026',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Duración mínima en meses para completar la certificación',
    example: 6,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  min_duration_months?: number;

  @ApiPropertyOptional({
    description: 'Duración máxima en meses para completar la certificación',
    example: 24,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  max_duration_months?: number;
}
