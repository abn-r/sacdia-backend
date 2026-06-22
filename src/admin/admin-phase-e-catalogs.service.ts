/**
 * AdminPhaseECatalogsService — Phase E i18n admin CRUD.
 *
 * Provides create/update/delete/findAll for 10 catalog tables that have
 * `_translations` siblings. Follows the honors_categories pattern established
 * in admin-reference.service.ts (createHonorCategory method).
 *
 * Unique index name format: Prisma auto-generates <col1>_<col2> for
 * @@unique([col1, col2]) when no explicit `map:` name is provided.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../common/services/translation.service';
import {
  MASTER_HONOR_RECALCULATION_JOB_OPTIONS,
  MASTER_HONORS_QUEUE,
  MasterHonorJobMasterHonorData,
} from '../honors/master-honors.constants';
import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
} from '@prisma/client';
import {
  CreateClassDto,
  UpdateClassDto,
  CreateClassModuleDto,
  UpdateClassModuleDto,
  CreateClassSectionDto,
  UpdateClassSectionDto,
  CreateFinanceCategoryDto,
  UpdateFinanceCategoryDto,
  CreateInventoryCategoryDto,
  UpdateInventoryCategoryDto,
  CreateHonorCatalogDto,
  UpdateHonorCatalogDto,
  CreateMasterHonorDto,
  UpdateMasterHonorDto,
} from './dto/phase-e-catalogs.dto';

@Injectable()
export class AdminPhaseECatalogsService {
  private readonly logger = new Logger(AdminPhaseECatalogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
    @Optional()
    @InjectQueue(MASTER_HONORS_QUEUE)
    private readonly masterHonorsQueue: Queue | undefined,
  ) {}

  private normalizeName(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private logMutation(
    action: string,
    resource: string,
    resourceId: string | number,
    actorId: string,
  ) {
    this.logger.log(
      JSON.stringify({
        action,
        resource,
        resourceId,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  // ==========================================================================
  // CLASSES
  // Translation table: classes_translations
  // PK field: class_id  |  Translation FK: class_id
  // Unique index (Prisma-generated): class_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllClasses() {
    return this.prisma.classes.findMany({
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createClass(dto: CreateClassDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureClassUnique(name);

    const { translations, ...mainData } = dto;
    const minDurationYears = mainData.min_duration_years ?? 1;
    const maxDurationYears = mainData.max_duration_years ?? 1;
    this.validateClassDurationRange(minDurationYears, maxDurationYears);

    const record = await this.prisma.$transaction(async (tx) => {
      const cls = await tx.classes.create({
        data: {
          name,
          description: mainData.description ?? null,
          active: mainData.active ?? true,
          club_type_id: mainData.club_type_id!,
          minimum_age: mainData.minimum_age ?? 0,
          requires_invested_gm: mainData.requires_invested_gm ?? false,
          display_order: mainData.display_order ?? 0,
          available_from_year_id: mainData.available_from_year_id ?? null,
          available_until_year_id: mainData.available_until_year_id ?? null,
          min_duration_years: minDurationYears,
          max_duration_years: maxDurationYears,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'classes_translations',
        'class_id',
        'class_id_locale',
        cls.class_id,
        translations,
        ['name', 'description'],
      );

      return cls;
    });

    this.logMutation('create', 'classes', record.class_id, actorId);
    return record;
  }

  async updateClass(id: number, dto: UpdateClassDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const existing = await this.ensureClassExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureClassUnique(name, id);
    }

    const { translations, ...mainDto } = dto;
    const minDurationYears =
      mainDto.min_duration_years ?? existing.min_duration_years ?? 1;
    const maxDurationYears =
      mainDto.max_duration_years ?? existing.max_duration_years ?? 1;
    this.validateClassDurationRange(minDurationYears, maxDurationYears);

    const record = await this.prisma.$transaction(async (tx) => {
      const cls = await tx.classes.update({
        where: { class_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          ...(mainDto.club_type_id !== undefined
            ? { club_type_id: mainDto.club_type_id }
            : {}),
          ...(mainDto.minimum_age !== undefined
            ? { minimum_age: mainDto.minimum_age }
            : {}),
          ...(typeof mainDto.requires_invested_gm === 'boolean'
            ? { requires_invested_gm: mainDto.requires_invested_gm }
            : {}),
          ...(mainDto.display_order !== undefined
            ? { display_order: mainDto.display_order }
            : {}),
          ...(mainDto.available_from_year_id !== undefined
            ? { available_from_year_id: mainDto.available_from_year_id }
            : {}),
          ...(mainDto.available_until_year_id !== undefined
            ? { available_until_year_id: mainDto.available_until_year_id }
            : {}),
          ...(mainDto.min_duration_years !== undefined
            ? { min_duration_years: mainDto.min_duration_years }
            : {}),
          ...(mainDto.max_duration_years !== undefined
            ? { max_duration_years: mainDto.max_duration_years }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'classes_translations',
        'class_id',
        'class_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return cls;
    });

    this.logMutation('update', 'classes', id, actorId);
    return record;
  }

  async deleteClass(id: number, actorId: string) {
    await this.ensureClassExists(id);

    const record = await this.prisma.classes.update({
      where: { class_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'classes', id, actorId);
    return record;
  }

  private async ensureClassExists(id: number) {
    const entity = await this.prisma.classes.findUnique({
      where: { class_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CLASS_NOT_FOUND, { id });
    }
    return entity;
  }

  private validateClassDurationRange(
    minDurationYears: number,
    maxDurationYears: number,
  ) {
    if (maxDurationYears < minDurationYears) {
      throw new BadRequestException(
        'max_duration_years must be greater than or equal to min_duration_years',
      );
    }
  }

  private async ensureClassUnique(name: string, excludeId?: number) {
    const existing = await this.prisma.classes.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { class_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_CLASS_NAME_CONFLICT);
    }
  }

  // ==========================================================================
  // CLASS MODULES
  // Translation table: class_modules_translations
  // PK: module_id (class_modules)  |  Translation FK: module_id
  // Unique index: module_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllClassModules(classId?: number) {
    return this.prisma.class_modules.findMany({
      where: classId ? { class_id: classId } : undefined,
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ class_id: 'asc' }, { name: 'asc' }],
    });
  }

  async createClassModule(dto: CreateClassModuleDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureClassModuleUnique(name, dto.class_id);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const mod = await tx.class_modules.create({
        data: {
          name,
          description: mainData.description ?? null,
          class_id: mainData.class_id,
          active: mainData.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'class_modules_translations',
        'module_id',
        'module_id_locale',
        mod.module_id,
        translations,
        ['name', 'description'],
      );

      return mod;
    });

    this.logMutation('create', 'class_modules', record.module_id, actorId);
    return record;
  }

  async updateClassModule(
    id: number,
    dto: UpdateClassModuleDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const existing = await this.ensureClassModuleExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureClassModuleUnique(
        name,
        dto.class_id ?? existing.class_id,
        id,
      );
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const mod = await tx.class_modules.update({
        where: { module_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.class_id !== undefined
            ? { class_id: mainDto.class_id }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'class_modules_translations',
        'module_id',
        'module_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return mod;
    });

    this.logMutation('update', 'class_modules', id, actorId);
    return record;
  }

  async deleteClassModule(id: number, actorId: string) {
    await this.ensureClassModuleExists(id);

    const record = await this.prisma.class_modules.update({
      where: { module_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'class_modules', id, actorId);
    return record;
  }

  private async ensureClassModuleExists(id: number) {
    const entity = await this.prisma.class_modules.findUnique({
      where: { module_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CLASS_MODULE_NOT_FOUND, {
        id,
      });
    }
    return entity;
  }

  private async ensureClassModuleUnique(
    name: string,
    classId: number,
    excludeId?: number,
  ) {
    const existing = await this.prisma.class_modules.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        class_id: classId,
        ...(excludeId ? { NOT: { module_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_CLASS_MODULE_NAME_CONFLICT,
      );
    }
  }

  // ==========================================================================
  // CLASS SECTIONS
  // Translation table: class_sections_translations
  // PK: section_id (class_sections)  |  Translation FK: section_id
  // Unique index: section_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllClassSections(moduleId?: number) {
    return this.prisma.class_sections.findMany({
      where: moduleId ? { module_id: moduleId } : undefined,
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ module_id: 'asc' }, { name: 'asc' }],
    });
  }

  async createClassSection(dto: CreateClassSectionDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureClassSectionUnique(name, dto.module_id);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const sec = await tx.class_sections.create({
        data: {
          name,
          description: mainData.description ?? null,
          module_id: mainData.module_id,
          active: mainData.active ?? true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'class_sections_translations',
        'section_id',
        'section_id_locale',
        sec.section_id,
        translations,
        ['name', 'description'],
      );

      return sec;
    });

    this.logMutation('create', 'class_sections', record.section_id, actorId);
    return record;
  }

  async updateClassSection(
    id: number,
    dto: UpdateClassSectionDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const existing = await this.ensureClassSectionExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureClassSectionUnique(
        name,
        dto.module_id ?? existing.module_id,
        id,
      );
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const sec = await tx.class_sections.update({
        where: { section_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.module_id !== undefined
            ? { module_id: mainDto.module_id }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'class_sections_translations',
        'section_id',
        'section_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return sec;
    });

    this.logMutation('update', 'class_sections', id, actorId);
    return record;
  }

  async deleteClassSection(id: number, actorId: string) {
    await this.ensureClassSectionExists(id);

    const record = await this.prisma.class_sections.update({
      where: { section_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'class_sections', id, actorId);
    return record;
  }

  private async ensureClassSectionExists(id: number) {
    const entity = await this.prisma.class_sections.findUnique({
      where: { section_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_CLASS_SECTION_NOT_FOUND, {
        id,
      });
    }
    return entity;
  }

  private async ensureClassSectionUnique(
    name: string,
    moduleId: number,
    excludeId?: number,
  ) {
    const existing = await this.prisma.class_sections.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        module_id: moduleId,
        ...(excludeId ? { NOT: { section_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_CLASS_SECTION_NAME_CONFLICT,
      );
    }
  }

  // ==========================================================================
  // FINANCES CATEGORIES
  // Translation table: finances_categories_translations
  // PK: finance_category_id  |  Translation FK: finance_category_id
  // Unique index: finance_category_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllFinanceCategories() {
    return this.prisma.finances_categories.findMany({
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async createFinanceCategory(dto: CreateFinanceCategoryDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureFinanceCategoryUnique(name, dto.type);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const cat = await tx.finances_categories.create({
        data: {
          name,
          description: mainData.description ?? null,
          type: mainData.type,
          icon: mainData.icon ?? 0,
          active: mainData.active ?? false,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'finances_categories_translations',
        'finance_category_id',
        'finance_category_id_locale',
        cat.finance_category_id,
        translations,
        ['name', 'description'],
      );

      return cat;
    });

    this.logMutation(
      'create',
      'finances_categories',
      record.finance_category_id,
      actorId,
    );
    return record;
  }

  async updateFinanceCategory(
    id: number,
    dto: UpdateFinanceCategoryDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const existing = await this.ensureFinanceCategoryExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureFinanceCategoryUnique(
        name,
        dto.type ?? existing.type,
        id,
      );
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const cat = await tx.finances_categories.update({
        where: { finance_category_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.type !== undefined ? { type: mainDto.type } : {}),
          ...(mainDto.icon !== undefined ? { icon: mainDto.icon } : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'finances_categories_translations',
        'finance_category_id',
        'finance_category_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return cat;
    });

    this.logMutation('update', 'finances_categories', id, actorId);
    return record;
  }

  async deleteFinanceCategory(id: number, actorId: string) {
    await this.ensureFinanceCategoryExists(id);

    const record = await this.prisma.finances_categories.update({
      where: { finance_category_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'finances_categories', id, actorId);
    return record;
  }

  private async ensureFinanceCategoryExists(id: number) {
    const entity = await this.prisma.finances_categories.findUnique({
      where: { finance_category_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_FINANCE_CATEGORY_NOT_FOUND,
        { id },
      );
    }
    return entity;
  }

  private async ensureFinanceCategoryUnique(
    name: string,
    type: number,
    excludeId?: number,
  ) {
    const existing = await this.prisma.finances_categories.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        type,
        ...(excludeId ? { NOT: { finance_category_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_FINANCE_CATEGORY_NAME_CONFLICT,
      );
    }
  }

  // ==========================================================================
  // INVENTORY CATEGORIES
  // Translation table: inventory_categories_translations
  // PK: inventory_category_id  |  Translation FK: inventory_category_id
  // Unique index: inventory_category_id_locale
  // Translatable fields: name ONLY (no description in translation table)
  // ==========================================================================

  async findAllInventoryCategories() {
    return this.prisma.inventory_categories.findMany({
      include: {
        translations: {
          select: { locale: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createInventoryCategory(
    dto: CreateInventoryCategoryDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureInventoryCategoryUnique(name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const cat = await tx.inventory_categories.create({
        data: {
          name,
          icon: mainData.icon ?? 0,
          active: mainData.active ?? false,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'inventory_categories_translations',
        'inventory_category_id',
        'inventory_category_id_locale',
        cat.inventory_category_id,
        translations,
        ['name'],
      );

      return cat;
    });

    this.logMutation(
      'create',
      'inventory_categories',
      record.inventory_category_id,
      actorId,
    );
    return record;
  }

  async updateInventoryCategory(
    id: number,
    dto: UpdateInventoryCategoryDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureInventoryCategoryExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureInventoryCategoryUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const cat = await tx.inventory_categories.update({
        where: { inventory_category_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(mainDto.icon !== undefined ? { icon: mainDto.icon } : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'inventory_categories_translations',
        'inventory_category_id',
        'inventory_category_id_locale',
        id,
        translations,
        ['name'],
      );

      return cat;
    });

    this.logMutation('update', 'inventory_categories', id, actorId);
    return record;
  }

  async deleteInventoryCategory(id: number, actorId: string) {
    await this.ensureInventoryCategoryExists(id);

    const record = await this.prisma.inventory_categories.update({
      where: { inventory_category_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'inventory_categories', id, actorId);
    return record;
  }

  private async ensureInventoryCategoryExists(id: number) {
    const entity = await this.prisma.inventory_categories.findUnique({
      where: { inventory_category_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(
        ErrorCode.ADMIN_INVENTORY_CATEGORY_NOT_FOUND,
        { id },
      );
    }
    return entity;
  }

  private async ensureInventoryCategoryUnique(
    name: string,
    excludeId?: number,
  ) {
    const existing = await this.prisma.inventory_categories.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { inventory_category_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_INVENTORY_CATEGORY_NAME_CONFLICT,
      );
    }
  }

  // ==========================================================================
  // HONORS (catalog CRUD — not user_honors)
  // Translation table: honors_translations
  // PK: honor_id  |  Translation FK: honor_id
  // Unique index: honor_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllHonors() {
    return this.prisma.honors.findMany({
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createHonor(dto: CreateHonorCatalogDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureHonorUnique(name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const honor = await tx.honors.create({
        data: {
          name,
          description: mainData.description ?? null,
          honor_image: mainData.honor_image,
          honors_category_id: mainData.honors_category_id,
          club_type_id: mainData.club_type_id,
          material_url: mainData.material_url,
          active: mainData.active ?? true,
          approval: mainData.approval ?? 1,
          skill_level: mainData.skill_level ?? 1,
          master_honors_id: mainData.master_honors_id ?? null,
          year: mainData.year ?? null,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'honors_translations',
        'honor_id',
        'honor_id_locale',
        honor.honor_id,
        translations,
        ['name', 'description'],
      );

      return honor;
    });

    this.logMutation('create', 'honors', record.honor_id, actorId);
    return record;
  }

  async updateHonor(id: number, dto: UpdateHonorCatalogDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureHonorExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureHonorUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const honor = await tx.honors.update({
        where: { honor_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.honor_image ? { honor_image: mainDto.honor_image } : {}),
          ...(mainDto.honors_category_id !== undefined
            ? { honors_category_id: mainDto.honors_category_id }
            : {}),
          ...(mainDto.club_type_id !== undefined
            ? { club_type_id: mainDto.club_type_id }
            : {}),
          ...(mainDto.material_url
            ? { material_url: mainDto.material_url }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          ...(mainDto.approval !== undefined
            ? { approval: mainDto.approval }
            : {}),
          ...(mainDto.skill_level !== undefined
            ? { skill_level: mainDto.skill_level }
            : {}),
          ...(mainDto.master_honors_id !== undefined
            ? { master_honors_id: mainDto.master_honors_id }
            : {}),
          ...(mainDto.year !== undefined ? { year: mainDto.year } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'honors_translations',
        'honor_id',
        'honor_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return honor;
    });

    this.logMutation('update', 'honors', id, actorId);
    return record;
  }

  async deleteHonor(id: number, actorId: string) {
    await this.ensureHonorExists(id);

    const record = await this.prisma.honors.update({
      where: { honor_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'honors', id, actorId);
    return record;
  }

  private async ensureHonorExists(id: number) {
    const entity = await this.prisma.honors.findUnique({
      where: { honor_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_HONOR_NOT_FOUND_CATALOG, {
        id,
      });
    }
    return entity;
  }

  private async ensureHonorUnique(name: string, excludeId?: number) {
    const existing = await this.prisma.honors.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { honor_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_HONOR_NAME_CONFLICT);
    }
  }

  // ==========================================================================
  // MASTER HONORS
  // Translation table: master_honors_translations
  // PK: master_honor_id  |  Translation FK: master_honor_id
  // Unique index: master_honor_id_locale
  // Translatable fields: name ONLY (no description in translation table)
  // ==========================================================================

  async findAllMasterHonors() {
    return this.prisma.master_honors.findMany({
      include: {
        translations: {
          select: { locale: true, name: true },
        },
        master_honor_divisions: {
          where: { active: true },
          select: {
            master_honor_division_id: true,
            division_id: true,
            active: true,
          },
        },
        requirement_groups: {
          where: { active: true },
          orderBy: { display_order: 'asc' },
          include: {
            options: {
              where: { active: true },
              orderBy: { display_order: 'asc' },
              include: {
                honors: {
                  where: { active: true },
                  select: {
                    option_honor_id: true,
                    honor_id: true,
                    active: true,
                    honor: {
                      select: {
                        honor_id: true,
                        name: true,
                        honors_category_id: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createMasterHonor(dto: CreateMasterHonorDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureMasterHonorUnique(name);

    const {
      translations,
      division_ids = [],
      requirement_groups = [],
      ...mainData
    } = dto;

    this.validateMasterHonorConfig(
      mainData.applicability_scope ?? master_honor_applicability_scope_enum.ALL,
      division_ids,
      requirement_groups,
    );
    await this.validateMasterHonorReferences(
      mainData.applicability_scope ?? master_honor_applicability_scope_enum.ALL,
      division_ids,
      requirement_groups,
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const masterHonor = await tx.master_honors.create({
        data: {
          name,
          master_image: mainData.master_image ?? null,
          active: mainData.active ?? false,
          ...(mainData.applicability_scope !== undefined
            ? { applicability_scope: mainData.applicability_scope }
            : {}),
          ...(mainData.philosophy !== undefined
            ? { philosophy: mainData.philosophy }
            : {}),
          ...(mainData.notes !== undefined ? { notes: mainData.notes } : {}),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'master_honors_translations',
        'master_honor_id',
        'master_honor_id_locale',
        masterHonor.master_honor_id,
        translations,
        ['name'],
      );

      await this.syncMasterHonorDivisions(
        tx,
        masterHonor.master_honor_id,
        mainData.applicability_scope ??
          master_honor_applicability_scope_enum.ALL,
        division_ids,
      );

      await this.syncMasterHonorRequirementGroups(
        tx,
        masterHonor.master_honor_id,
        requirement_groups,
      );

      return masterHonor;
    });

    this.logMutation(
      'create',
      'master_honors',
      record.master_honor_id,
      actorId,
    );
    return record;
  }

  async updateMasterHonor(
    id: number,
    dto: UpdateMasterHonorDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const masterHonor = await this.ensureMasterHonorExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureMasterHonorUnique(name, id);
    }

    const { translations, division_ids, requirement_groups, ...mainDto } = dto;

    const applicabilityScope =
      mainDto.applicability_scope ??
      masterHonor.applicability_scope ??
      master_honor_applicability_scope_enum.ALL;
    const syncDivisions =
      dto.division_ids !== undefined || dto.applicability_scope !== undefined;
    const syncRequirementGroups = dto.requirement_groups !== undefined;

    if (syncDivisions) {
      this.validateMasterHonorConfig(
        applicabilityScope,
        division_ids ?? [],
        requirement_groups ?? [],
      );
      await this.validateMasterHonorReferences(
        applicabilityScope,
        division_ids ?? [],
        requirement_groups ?? [],
      );
    } else if (syncRequirementGroups) {
      this.validateMasterHonorConfig(
        applicabilityScope,
        [],
        requirement_groups ?? [],
        { validateDivisions: false },
      );
      await this.validateMasterHonorReferences(
        applicabilityScope,
        [],
        requirement_groups ?? [],
        { validateDivisions: false },
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const masterHonor = await tx.master_honors.update({
        where: { master_honor_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(mainDto.master_image !== undefined
            ? { master_image: mainDto.master_image }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          ...(mainDto.applicability_scope !== undefined
            ? { applicability_scope: mainDto.applicability_scope }
            : {}),
          ...(mainDto.philosophy !== undefined
            ? { philosophy: mainDto.philosophy }
            : {}),
          ...(mainDto.notes !== undefined ? { notes: mainDto.notes } : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'master_honors_translations',
        'master_honor_id',
        'master_honor_id_locale',
        id,
        translations,
        ['name'],
      );

      if (syncDivisions) {
        await this.syncMasterHonorDivisions(
          tx,
          id,
          applicabilityScope,
          division_ids,
        );
      }

      if (syncRequirementGroups) {
        await this.deleteMasterHonorRequirementStructure(tx, id);
        await this.syncMasterHonorRequirementGroups(
          tx,
          id,
          requirement_groups ?? [],
        );
      }

      return masterHonor;
    });

    this.logMutation('update', 'master_honors', id, actorId);
    return record;
  }

  async deleteMasterHonor(id: number, actorId: string) {
    await this.ensureMasterHonorExists(id);

    const record = await this.prisma.master_honors.update({
      where: { master_honor_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'master_honors', id, actorId);
    return record;
  }

  private async ensureMasterHonorExists(id: number) {
    const entity = await this.prisma.master_honors.findUnique({
      where: { master_honor_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_MASTER_HONOR_NOT_FOUND, {
        id,
      });
    }
    return entity;
  }

  private async ensureMasterHonorUnique(name: string, excludeId?: number) {
    const existing = await this.prisma.master_honors.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { master_honor_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(
        ErrorCode.ADMIN_MASTER_HONOR_NAME_CONFLICT,
      );
    }
  }

  private validateMasterHonorConfig(
    applicabilityScope:
      | master_honor_applicability_scope_enum
      | undefined
      | null,
    divisionIds: number[],
    requirementGroups: Array<{
      group_type: master_honor_requirement_group_type_enum;
      minimum_required: number;
      honors_category_id?: number | null;
      options?: Array<{ honor_ids: number[] }>;
    }>,
    options: { validateDivisions?: boolean } = {},
  ) {
    const validateDivisions = options.validateDivisions ?? true;
    if (
      validateDivisions &&
      applicabilityScope ===
        master_honor_applicability_scope_enum.SELECTED_DIVISIONS
    ) {
      if (!divisionIds.length) {
        throw new BadRequestException(
          'SELECTED_DIVISIONS requires at least one division_id',
        );
      }
    }

    for (const group of requirementGroups) {
      if (
        !Number.isInteger(group.minimum_required) ||
        group.minimum_required < 1
      ) {
        throw new BadRequestException('minimum_required must be at least 1');
      }

      if (
        group.group_type ===
        master_honor_requirement_group_type_enum.CATEGORY_COUNT
      ) {
        if (!group.honors_category_id) {
          throw new BadRequestException(
            'CATEGORY_COUNT groups require honors_category_id',
          );
        }
        if (group.options && group.options.length > 0) {
          throw new BadRequestException(
            'CATEGORY_COUNT groups must not include options',
          );
        }
      }

      if (
        group.group_type ===
        master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS
      ) {
        if (!group.options || group.options.length === 0) {
          throw new BadRequestException(
            'EXPLICIT_OPTIONS groups require at least one option',
          );
        }
        for (const option of group.options) {
          if (!option.honor_ids.length) {
            throw new BadRequestException(
              'EXPLICIT_OPTIONS option requires at least one honor_id',
            );
          }
        }
      }
    }
  }

  private async validateMasterHonorReferences(
    applicabilityScope:
      | master_honor_applicability_scope_enum
      | undefined
      | null,
    divisionIds: number[],
    requirementGroups: Array<{
      group_type: master_honor_requirement_group_type_enum;
      honors_category_id?: number | null;
      options?: Array<{ honor_ids: number[] }>;
    }>,
    options: { validateDivisions?: boolean } = {},
  ) {
    const validateDivisions = options.validateDivisions ?? true;
    if (
      validateDivisions &&
      applicabilityScope ===
        master_honor_applicability_scope_enum.SELECTED_DIVISIONS
    ) {
      await this.ensureDivisionIdsExist(divisionIds);
    }

    const honorsCategoryIds = [
      ...new Set(
        requirementGroups
          .filter(
            (group) =>
              group.group_type ===
                master_honor_requirement_group_type_enum.CATEGORY_COUNT &&
              typeof group.honors_category_id === 'number',
          )
          .map((group) => group.honors_category_id as number),
      ),
    ];
    if (honorsCategoryIds.length) {
      await this.ensureHonorsCategoriesExist(honorsCategoryIds);
    }

    const honorIds = [
      ...new Set(
        requirementGroups.flatMap((group) =>
          group.group_type ===
          master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS
            ? (group.options ?? []).flatMap((option) => option.honor_ids)
            : [],
        ),
      ),
    ];
    if (honorIds.length) {
      await this.ensureHonorsExist(honorIds);
    }
  }

  private async ensureDivisionIdsExist(divisionIds: number[]) {
    const uniqueDivisionIds = [...new Set(divisionIds)];
    if (!uniqueDivisionIds.length) {
      return;
    }
    const existing = await this.prisma.divisions.findMany({
      where: { division_id: { in: uniqueDivisionIds } },
      select: { division_id: true },
    });
    if (existing.length !== uniqueDivisionIds.length) {
      throw new BadRequestException(
        'One or more division_id values do not exist',
      );
    }
  }

  private async ensureHonorsCategoriesExist(categoryIds: number[]) {
    const uniqueCategoryIds = [...new Set(categoryIds)];
    const existing = await this.prisma.honors_categories.findMany({
      where: { honor_category_id: { in: uniqueCategoryIds } },
      select: { honor_category_id: true },
    });
    if (existing.length !== uniqueCategoryIds.length) {
      throw new BadRequestException(
        'One or more honors_category_id values do not exist',
      );
    }
  }

  private async ensureHonorsExist(honorIds: number[]) {
    const uniqueHonorIds = [...new Set(honorIds)];
    const existing = await this.prisma.honors.findMany({
      where: { honor_id: { in: uniqueHonorIds } },
      select: { honor_id: true },
    });
    if (existing.length !== uniqueHonorIds.length) {
      throw new BadRequestException('One or more honor_id values do not exist');
    }
  }

  private async syncMasterHonorDivisions(
    tx: any,
    masterHonorId: number,
    applicabilityScope:
      | master_honor_applicability_scope_enum
      | undefined
      | null,
    divisionIds?: number[],
  ) {
    await tx.master_honor_divisions.deleteMany({
      where: { master_honor_id: masterHonorId },
    });

    const normalizedScope =
      applicabilityScope ?? master_honor_applicability_scope_enum.ALL;
    if (
      normalizedScope !==
      master_honor_applicability_scope_enum.SELECTED_DIVISIONS
    ) {
      return;
    }

    const uniqueDivisionIds = [...new Set(divisionIds ?? [])];
    if (!uniqueDivisionIds.length) {
      return;
    }

    await tx.master_honor_divisions.createMany({
      data: uniqueDivisionIds.map((division_id) => ({
        master_honor_id: masterHonorId,
        division_id,
      })),
    });
  }

  private async syncMasterHonorRequirementGroups(
    tx: any,
    masterHonorId: number,
    groups: Array<{
      group_type: master_honor_requirement_group_type_enum;
      title?: string | null;
      description?: string | null;
      minimum_required: number;
      honors_category_id?: number | null;
      display_order?: number;
      active?: boolean;
      options?: Array<{
        label: string;
        display_order?: number;
        active?: boolean;
        honor_ids: number[];
      }>;
    }>,
  ) {
    for (const group of groups) {
      await tx.master_honor_requirement_groups.create({
        data: {
          master_honor_id: masterHonorId,
          group_type: group.group_type,
          title: group.title ?? null,
          description: group.description ?? null,
          minimum_required: group.minimum_required,
          honors_category_id:
            group.group_type ===
            master_honor_requirement_group_type_enum.CATEGORY_COUNT
              ? group.honors_category_id
              : null,
          display_order: group.display_order ?? 0,
          active: group.active ?? true,
          options: {
            create: (group.options ?? []).map((option) => ({
              label: option.label,
              display_order: option.display_order ?? 0,
              active: option.active ?? true,
              honors: {
                create: option.honor_ids.map((honor_id) => ({
                  honor_id,
                  active: true,
                })),
              },
            })),
          },
        },
      });
    }
  }

  private async deleteMasterHonorRequirementStructure(
    tx: any,
    masterHonorId: number,
  ) {
    await tx.master_honor_requirement_groups.deleteMany({
      where: { master_honor_id: masterHonorId },
    });
  }

  async recalculateMasterHonor(id: number, actorId: string) {
    await this.ensureMasterHonorExists(id);
    this.logMutation('recalculate', 'master_honors', id, actorId);

    if (!this.masterHonorsQueue) {
      this.logger.warn(
        `Master honor recalculation for ${id} requested, but queue is not available (REDIS_URL not configured).`,
      );
      return { queued: false };
    }

    const jobData: MasterHonorJobMasterHonorData = {
      kind: 'master-honor',
      masterHonorId: id,
    };

    try {
      await this.masterHonorsQueue.add(
        'recalculate-master-honor',
        jobData,
        MASTER_HONOR_RECALCULATION_JOB_OPTIONS,
      );

      return { queued: true };
    } catch (error: unknown) {
      this.logger.warn(
        `Master honor recalculation enqueue failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );

      return { queued: false };
    }
  }
}
