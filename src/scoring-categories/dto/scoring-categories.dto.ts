import {
  ArrayMaxSize,
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';

export enum ScoringModeDto {
  NUMERIC = 'numeric',
  BOOLEAN_FULL = 'boolean_full',
}

export class CreateScoringCategoryDto {
  @ApiProperty({ description: 'Nombre de la categoría (máx 100 chars)' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({
    description:
      'Puntos máximos semanales para esta categoría (cap dinámico desde system_config: scoring.category_max_points_cap)',
    minimum: 1,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare max_points: number;

  @ApiPropertyOptional({
    description:
      'Modo de captura: numeric permite puntos intermedios; boolean_full otorga 0 o max_points',
    enum: ScoringModeDto,
    default: ScoringModeDto.NUMERIC,
  })
  @IsOptional()
  @IsEnum(ScoringModeDto)
  scoring_mode?: ScoringModeDto;

  @ApiPropertyOptional({
    description:
      'Non-es translations. Pass undefined to leave existing untouched, [] to delete all, or entries for pt-BR / en / fr to upsert.',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateScoringCategoryDto {
  @ApiPropertyOptional({ description: 'Nombre de la categoría' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Puntos máximos semanales (cap dinámico desde system_config: scoring.category_max_points_cap)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_points?: number;

  @ApiPropertyOptional({
    description:
      'Modo de captura: numeric permite puntos intermedios; boolean_full otorga 0 o max_points',
    enum: ScoringModeDto,
  })
  @IsOptional()
  @IsEnum(ScoringModeDto)
  scoring_mode?: ScoringModeDto;

  @ApiPropertyOptional({ description: 'Estado activo de la categoría' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      'Non-es translations. Pass undefined to leave existing untouched, [] to delete all, or entries for pt-BR / en / fr to upsert.',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}
