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

export class CreateCountryDto {
  @ApiProperty({ example: 'México' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'MX' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  declare abbreviation: string;

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

export class UpdateCountryDto {
  @ApiPropertyOptional({ example: 'México' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'MX' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

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

export class CreateDivisionDto {
  @ApiProperty({ example: 'DIA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare code: string;

  @ApiProperty({ example: 'División Interamericana' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({ example: 'DIA' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  declare abbreviation: string;

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

export class UpdateDivisionDto {
  @ApiPropertyOptional({ example: 'DIA' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional({ example: 'División Interamericana' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'DIA' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  abbreviation?: string;

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

export class CreateUnionDto {
  @ApiProperty({ example: 'Unión Mexicana del Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'UMN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  declare abbreviation: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare country_id: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare division_id: number;

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

export class UpdateUnionDto {
  @ApiPropertyOptional({ example: 'Unión Mexicana del Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'UMN' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  country_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  division_id?: number;

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

export class CreateLocalFieldDto {
  @ApiProperty({ example: 'Campo Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 'CN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  declare abbreviation: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare union_id: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'America/Mexico_City', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

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

export class UpdateLocalFieldDto {
  @ApiPropertyOptional({ example: 'Campo Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'CN' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  abbreviation?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  union_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 'America/Mexico_City', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

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

export class CreateDistrictDto {
  @ApiProperty({ example: 'Distrito Norte' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare local_field_id: number;

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

export class UpdateDistrictDto {
  @ApiPropertyOptional({ example: 'Distrito Norte' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  local_field_id?: number;

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

export class CreateChurchDto {
  @ApiProperty({ example: 'Iglesia Central' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  declare name: string;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  declare district_id: number;

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

export class UpdateChurchDto {
  @ApiPropertyOptional({ example: 'Iglesia Central' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  district_id?: number;

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
