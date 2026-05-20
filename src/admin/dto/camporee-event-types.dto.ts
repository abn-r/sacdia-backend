import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';

export class CreateCamporeeEventTypeDto {
  @ApiProperty({ example: 'spiritual' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  declare code: string;

  @ApiProperty({ example: 'Espiritual' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({ example: 'Eventos de naturaleza espiritual y devocional' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateCamporeeEventTypeDto {
  @ApiPropertyOptional({ example: 'spiritual' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code?: string;

  @ApiPropertyOptional({ example: 'Espiritual' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'Eventos de naturaleza espiritual y devocional' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    type: [CatalogTranslationDto],
    description: 'Non-es translations (pt-BR, en, fr).',
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}
