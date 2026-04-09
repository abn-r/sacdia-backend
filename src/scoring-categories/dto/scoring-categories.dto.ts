import {
  IsString,
  IsInt,
  IsOptional,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateScoringCategoryDto {
  @ApiProperty({ description: 'Nombre de la categoría (máx 100 chars)' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Puntos máximos por sesión para esta categoría', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_points: number;
}

export class UpdateScoringCategoryDto {
  @ApiPropertyOptional({ description: 'Nombre de la categoría' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Puntos máximos por sesión', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_points?: number;
}
