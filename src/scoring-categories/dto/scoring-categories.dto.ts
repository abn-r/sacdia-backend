import {
  ArrayMaxSize,
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';

export class CreateScoringCategoryDto {
  @ApiProperty({ description: 'Nombre de la categoría (máx 100 chars)' })
  @IsString()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({
    description: 'Puntos máximos por sesión para esta categoría',
    minimum: 1,
    maximum: 1000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  declare max_points: number;

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
    description: 'Puntos máximos por sesión',
    minimum: 1,
    maximum: 1000,
  })
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
