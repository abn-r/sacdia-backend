import {
  ArrayMaxSize,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Approach X i18n — Write DTO for a single non-es translation entry.
 *
 * Spanish (`es`) STAYS in the main table fields (name, description, etc.).
 * Translation tables hold ONLY non-es locales: pt-BR, en, fr.
 * The DB enforces this via a CHECK constraint `locale <> 'es'`.
 */
export class CatalogTranslationDto {
  @ApiPropertyOptional({
    description: 'Locale for this translation. Must be one of: pt-BR, en, fr. Spanish (es) lives in main table fields.',
    enum: ['pt-BR', 'en', 'fr'],
    example: 'en',
  })
  @IsIn(['pt-BR', 'en', 'fr'], {
    message: 'Locale must be one of: pt-BR, en, fr (es lives in main fields)',
  })
  locale: 'pt-BR' | 'en' | 'fr';

  @ApiPropertyOptional({
    description: 'Translated name. Pass empty string or omit to fall back to Spanish.',
    example: 'Missionary Achievement',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Translated description. Pass empty string or omit to fall back to Spanish.',
    example: 'Category for missionary honors',
  })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * Mixin-friendly translations field descriptor.
 * Add this to any catalog Create/Update DTO:
 *
 * @IsOptional()
 * @ValidateNested({ each: true })
 * @Type(() => CatalogTranslationDto)
 * @ArrayMaxSize(3)
 * translations?: CatalogTranslationDto[];
 */
export class WithCatalogTranslations {
  @ApiPropertyOptional({
    description:
      'Optional non-es translations. ' +
      'Pass undefined to leave existing translations untouched. ' +
      'Pass empty array [] to delete all existing translations. ' +
      'Pass entries for pt-BR, en and/or fr to upsert them. ' +
      'Spanish (es) is NEVER accepted here — it lives in main table fields.',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}
