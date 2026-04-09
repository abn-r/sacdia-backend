import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateScoringCategoryDto {
  @ApiProperty({ description: 'Nombre de la categoría (máx 100 chars)' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Puntos máximos por sesión para esta categoría', minimum: 1, maximum: 1000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  max_points: number;
}

export class UpdateScoringCategoryDto {
  @ApiPropertyOptional({ description: 'Nombre de la categoría' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Puntos máximos por sesión', minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  max_points?: number;

  @ApiPropertyOptional({ description: 'Estado activo de la categoría' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
