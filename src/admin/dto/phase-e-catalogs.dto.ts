/**
 * Phase E i18n — Admin CRUD DTOs for 10 catalog tables with translation support.
 *
 * Catalogs: classes, class_modules, class_sections, folders, folders_modules,
 * folders_sections, finances_categories, inventory_categories, honors, master_honors.
 *
 * All DTOs follow the honors_categories pattern:
 *   - Base fields mirror column constraints from schema.prisma.
 *   - translations?: CatalogTranslationDto[] — non-es locales only.
 *   - Update variants extend PartialType(Create*Dto).
 */

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
} from '@prisma/client';
import { CatalogTranslationDto } from '../../common/dto/catalog-translation.dto';

// ─── SHARED: translation field mixin ─────────────────────────────────────────

const translationsField = () => {
  return (target: object, propertyKey: string) => {
    IsOptional()(target, propertyKey);
    ValidateNested({ each: true })(target, propertyKey);
    Type(() => CatalogTranslationDto)(target, propertyKey);
    ArrayMaxSize(3)(target, propertyKey);
  };
};

// ─── CLASSES ──────────────────────────────────────────────────────────────────

export class CreateClassDto {
  @ApiProperty({ example: 'Conquistadores', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Clase de conquistadores para jóvenes' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'club_type_id FK' })
  @IsOptional()
  @IsInt()
  @Min(1)
  club_type_id?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimum_age?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requires_invested_gm?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: 2025, nullable: true })
  @IsOptional()
  @IsInt()
  available_from_year_id?: number | null;

  @ApiPropertyOptional({ example: 2026, nullable: true })
  @IsOptional()
  @IsInt()
  available_until_year_id?: number | null;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  min_duration_years?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  max_duration_years?: number;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

// ─── CLASS MODULES ────────────────────────────────────────────────────────────

export class CreateClassModuleDto {
  @ApiProperty({ example: 'Módulo 1 — Fe', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Descripción del módulo' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1, description: 'class_id FK' })
  @IsInt()
  @Min(1)
  class_id!: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateClassModuleDto extends PartialType(CreateClassModuleDto) {}

// ─── CLASS SECTIONS ───────────────────────────────────────────────────────────

export class CreateClassSectionDto {
  @ApiProperty({ example: 'Sección 1 — Introducción', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Descripción de la sección' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1, description: 'module_id FK' })
  @IsInt()
  @Min(1)
  module_id!: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateClassSectionDto extends PartialType(CreateClassSectionDto) {}

// ─── FOLDERS ─────────────────────────────────────────────────────────────────

export class CreateFolderDto {
  @ApiProperty({ example: 'Carpeta Anual de Evidencias 2025', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Descripción de la carpeta' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'club_type FK' })
  @IsOptional()
  @IsInt()
  @Min(1)
  club_type?: number;

  @ApiPropertyOptional({ example: 1, description: 'ecclesiastical_year_id FK' })
  @IsOptional()
  @IsInt()
  @Min(1)
  ecclesiastical_year_id?: number;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateFolderDto extends PartialType(CreateFolderDto) {}

// ─── FOLDERS MODULES ──────────────────────────────────────────────────────────

export class CreateFolderModuleDto {
  @ApiProperty({ example: 'Módulo de Adoración', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Descripción del módulo de carpeta' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1, description: 'folder_id FK' })
  @IsOptional()
  @IsInt()
  @Min(1)
  folder_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 100,
    description: 'Max points for this module',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ example: 60, description: 'Minimum points required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimum_points?: number;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateFolderModuleDto extends PartialType(CreateFolderModuleDto) {}

// ─── FOLDERS SECTIONS ─────────────────────────────────────────────────────────

export class CreateFolderSectionDto {
  @ApiProperty({ example: 'Sección de Música', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Descripción de la sección de carpeta' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'module_id FK (folder_module_id)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  module_id?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: 50,
    description: 'Max points for this section',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  max_points?: number;

  @ApiPropertyOptional({ example: 30, description: 'Minimum points required' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minimum_points?: number;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateFolderSectionDto extends PartialType(
  CreateFolderSectionDto,
) {}

// ─── FINANCES CATEGORIES ──────────────────────────────────────────────────────

export class CreateFinanceCategoryDto {
  @ApiProperty({ example: 'Diezmos', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Categoría de ingresos por diezmos' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1, description: 'Type: 1=income, 2=expense' })
  @IsInt()
  @Min(1)
  type!: number;

  @ApiPropertyOptional({ example: 0, description: 'Icon identifier' })
  @IsOptional()
  @IsInt()
  @Min(0)
  icon?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateFinanceCategoryDto extends PartialType(
  CreateFinanceCategoryDto,
) {}

// ─── INVENTORY CATEGORIES ─────────────────────────────────────────────────────

/**
 * inventory_categories_translations has only `name` (no description field).
 * Use a custom translation DTO variant here.
 */
export class InventoryTranslationDto {
  @ApiPropertyOptional({
    description: 'Locale for this translation. Must be one of: pt-BR, en, fr.',
    enum: ['pt-BR', 'en', 'fr'],
    example: 'en',
  })
  locale!: 'pt-BR' | 'en' | 'fr';

  @ApiPropertyOptional({
    description:
      'Translated name. Pass empty string or omit to fall back to Spanish.',
    example: 'Camping Equipment',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class CreateInventoryCategoryDto {
  @ApiProperty({ example: 'Equipamiento', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 0, description: 'Icon identifier' })
  @IsOptional()
  @IsInt()
  @Min(0)
  icon?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Non-es translations for name only (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateInventoryCategoryDto extends PartialType(
  CreateInventoryCategoryDto,
) {}

// ─── HONORS ──────────────────────────────────────────────────────────────────

export class CreateHonorCatalogDto {
  @ApiProperty({ example: 'Natación', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Honor de natación para conquistadores' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'https://storage.example.com/honor.jpg' })
  @IsString()
  @IsNotEmpty()
  honor_image!: string;

  @ApiProperty({ example: 1, description: 'honors_category_id FK' })
  @IsInt()
  @Min(1)
  honors_category_id!: number;

  @ApiProperty({ example: 1, description: 'club_type_id FK' })
  @IsInt()
  @Min(1)
  club_type_id!: number;

  @ApiProperty({ example: 'https://storage.example.com/material.pdf' })
  @IsString()
  @IsNotEmpty()
  material_url!: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Approval level (1-3)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  approval?: number;

  @ApiPropertyOptional({ example: 1, description: 'Skill level (1-3)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  skill_level?: number;

  @ApiPropertyOptional({
    example: null,
    nullable: true,
    description: 'master_honors_id FK (optional)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  master_honors_id?: number | null;

  @ApiPropertyOptional({
    example: '2025',
    description: 'Year string (optional)',
  })
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional({
    description: 'Non-es translations (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateHonorCatalogDto extends PartialType(CreateHonorCatalogDto) {}

// ─── MASTER HONORS ────────────────────────────────────────────────────────────

/**
 * master_honors_translations has only `name` (no description field).
 */

export class MasterHonorRuleOptionDto {
  @ApiPropertyOptional({ example: 1, description: 'option_id (for updates)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  option_id?: number;

  @ApiProperty({ example: 'Natación avanzada', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order = 0;

  @ApiProperty({ example: [1, 2], description: 'Honor IDs included in this option' })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Min(1, { each: true })
  honor_ids!: number[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class MasterHonorRequirementGroupDto {
  @ApiPropertyOptional({ example: 10, description: 'group_id (for updates)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  group_id?: number;

  @ApiProperty({
    enum: master_honor_requirement_group_type_enum,
    example: master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
  })
  @IsEnum(master_honor_requirement_group_type_enum)
  group_type!: master_honor_requirement_group_type_enum;

  @ApiPropertyOptional({ example: 'Especialidades base', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    example: 'Mínimo 3 entre estas especialidades',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  minimum_required!: number;

  @ApiPropertyOptional({
    example: 3,
    description: 'Required for CATEGORY_COUNT groups',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  honors_category_id?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    description: 'Group-specific options for EXPLICIT_OPTIONS groups',
    type: [MasterHonorRuleOptionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MasterHonorRuleOptionDto)
  options?: MasterHonorRuleOptionDto[];
}

export class CreateMasterHonorDto {
  @ApiProperty({ example: 'Maestro en Natación', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: 'https://storage.example.com/master-honor.jpg',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  master_image?: string | null;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: master_honor_applicability_scope_enum,
    example: master_honor_applicability_scope_enum.ALL,
    description:
      'Define si aplica a todas las divisiones o a una lista específica.',
  })
  @IsOptional()
  @IsEnum(master_honor_applicability_scope_enum)
  applicability_scope?: master_honor_applicability_scope_enum;

  @ApiPropertyOptional({ example: 'Enfocado a servicio y liderazgo' })
  @IsOptional()
  @IsString()
  philosophy?: string | null;

  @ApiPropertyOptional({
    example: 'Requiere aprobación de una comisión local y evidencia de 6 meses.',
  })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'IDs de divisiones cuando applicability_scope es SELECTED_DIVISIONS',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  division_ids?: number[];

  @ApiPropertyOptional({
    type: [MasterHonorRequirementGroupDto],
    description: 'Reglas de requisitos configurables para la maestría',
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => MasterHonorRequirementGroupDto)
  requirement_groups?: MasterHonorRequirementGroupDto[];

  @ApiPropertyOptional({
    description: 'Non-es translations for name only (pt-BR, en, fr).',
    type: [CatalogTranslationDto],
  })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CatalogTranslationDto)
  @ArrayMaxSize(3)
  translations?: CatalogTranslationDto[];
}

export class UpdateMasterHonorDto extends PartialType(CreateMasterHonorDto) {}
