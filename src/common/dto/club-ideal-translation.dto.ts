import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Translation DTO for club_ideals — carries `name` + `ideal` (NOT description).
 * Used by CreateClubIdealDto and UpdateClubIdealDto.
 * The `upsertTranslations` call MUST pass fields: ['name', 'ideal'] explicitly.
 */
export class ClubIdealTranslationDto {
  @ApiPropertyOptional({
    description:
      'Locale for this translation. Must be one of: pt-BR, en, fr. Spanish (es) lives in main table fields.',
    enum: ['pt-BR', 'en', 'fr'],
    example: 'en',
  })
  @IsIn(['pt-BR', 'en', 'fr'], {
    message: 'Locale must be one of: pt-BR, en, fr (es lives in main fields)',
  })
  declare locale: 'pt-BR' | 'en' | 'fr';

  @ApiPropertyOptional({
    description: 'Translated name for the club ideal.',
    example: 'Loyal',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description:
      'Translated ideal text (long-form). Replaces description for club ideals.',
    example: 'The pathfinder is loyal to God, his leaders and his country.',
  })
  @IsOptional()
  @IsString()
  ideal?: string;
}
