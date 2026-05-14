import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ description: 'URL-safe identifier — lowercase, kebab-case' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, digits and dashes only',
  })
  declare slug: string;

  @ApiProperty({ description: 'Display label, e.g. "Uniformes"' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare label: string;

  @ApiPropertyOptional({
    description:
      'Optional Lucide icon name (e.g. "shirt", "book") — UI maps it to a component.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  icon?: string;

  @ApiPropertyOptional({ description: 'Sort order, ascending. Default 0.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
