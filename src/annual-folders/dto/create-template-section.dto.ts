import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTemplateSectionDto {
  @ApiProperty({
    description: 'Nombre de la sección',
    example: 'Actas de reuniones',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción de la sección',
    example: 'Documentar todas las actas de reuniones del club',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Orden de la sección dentro del template',
    example: 1,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  order: number;

  @ApiPropertyOptional({
    description: 'Si la sección es obligatoria',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiProperty({ description: 'Maximum points for this section', example: 100 })
  @IsInt()
  @Min(0)
  max_points: number;

  @ApiPropertyOptional({
    description: 'Minimum points required',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimum_points?: number;
}
