import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../../common/validation/max-length-if-string.decorator';

export class CreateCertificationDto {
  @ApiProperty({
    description:
      'Nombre de la certificación (identidad estable entre versiones)',
    example: 'Certificación de Guía Mayor',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(255)
  name!: string;

  @ApiPropertyOptional({
    description: 'Descripción general de la certificación',
    example: 'Programa de certificación para Guías Mayores investidos',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
