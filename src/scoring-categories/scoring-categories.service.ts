import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  CreateScoringCategoryDto,
  UpdateScoringCategoryDto,
} from './dto/scoring-categories.dto';
import { origin_level_enum } from '@prisma/client';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TranslationService } from '../common/services/translation.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';

export interface CategoryWithReadonly {
  scoring_category_id: number;
  name: string;
  max_points: number;
  scoring_mode: 'numeric' | 'boolean_full';
  origin_level: origin_level_enum;
  origin_id: number;
  active: boolean;
  created_at: Date;
  modified_at: Date;
  readonly: boolean;
  origin_badge?: string;
}

interface DivisionIdRow {
  division_id: number;
}

interface LocalFieldHierarchyRow {
  union_id: number;
  division_id: number;
}

@Injectable()
export class ScoringCategoriesService {
  private readonly logger = new Logger(ScoringCategoriesService.name);
  private static readonly DEFAULT_DIVISION_CODE = 'DIA';
  private static readonly CATEGORY_MAX_POINTS_CAP_CONFIG_KEY =
    'scoring.category_max_points_cap';
  private static readonly DEFAULT_CATEGORY_MAX_POINTS_CAP = 20;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly translationService: TranslationService,
    private readonly hierarchy: InstitutionalHierarchyService,
    private readonly catalogCache: CatalogCacheService,
  ) {}

  // ============================================================
  // DIVISION level (origin_id points to the real divisions.division_id)
  // ============================================================

  private async getDefaultDivisionId(): Promise<number> {
    return this.catalogCache.getOrSet(
      CATALOG_CACHE_KEYS.SCORING_DEFAULT_DIVISION,
      async () => {
        const rows = await this.prisma.$queryRaw<DivisionIdRow[]>`
          SELECT division_id
          FROM divisions
          WHERE code = ${ScoringCategoriesService.DEFAULT_DIVISION_CODE}
            AND active = TRUE
          LIMIT 1
        `;

        if (rows.length === 0) {
          throw new AppNotFoundException(ErrorCode.SCORING_DIVISION_NOT_FOUND);
        }

        return Number(rows[0].division_id);
      },
    );
  }

  private async getDivisionIdForUnion(unionId: number): Promise<number> {
    try {
      const context = await this.hierarchy.resolveCurrent({ unionId });
      return context.division_id;
    } catch {
      throw new AppNotFoundException(ErrorCode.SCORING_UNION_NOT_FOUND);
    }
  }

  private async getLocalFieldHierarchy(
    fieldId: number,
  ): Promise<LocalFieldHierarchyRow> {
    try {
      const context = await this.hierarchy.resolveCurrent({
        localFieldId: fieldId,
      });
      if (typeof context.union_id !== 'number') {
        throw new Error('Local field hierarchy missing union');
      }
      return {
        union_id: context.union_id,
        division_id: context.division_id,
      };
    } catch {
      throw new AppNotFoundException(ErrorCode.SCORING_LOCAL_FIELD_NOT_FOUND);
    }
  }

  private async getCategoryMaxPointsCap(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: {
        config_key: ScoringCategoriesService.CATEGORY_MAX_POINTS_CAP_CONFIG_KEY,
      },
      select: { config_value: true },
    });

    const rawValue = config?.config_value?.trim() ?? '';
    const parsed = Number(rawValue);

    if (!Number.isInteger(parsed) || parsed < 1) {
      this.logger.warn(
        `system_config[${ScoringCategoriesService.CATEGORY_MAX_POINTS_CAP_CONFIG_KEY}] invalid ("${config?.config_value ?? 'null'}"), using default ${ScoringCategoriesService.DEFAULT_CATEGORY_MAX_POINTS_CAP}`,
      );
      return ScoringCategoriesService.DEFAULT_CATEGORY_MAX_POINTS_CAP;
    }

    return parsed;
  }

  private async assertCategoryMaxPointsCap(maxPoints?: number): Promise<void> {
    if (maxPoints === undefined) {
      return;
    }

    const cap = await this.getCategoryMaxPointsCap();

    if (maxPoints > cap) {
      throw new AppBadRequestException(
        ErrorCode.SCORING_CATEGORY_MAX_POINTS_EXCEEDS_CAP,
        {
          cap,
          max_points: maxPoints,
        },
      );
    }
  }

  async findDivisionCategories(): Promise<CategoryWithReadonly[]> {
    const divisionId = await this.getDefaultDivisionId();
    const locale = this.translationService.getCurrentLocale();
    const categories = await this.prisma.scoring_categories.findMany({
      where: { origin_level: 'DIVISION', origin_id: divisionId },
      include: {
        translations: {
          where: { locale },
          select: { locale: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const translated = this.translationService.translateMany(
      categories,
      locale,
      ['name'],
      'translations',
    );

    return (translated as any[]).map((cat) => ({
      ...cat,
      readonly: false,
      origin_badge: 'Division',
    }));
  }

  async createDivisionCategory(dto: CreateScoringCategoryDto, userId?: string) {
    this.translationService.validateTranslations(dto.translations);
    await this.assertCategoryMaxPointsCap(dto.max_points);
    const divisionId = await this.getDefaultDivisionId();
    const { translations, ...mainData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.create({
        data: {
          name: mainData.name,
          max_points: mainData.max_points,
          scoring_mode: mainData.scoring_mode ?? 'numeric',
          origin_level: 'DIVISION',
          origin_id: divisionId,
          active: true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        record.scoring_category_id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(
      `Category created: "${dto.name}" at DIVISION level (division_id: ${divisionId}) by user ${userId ?? 'system'}`,
    );
    return result;
  }

  async updateDivisionCategory(
    id: number,
    dto: UpdateScoringCategoryDto,
    userId?: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (category.origin_level !== 'DIVISION') {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId ?? 'system'}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    await this.assertCategoryMaxPointsCap(dto.max_points);

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && {
            max_points: mainDto.max_points,
          }),
          ...(mainDto.scoring_mode !== undefined && {
            scoring_mode: mainDto.scoring_mode,
          }),
          ...(mainDto.active !== undefined && { active: mainDto.active }),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(
      `Category ${id} updated at DIVISION level by user ${userId ?? 'system'}`,
    );
    return result;
  }

  async deleteDivisionCategory(id: number, userId?: string) {
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (category.origin_level !== 'DIVISION') {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId ?? 'system'}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    const result = await this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
    this.logger.warn(
      `Category ${id} soft-deleted at DIVISION level by user ${userId ?? 'system'}`,
    );
    return result;
  }

  // ============================================================
  // Organizational scoping helpers (IDOR prevention)
  // ============================================================

  /**
   * Verifies the requesting user has an active club assignment whose club
   * belongs to a local field that is under the given union.
   * Super-admins bypass this check (god-mode via AuthorizationContextService).
   */
  private async assertUserBelongsToUnion(
    userId: string,
    unionId: number,
  ): Promise<void> {
    // Super-admin bypass — uses the canonical isSuperAdmin helper which is
    // backed by the auth-context Redis cache (5 min TTL), so the extra call
    // is cheap within a single request window.
    if (await this.authorizationContext.isSuperAdmin(userId)) {
      return;
    }

    // Check via active club_role_assignment: club → local_field → union
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: {
            local_fields: {
              union_id: unionId,
            },
          },
        },
      },
      select: { assignment_id: true },
    });

    if (!assignment) {
      throw new AppForbiddenException(
        ErrorCode.SCORING_CATEGORY_UNION_FORBIDDEN,
      );
    }
  }

  /**
   * Verifies the requesting user has an active club assignment whose club
   * belongs to the given local field.
   * Super-admins bypass this check (god-mode via AuthorizationContextService).
   */
  private async assertUserBelongsToLocalField(
    userId: string,
    fieldId: number,
  ): Promise<void> {
    // Super-admin bypass — uses the canonical isSuperAdmin helper which is
    // backed by the auth-context Redis cache (5 min TTL), so the extra call
    // is cheap within a single request window.
    if (await this.authorizationContext.isSuperAdmin(userId)) {
      return;
    }

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: userId,
        active: true,
        status: 'active',
        club_sections: {
          clubs: {
            local_field_id: fieldId,
          },
        },
      },
      select: { assignment_id: true },
    });

    if (!assignment) {
      throw new AppForbiddenException(
        ErrorCode.SCORING_CATEGORY_LOCAL_FIELD_FORBIDDEN,
      );
    }
  }

  // ============================================================
  // UNION level
  // ============================================================

  async findUnionCategories(
    unionId: number,
    userId: string,
  ): Promise<CategoryWithReadonly[]> {
    await this.assertUserBelongsToUnion(userId, unionId);
    const divisionId = await this.getDivisionIdForUnion(unionId);
    const locale = this.translationService.getCurrentLocale();

    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        OR: [
          { origin_level: 'DIVISION', origin_id: divisionId },
          { origin_level: 'UNION', origin_id: unionId },
        ],
      },
      include: {
        translations: {
          where: { locale },
          select: { locale: true, name: true },
        },
      },
      orderBy: [{ origin_level: 'asc' }, { name: 'asc' }],
    });

    const translated = this.translationService.translateMany(
      categories,
      locale,
      ['name'],
      'translations',
    );

    return (translated as any[]).map((cat) => ({
      ...cat,
      readonly: cat.origin_level !== 'UNION' || cat.origin_id !== unionId,
      origin_badge:
        cat.origin_level === 'DIVISION'
          ? 'Division'
          : cat.origin_level === 'UNION'
            ? 'Union'
            : 'Campo Local',
    }));
  }

  async createUnionCategory(
    unionId: number,
    dto: CreateScoringCategoryDto,
    userId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.assertCategoryMaxPointsCap(dto.max_points);
    await this.assertUserBelongsToUnion(userId, unionId);
    const { translations, ...mainData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.create({
        data: {
          name: mainData.name,
          max_points: mainData.max_points,
          scoring_mode: mainData.scoring_mode ?? 'numeric',
          origin_level: 'UNION',
          origin_id: unionId,
          active: true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        record.scoring_category_id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(
      `Category created: "${dto.name}" at UNION level (origin_id: ${unionId}) by user ${userId}`,
    );
    return result;
  }

  async updateUnionCategory(
    unionId: number,
    id: number,
    dto: UpdateScoringCategoryDto,
    userId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.assertUserBelongsToUnion(userId, unionId);
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (category.origin_level !== 'UNION' || category.origin_id !== unionId) {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    await this.assertCategoryMaxPointsCap(dto.max_points);

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && {
            max_points: mainDto.max_points,
          }),
          ...(mainDto.scoring_mode !== undefined && {
            scoring_mode: mainDto.scoring_mode,
          }),
          ...(mainDto.active !== undefined && { active: mainDto.active }),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(`Category ${id} updated at UNION level by user ${userId}`);
    return result;
  }

  async deleteUnionCategory(unionId: number, id: number, userId: string) {
    await this.assertUserBelongsToUnion(userId, unionId);

    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (category.origin_level !== 'UNION' || category.origin_id !== unionId) {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    const result = await this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
    this.logger.warn(
      `Category ${id} soft-deleted at UNION level by user ${userId}`,
    );
    return result;
  }

  // ============================================================
  // LOCAL FIELD level
  // ============================================================

  async findLocalFieldCategories(
    fieldId: number,
    userId: string,
  ): Promise<CategoryWithReadonly[]> {
    const { union_id: unionId, division_id: divisionId } =
      await this.getLocalFieldHierarchy(fieldId);
    await this.assertUserBelongsToLocalField(userId, fieldId);
    const locale = this.translationService.getCurrentLocale();

    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION', origin_id: divisionId },
          { origin_level: 'UNION', origin_id: unionId },
          { origin_level: 'LOCAL_FIELD', origin_id: fieldId },
        ],
      },
      include: {
        translations: {
          where: { locale },
          select: { locale: true, name: true },
        },
      },
      orderBy: [{ origin_level: 'asc' }, { name: 'asc' }],
    });

    const translated = this.translationService.translateMany(
      categories,
      locale,
      ['name'],
      'translations',
    );

    return (translated as any[]).map((cat) => {
      const isOwn =
        cat.origin_level === 'LOCAL_FIELD' && cat.origin_id === fieldId;
      let origin_badge: string;
      if (cat.origin_level === 'DIVISION') origin_badge = 'Division';
      else if (cat.origin_level === 'UNION') origin_badge = 'Union';
      else origin_badge = 'Campo Local';

      return {
        ...cat,
        readonly: !isOwn,
        origin_badge,
      };
    });
  }

  async createLocalFieldCategory(
    fieldId: number,
    dto: CreateScoringCategoryDto,
    userId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.assertCategoryMaxPointsCap(dto.max_points);
    await this.assertUserBelongsToLocalField(userId, fieldId);

    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { local_field_id: true },
    });

    if (!localField) {
      throw new AppNotFoundException(ErrorCode.SCORING_LOCAL_FIELD_NOT_FOUND);
    }

    const { translations, ...mainData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.create({
        data: {
          name: mainData.name,
          max_points: mainData.max_points,
          scoring_mode: mainData.scoring_mode ?? 'numeric',
          origin_level: 'LOCAL_FIELD',
          origin_id: fieldId,
          active: true,
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        record.scoring_category_id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(
      `Category created: "${dto.name}" at LOCAL_FIELD level (origin_id: ${fieldId}) by user ${userId}`,
    );
    return result;
  }

  async updateLocalFieldCategory(
    fieldId: number,
    id: number,
    dto: UpdateScoringCategoryDto,
    userId: string,
  ) {
    this.translationService.validateTranslations(dto.translations);
    await this.assertUserBelongsToLocalField(userId, fieldId);
    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (
      category.origin_level !== 'LOCAL_FIELD' ||
      category.origin_id !== fieldId
    ) {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    await this.assertCategoryMaxPointsCap(dto.max_points);

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && {
            max_points: mainDto.max_points,
          }),
          ...(mainDto.scoring_mode !== undefined && {
            scoring_mode: mainDto.scoring_mode,
          }),
          ...(mainDto.active !== undefined && { active: mainDto.active }),
        },
      });

      await this.translationService.upsertTranslations(
        tx,
        'scoring_categories_translations',
        'scoring_category_id',
        'scoring_category_id_locale',
        id,
        translations,
        ['name'],
      );

      return record;
    });

    this.logger.log(
      `Category ${id} updated at LOCAL_FIELD level by user ${userId}`,
    );
    return result;
  }

  async deleteLocalFieldCategory(fieldId: number, id: number, userId: string) {
    await this.assertUserBelongsToLocalField(userId, fieldId);

    const category = await this.prisma.scoring_categories.findUnique({
      where: { scoring_category_id: id },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.SCORING_CATEGORY_NOT_FOUND);
    }

    if (
      category.origin_level !== 'LOCAL_FIELD' ||
      category.origin_id !== fieldId
    ) {
      this.logger.warn(
        `Unauthorized attempt to modify category ${id} by user ${userId}`,
      );
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_WRONG_LEVEL);
    }

    const result = await this.prisma.scoring_categories.update({
      where: { scoring_category_id: id },
      data: { active: false },
    });
    this.logger.warn(
      `Category ${id} soft-deleted at LOCAL_FIELD level by user ${userId}`,
    );
    return result;
  }

  // ============================================================
  // Helpers for other modules
  // ============================================================

  /**
   * Returns the merged active scoring categories visible to a given local field.
   * Used by the weekly records service to validate category_ids.
   * Only active categories are returned (intentional — used for validation, not admin display).
   */
  async getActiveCategoriesForLocalField(fieldId: number) {
    let hierarchy: LocalFieldHierarchyRow;
    try {
      hierarchy = await this.getLocalFieldHierarchy(fieldId);
    } catch (error) {
      if (
        error instanceof AppNotFoundException &&
        error.code === ErrorCode.SCORING_LOCAL_FIELD_NOT_FOUND
      ) {
        return [];
      }
      throw error;
    }

    return this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION', origin_id: hierarchy.division_id },
          { origin_level: 'UNION', origin_id: hierarchy.union_id },
          { origin_level: 'LOCAL_FIELD', origin_id: fieldId },
        ],
      },
    });
  }
}
