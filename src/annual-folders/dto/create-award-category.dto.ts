import {
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAwardCategoryDto {
  @ApiProperty({
    description: 'Nombre de la categoría de distinción',
    example: 'Placa de Honor',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({
    description: 'Descripción de la categoría',
    example: 'Otorgada a clubes con desempeño sobresaliente en todas las áreas',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description:
      'ID del tipo de club al que aplica (null = aplica a todos los tipos)',
    example: 2,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  club_type_id?: number;

  @ApiProperty({
    description: 'Puntaje mínimo para obtener esta categoría',
    example: 80,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  min_points: number;

  @ApiPropertyOptional({
    description: 'Puntaje máximo de esta categoría (null = sin límite superior)',
    example: 100,
    minimum: 0,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({
    description: 'Nombre del ícono para la categoría',
    example: 'trophy',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({
    description: 'Orden de presentación de la categoría',
    example: 1,
    minimum: 0,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
