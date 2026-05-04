import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  IsIn,
  IsEnum,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { award_tier_enum } from '@prisma/client';
import {
  AWARD_CATEGORY_SCOPES,
  type AwardCategoryScope,
} from './award-category-scope.const';

export class CreateAwardCategoryDto {
  @ApiProperty({
    description: 'Nombre de la categoría de distinción',
    example: 'Placa de Honor',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  declare name: string;

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
  declare min_points: number;

  @ApiPropertyOptional({
    description:
      'Puntaje máximo de esta categoría (null = sin límite superior)',
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

  @ApiPropertyOptional({
    description:
      'Scope de la categoría: aplica a club, sección o miembro (default: club)',
    example: 'club',
    enum: AWARD_CATEGORY_SCOPES,
    default: 'club',
  })
  @IsOptional()
  @IsIn(AWARD_CATEGORY_SCOPES)
  scope?: AwardCategoryScope;

  @ApiPropertyOptional({
    description:
      'Porcentaje compuesto mínimo para esta categoría (0-100). Requiere max_composite_pct.',
    example: 70,
    minimum: 0,
    maximum: 100,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  min_composite_pct?: number;

  @ApiPropertyOptional({
    description:
      'Porcentaje compuesto máximo para esta categoría (0-100). Debe ser mayor que min_composite_pct.',
    example: 90,
    minimum: 0,
    maximum: 100,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  max_composite_pct?: number;

  @ApiPropertyOptional({
    enum: award_tier_enum,
    nullable: true,
    description: 'Tier classification (Bronze/Silver/Gold/Diamond)',
  })
  @IsOptional()
  @IsEnum(award_tier_enum)
  tier?: award_tier_enum | null;
}
