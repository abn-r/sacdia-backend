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
import { Injectable, Logger } from '@nestjs/common';
import {
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../common/services/translation.service';
import {
  CreateClassDto,
  UpdateClassDto,
  CreateClassModuleDto,
  UpdateClassModuleDto,
  CreateClassSectionDto,
  UpdateClassSectionDto,
  CreateFolderDto,
  UpdateFolderDto,
  CreateFolderModuleDto,
  UpdateFolderModuleDto,
  CreateFolderSectionDto,
  UpdateFolderSectionDto,
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
    await this.ensureClassExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureClassUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

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
  // FOLDERS
  // Translation table: folders_translations
  // PK: folder_id  |  Translation FK: folder_id
  // Unique index: folder_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllFolders() {
    return this.prisma.folders.findMany({
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createFolder(dto: CreateFolderDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureFolderUnique(name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const folder = await tx.folders.create({
        data: {
          name,
          description: mainData.description ?? null,
          active: mainData.active ?? false,
          club_type: mainData.club_type ?? null,
          ecclesiastical_year_id: mainData.ecclesiastical_year_id ?? null,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_translations',
        'folder_id',
        'folder_id_locale',
        folder.folder_id,
        translations,
        ['name', 'description'],
      );

      return folder;
    });

    this.logMutation('create', 'folders', record.folder_id, actorId);
    return record;
  }

  async updateFolder(id: number, dto: UpdateFolderDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureFolderExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureFolderUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const folder = await tx.folders.update({
        where: { folder_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          ...(mainDto.club_type !== undefined
            ? { club_type: mainDto.club_type }
            : {}),
          ...(mainDto.ecclesiastical_year_id !== undefined
            ? { ecclesiastical_year_id: mainDto.ecclesiastical_year_id }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_translations',
        'folder_id',
        'folder_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return folder;
    });

    this.logMutation('update', 'folders', id, actorId);
    return record;
  }

  async deleteFolder(id: number, actorId: string) {
    await this.ensureFolderExists(id);

    const record = await this.prisma.folders.update({
      where: { folder_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'folders', id, actorId);
    return record;
  }

  private async ensureFolderExists(id: number) {
    const entity = await this.prisma.folders.findUnique({
      where: { folder_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_FOLDER_NOT_FOUND, { id });
    }
    return entity;
  }

  private async ensureFolderUnique(name: string, excludeId?: number) {
    const existing = await this.prisma.folders.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { NOT: { folder_id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new AppConflictException(ErrorCode.ADMIN_FOLDER_NAME_CONFLICT);
    }
  }

  // ==========================================================================
  // FOLDERS MODULES
  // Translation table: folders_modules_translations
  // PK: folder_module_id  |  Translation FK: folder_module_id
  // Unique index: folder_module_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllFolderModules(folderId?: number) {
    return this.prisma.folders_modules.findMany({
      where: folderId ? { folder_id: folderId } : undefined,
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ folder_id: 'asc' }, { name: 'asc' }],
    });
  }

  async createFolderModule(dto: CreateFolderModuleDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const mod = await tx.folders_modules.create({
        data: {
          name,
          description: mainData.description ?? null,
          folder_id: mainData.folder_id ?? null,
          active: mainData.active ?? true,
          max_points: mainData.max_points ?? 0,
          minimum_points: mainData.minimum_points ?? 0,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_modules_translations',
        'folder_module_id',
        'folder_module_id_locale',
        mod.folder_module_id,
        translations,
        ['name', 'description'],
      );

      return mod;
    });

    this.logMutation(
      'create',
      'folders_modules',
      record.folder_module_id,
      actorId,
    );
    return record;
  }

  async updateFolderModule(
    id: number,
    dto: UpdateFolderModuleDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureFolderModuleExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const mod = await tx.folders_modules.update({
        where: { folder_module_id: id },
        data: {
          ...(name ? { name } : {}),
          ...(typeof mainDto.description === 'string'
            ? { description: mainDto.description }
            : {}),
          ...(mainDto.folder_id !== undefined
            ? { folder_id: mainDto.folder_id }
            : {}),
          ...(typeof mainDto.active === 'boolean'
            ? { active: mainDto.active }
            : {}),
          ...(mainDto.max_points !== undefined
            ? { max_points: mainDto.max_points }
            : {}),
          ...(mainDto.minimum_points !== undefined
            ? { minimum_points: mainDto.minimum_points }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_modules_translations',
        'folder_module_id',
        'folder_module_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return mod;
    });

    this.logMutation('update', 'folders_modules', id, actorId);
    return record;
  }

  async deleteFolderModule(id: number, actorId: string) {
    await this.ensureFolderModuleExists(id);

    const record = await this.prisma.folders_modules.update({
      where: { folder_module_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'folders_modules', id, actorId);
    return record;
  }

  private async ensureFolderModuleExists(id: number) {
    const entity = await this.prisma.folders_modules.findUnique({
      where: { folder_module_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_FOLDER_MODULE_NOT_FOUND, {
        id,
      });
    }
    return entity;
  }

  // ==========================================================================
  // FOLDERS SECTIONS
  // Translation table: folders_sections_translations
  // PK: folder_section_id  |  Translation FK: folder_section_id
  // Unique index: folder_section_id_locale
  // Translatable fields: name, description
  // ==========================================================================

  async findAllFolderSections(moduleId?: number) {
    return this.prisma.folders_sections.findMany({
      where: moduleId ? { module_id: moduleId } : undefined,
      include: {
        translations: {
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ module_id: 'asc' }, { name: 'asc' }],
    });
  }

  async createFolderSection(dto: CreateFolderSectionDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const sec = await tx.folders_sections.create({
        data: {
          name,
          description: mainData.description ?? null,
          module_id: mainData.module_id ?? null,
          active: mainData.active ?? true,
          max_points: mainData.max_points ?? 0,
          minimum_points: mainData.minimum_points ?? 0,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_sections_translations',
        'folder_section_id',
        'folder_section_id_locale',
        sec.folder_section_id,
        translations,
        ['name', 'description'],
      );

      return sec;
    });

    this.logMutation(
      'create',
      'folders_sections',
      record.folder_section_id,
      actorId,
    );
    return record;
  }

  async updateFolderSection(
    id: number,
    dto: UpdateFolderSectionDto,
    actorId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.ensureFolderSectionExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;

    const { translations, ...mainDto } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const sec = await tx.folders_sections.update({
        where: { folder_section_id: id },
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
          ...(mainDto.max_points !== undefined
            ? { max_points: mainDto.max_points }
            : {}),
          ...(mainDto.minimum_points !== undefined
            ? { minimum_points: mainDto.minimum_points }
            : {}),
          modified_at: new Date(),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'folders_sections_translations',
        'folder_section_id',
        'folder_section_id_locale',
        id,
        translations,
        ['name', 'description'],
      );

      return sec;
    });

    this.logMutation('update', 'folders_sections', id, actorId);
    return record;
  }

  async deleteFolderSection(id: number, actorId: string) {
    await this.ensureFolderSectionExists(id);

    const record = await this.prisma.folders_sections.update({
      where: { folder_section_id: id },
      data: { active: false, modified_at: new Date() },
    });

    this.logMutation('delete', 'folders_sections', id, actorId);
    return record;
  }

  private async ensureFolderSectionExists(id: number) {
    const entity = await this.prisma.folders_sections.findUnique({
      where: { folder_section_id: id },
    });
    if (!entity) {
      throw new AppNotFoundException(ErrorCode.ADMIN_FOLDER_SECTION_NOT_FOUND, {
        id,
      });
    }
    return entity;
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
      },
      orderBy: { name: 'asc' },
    });
  }

  async createMasterHonor(dto: CreateMasterHonorDto, actorId: string) {
    this.translationService.validateTranslations(dto.translations);
    const name = this.normalizeName(dto.name);
    await this.ensureMasterHonorUnique(name);

    const { translations, ...mainData } = dto;

    const record = await this.prisma.$transaction(async (tx) => {
      const masterHonor = await tx.master_honors.create({
        data: {
          name,
          master_image: mainData.master_image ?? null,
          active: mainData.active ?? false,
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
    await this.ensureMasterHonorExists(id);

    const name = dto.name ? this.normalizeName(dto.name) : undefined;
    if (name) {
      await this.ensureMasterHonorUnique(name, id);
    }

    const { translations, ...mainDto } = dto;

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
}
