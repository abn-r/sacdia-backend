import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCertificationDto {
  @ApiProperty({
    description:
      'Nombre de la certificación (identidad estable entre versiones)',
    example: 'Certificación de Guía Mayor',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Descripción general de la certificación',
    example: 'Programa de certificación para Guías Mayores investidos',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
