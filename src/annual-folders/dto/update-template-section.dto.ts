import { IsString, IsInt, IsOptional, IsBoolean, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateTemplateSectionDto {
  @ApiPropertyOptional({
    description: 'Nombre de la sección',
    example: 'Actas de reuniones',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    description: 'Descripción de la sección',
    example: 'Documentar todas las actas de reuniones del club',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Orden de la sección dentro del template',
    example: 1,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @ApiPropertyOptional({
    description: 'Si la sección es obligatoria',
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}
