import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import {
  CreateScoringCategoryDto,
  UpdateScoringCategoryDto,
} from './dto/scoring-categories.dto';
import { origin_level_enum } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { TranslationService } from '../common/services/translation.service';

export interface CategoryWithReadonly {
  scoring_category_id: number;
  name: string;
  max_points: number;
  origin_level: origin_level_enum;
  origin_id: number;
  active: boolean;
  created_at: Date;
  modified_at: Date;
  readonly: boolean;
  origin_badge?: string;
}

@Injectable()
export class ScoringCategoriesService {
  private readonly logger = new Logger(ScoringCategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly translationService: TranslationService,
  ) {}

  // ============================================================
  // DIVISION level (origin_id = 0 represents global division)
  // ============================================================

  async findDivisionCategories(): Promise<CategoryWithReadonly[]> {
    const locale = this.translationService.getCurrentLocale();
    const categories = await this.prisma.scoring_categories.findMany({
      where: { origin_level: 'DIVISION' },
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
    const { translations, ...mainData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.create({
        data: {
          name: mainData.name,
          max_points: mainData.max_points,
          origin_level: 'DIVISION',
          origin_id: 0, // 0 = global division (no divisions table in schema)
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
      `Category created: "${dto.name}" at DIVISION level (origin_id: 0) by user ${userId ?? 'system'}`,
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

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && { max_points: mainDto.max_points }),
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
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_UNION_FORBIDDEN);
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
      throw new AppForbiddenException(ErrorCode.SCORING_CATEGORY_LOCAL_FIELD_FORBIDDEN);
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
    const locale = this.translationService.getCurrentLocale();

    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        OR: [
          { origin_level: 'DIVISION' },
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
    await this.assertUserBelongsToUnion(userId, unionId);
    const { translations, ...mainData } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.create({
        data: {
          name: mainData.name,
          max_points: mainData.max_points,
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

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && { max_points: mainDto.max_points }),
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
      `Category ${id} updated at UNION level by user ${userId}`,
    );
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
    // Resolve the parent union (and via it, division) for this local field
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { union_id: true },
    });

    if (!localField) {
      throw new AppNotFoundException(ErrorCode.SCORING_LOCAL_FIELD_NOT_FOUND);
    }

    const unionId = localField.union_id;
    await this.assertUserBelongsToLocalField(userId, fieldId);
    const locale = this.translationService.getCurrentLocale();

    const categories = await this.prisma.scoring_categories.findMany({
      where: {
        OR: [
          { origin_level: 'DIVISION' },
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

    const { translations, ...mainDto } = dto;

    const result = await this.prisma.$transaction(async (tx) => {
      const record = await tx.scoring_categories.update({
        where: { scoring_category_id: id },
        data: {
          ...(mainDto.name !== undefined && { name: mainDto.name }),
          ...(mainDto.max_points !== undefined && { max_points: mainDto.max_points }),
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
    const localField = await this.prisma.local_fields.findUnique({
      where: { local_field_id: fieldId },
      select: { union_id: true },
    });

    if (!localField) return [];

    return this.prisma.scoring_categories.findMany({
      where: {
        active: true,
        OR: [
          { origin_level: 'DIVISION' },
          { origin_level: 'UNION', origin_id: localField.union_id },
          { origin_level: 'LOCAL_FIELD', origin_id: fieldId },
        ],
      },
    });
  }
}
