import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  StartHonorDto,
  UpdateUserHonorDto,
  HonorFiltersDto,
  CreateUserHonorDto,
  BulkCreateUserHonorsDto,
  HonorCompletionModeDto,
} from './dto';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { TranslationService } from '../common/services/translation.service';
import { AchievementsService } from '../achievements/achievements.service';
import pLimit from 'p-limit';
import { randomUUID } from 'crypto';
import { MasterHonorsEvaluatorService } from './master-honors-evaluator.service';
import { InstructorsService } from '../instructors/instructors.service';
import {
  instructorUserSelect,
  instructorUserSelectNoPhoto,
  sameInstructor,
  toInstructorView,
  instructorKind,
} from '../instructors/instructor-view';
import {
  buildHonorSearchQuery,
  buildHonorSearchTokens,
  pickHonorSearchMatches,
} from './honor-search-tokens';
import { isCertificateImportObjectKey } from '../certificate-bulk-imports/certificate-import-file-ref';
import { loadLatestProposalViews } from './honor-instructor-proposal-view';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
  HONORS_CACHE_NAMESPACE,
} from '../catalogs/catalog-cache.service';
import { GuardianNotificationsService } from '../guardianships/guardian-notifications.service';

// Cap concurrent presign calls for USERS_HONORS bucket images. A single honor
// detail request resolves certificate + document + N image URLs. Without the
// cap, a bulk getUserHonors response (up to 500 honors × N images each) would
// fire thousands of simultaneous HMAC presigns. Cap is 20, matching the pattern
// used by PROFILE_URL_LIMITER in camporees.service.ts.
export const HONOR_DETAIL_URL_LIMITER = pLimit(20);
const HONOR_MUTATION_BLOCKED_STATUSES = ['PENDING_REVIEW', 'APPROVED'] as const;
// Instructor (M1) con el que se arma el bloque `instructor` de las respuestas.
// Una sola fila trae la foto para firmarla; los listados no (hasta 500 filas).
const USER_HONOR_INSTRUCTOR_INCLUDE = {
  instructor: { select: instructorUserSelect },
} satisfies Prisma.users_honorsInclude;
const SINGLE_ROW = { instructorPhoto: true } as const;
const USER_HONOR_INSTRUCTOR_LIST_INCLUDE = {
  instructor: { select: instructorUserSelectNoPhoto },
} satisfies Prisma.users_honorsInclude;
const INITIAL_HONOR_COMPLETION_MODE = HonorCompletionModeDto.UNDECIDED;
const ADVENTURERS_CLUB_TYPE_ID = 1;
const PATHFINDERS_CLUB_TYPE_ID = 2;
const MASTER_GUIDES_CLUB_TYPE_ID = 3;

type InstructorColumns = {
  instructor_user_id: string | null;
  instructor_name: string | null;
};

/** Instructor y fecha de finalización que un DTO del flujo normal puede escribir. */
type InstructorCompletionInput = {
  instructorUserId?: string | null;
  instructorName?: string | null;
  completedAt?: string | null;
};

type InstructorCompletionData = Partial<InstructorColumns> & {
  completed_at?: Date | null;
};

type UploadedObjectRef = {
  bucketAlias: StorageBucketAlias;
  key: string;
};

@Injectable()
export class HonorsService {
  private readonly logger = new Logger(HonorsService.name);
  private static readonly PRIVATE_ASSET_URL_TTL_SECONDS = 300;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly achievementsService: AchievementsService,
    private readonly translationService: TranslationService,
    private readonly masterHonorsEvaluator: MasterHonorsEvaluatorService,
    private readonly catalogCache: CatalogCacheService,
    private readonly instructors: InstructorsService,
    private readonly guardianNotifications: GuardianNotificationsService,
  ) {}

  // ========================================
  // CATÁLOGO DE HONORES
  // ========================================

  private buildHonorCatalogWhere(
    filters?: HonorFiltersDto,
  ): Prisma.honorsWhereInput {
    return {
      active: true,
      ...(filters?.categoryId && { honors_category_id: filters.categoryId }),
      ...(filters?.clubTypeId && {
        honor_club_types: {
          some: {
            club_type_id: filters.clubTypeId,
            active: true,
          },
        },
      }),
      ...(filters?.skillLevel && { skill_level: filters.skillLevel }),
    };
  }

  /**
   * Ids de honores activos que coinciden con la búsqueda, ya ordenados por
   * cantidad de tokens coincidentes. Busca en el nombre y en las traducciones sin
   * distinguir tildes ni mayúsculas (sin `unaccent`: ver honor-search-tokens).
   * Primero los que coinciden con todos los tokens; si no hay, con cualquiera.
   * Sin cache: el filtro por `ILIKE %q%` no aprovecha el índice de `honors.name`.
   */
  private async searchHonorMatches(
    search: string,
  ): Promise<Array<{ honorId: number; score: number }>> {
    const tokens = buildHonorSearchTokens(search);
    if (tokens.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ honor_id: number; score: number }>
    >(buildHonorSearchQuery(tokens));
    return pickHonorSearchMatches(rows, tokens.length);
  }

  private honorListInclude(locale: string) {
    return {
      honors_categories: { select: { name: true, icon: true } },
      club_types: { select: { name: true } },
      honor_club_types: {
        where: { active: true },
        select: {
          club_type_id: true,
          club_type: { select: { name: true } },
        },
      },
      translations: {
        where: { locale },
        select: { locale: true, name: true, description: true },
      },
    } satisfies Prisma.honorsInclude;
  }

  /**
   * Página del catálogo con búsqueda: los filtros (categoría, tipo de club, nivel)
   * se aplican sobre los ids que coinciden; el orden es por tokens coincidentes y
   * luego por nombre.
   */
  private async findAllBySearch(
    baseWhere: Prisma.honorsWhereInput,
    search: string,
    locale: string,
    skip: number,
    take: number,
  ) {
    const matches = await this.searchHonorMatches(search);
    if (matches.length === 0) return { data: [], total: 0 };

    const score = new Map(matches.map((m) => [m.honorId, m.score]));
    const candidates = await this.prisma.honors.findMany({
      where: { ...baseWhere, honor_id: { in: [...score.keys()] } },
      select: { honor_id: true, name: true },
    });
    const ranked = candidates.sort(
      (a, b) =>
        (score.get(b.honor_id) ?? 0) - (score.get(a.honor_id) ?? 0) ||
        a.name.localeCompare(b.name, 'es'),
    );
    const pageIds = ranked.slice(skip, skip + take).map((h) => h.honor_id);
    if (pageIds.length === 0) return { data: [], total: ranked.length };

    const rows = await this.prisma.honors.findMany({
      where: { honor_id: { in: pageIds } },
      include: this.honorListInclude(locale),
    });
    const byId = new Map(rows.map((row) => [row.honor_id, row]));
    return {
      data: pageIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
      total: ranked.length,
    };
  }

  async findAll(
    filters?: HonorFiltersDto,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const locale = this.translationService.getCurrentLocale();
    const skip = pagination?.skip ?? 0;
    const take = pagination?.take ?? 50;

    // Search pages stay uncached (unbounded key space); plain catalog pages
    // share the honors epoch with the grouped view and categories.
    if (filters?.search) {
      return this.loadHonorsPage(locale, skip, take, filters, pagination);
    }

    const epoch = await this.catalogCache.getEpoch(HONORS_CACHE_NAMESPACE);
    const key = CATALOG_CACHE_KEYS.HONORS_LIST({
      epoch,
      locale,
      categoryId: filters?.categoryId,
      clubTypeId: filters?.clubTypeId,
      skillLevel: filters?.skillLevel,
      skip,
      take,
    });
    return this.catalogCache.getOrSet(key, () =>
      this.loadHonorsPage(locale, skip, take, filters, pagination),
    );
  }

  private async loadHonorsPage(
    locale: string,
    skip: number,
    take: number,
    filters?: HonorFiltersDto,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    const where = this.buildHonorCatalogWhere(filters);

    const { data, total } = filters?.search
      ? await this.findAllBySearch(where, filters.search, locale, skip, take)
      : await Promise.all([
          this.prisma.honors.findMany({
            where,
            include: this.honorListInclude(locale),
            orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
            skip,
            take,
          }),
          this.prisma.honors.count({ where }),
        ]).then(([rows, count]) => ({ data: rows, total: count }));

    const translated = this.translationService.translateMany(
      data,
      locale,
      ['name', 'description'],
      'translations',
    );

    return createPaginatedResult(
      translated,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async getGroupedByCategory(filters?: HonorFiltersDto) {
    const locale = this.translationService.getCurrentLocale();
    const epoch = await this.catalogCache.getEpoch(HONORS_CACHE_NAMESPACE);
    const key = CATALOG_CACHE_KEYS.HONORS_GROUPED({
      epoch,
      locale,
      categoryId: filters?.categoryId,
      clubTypeId: filters?.clubTypeId,
      skillLevel: filters?.skillLevel,
    });
    return this.catalogCache.getOrSet(key, () =>
      this.loadGroupedByCategory(locale, filters),
    );
  }

  private async loadGroupedByCategory(
    locale: string,
    filters?: HonorFiltersDto,
  ) {
    const where = this.buildHonorCatalogWhere(filters);

    // Safety cap: the honors catalog is expected to stay in the low thousands.
    // A take of 2000 prevents a full-table scan if the catalog grows unexpectedly.
    const honors = await this.prisma.honors.findMany({
      where,
      select: {
        honor_id: true,
        name: true,
        description: true,
        honor_image: true,
        skill_level: true,
        material_url: true,
        club_type_id: true,
        honors_category_id: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
        honors_categories: {
          select: {
            honor_category_id: true,
            name: true,
            description: true,
            icon: true,
          },
        },
        club_types: { select: { name: true } },
        honor_club_types: {
          where: { active: true },
          select: {
            club_type_id: true,
            club_type: { select: { name: true } },
          },
        },
      },
      orderBy: [{ honors_category_id: 'asc' }, { name: 'asc' }],
      take: 2000,
    });

    const grouped = new Map<
      string,
      {
        category: {
          honor_category_id: number | null;
          name: string;
          description: string | null;
          icon: number | null;
        };
        honors: Array<{
          honor_id: number;
          name: string;
          description: string | null;
          honor_image: string | null;
          skill_level: number | null;
          material_url: string | null;
          club_type_id: number | null;
          club_type_name: string | null;
          applicable_club_types: Array<{
            club_type_id: number;
            name: string;
          }>;
        }>;
      }
    >();

    // Apply translations to honors before grouping
    const translatedHonors = this.translationService.translateMany(
      honors,
      locale,
      ['name', 'description'],
      'translations',
    );

    for (const honor of translatedHonors as any[]) {
      const category = honor.honors_categories;
      const key = category?.honor_category_id
        ? String(category.honor_category_id)
        : 'uncategorized';

      if (!grouped.has(key)) {
        grouped.set(key, {
          category: category
            ? {
                honor_category_id: category.honor_category_id,
                name: category.name,
                description: category.description,
                icon: category.icon,
              }
            : {
                honor_category_id: null,
                name: 'Sin categoría',
                description: null,
                icon: null,
              },
          honors: [],
        });
      }

      grouped.get(key)!.honors.push({
        honor_id: honor.honor_id,
        name: honor.name,
        description: honor.description,
        honor_image: honor.honor_image,
        skill_level: honor.skill_level,
        material_url: honor.material_url,
        club_type_id: honor.club_type_id,
        club_type_name: honor.club_types?.name ?? null,
        applicable_club_types: (honor.honor_club_types ?? []).map(
          (applicability: any) => ({
            club_type_id: applicability.club_type_id,
            name: applicability.club_type?.name ?? '',
          }),
        ),
      });
    }

    return Array.from(grouped.values());
  }

  async findOne(honorId: number) {
    const locale = this.translationService.getCurrentLocale();
    const honor = await this.prisma.honors.findUnique({
      where: { honor_id: honorId, active: true },
      include: {
        honors_categories: true,
        club_types: { select: { name: true } },
        master_honors: {
          select: {
            name: true,
            translations: {
              where: { locale },
              select: { locale: true, name: true },
            },
          },
        },
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
      },
    });

    if (!honor) {
      throw new AppNotFoundException(ErrorCode.HONOR_NOT_FOUND);
    }

    // Translate honor
    const translatedHonor = this.translationService.translateMany(
      [honor],
      locale,
      ['name', 'description'],
      'translations',
    )[0];

    // Translate master_honor name if present
    if (translatedHonor.master_honors) {
      const masterTranslated = this.translationService.translateMany(
        [translatedHonor.master_honors],
        locale,
        ['name'],
        'translations',
      )[0];
      (translatedHonor as any).master_honors = masterTranslated;
    }

    return translatedHonor;
  }

  async getCategories() {
    const locale = this.translationService.getCurrentLocale();
    const epoch = await this.catalogCache.getEpoch(HONORS_CACHE_NAMESPACE);
    const key = CATALOG_CACHE_KEYS.HONORS_CATEGORIES(epoch, locale);
    return this.catalogCache.getOrSet(key, () => this.loadCategories(locale));
  }

  private async loadCategories(locale: string) {
    // Small catalog table: expected to remain under ~100 rows.
    // No pagination needed; a safety cap is applied as a precaution.
    //
    // Approach X i18n: Spanish (es) lives in main table columns.
    // For non-es locales, JOIN honors_categories_translations and overlay fields.
    // If no translation row exists for the requested locale, fall back to Spanish.
    const records = await this.prisma.honors_categories.findMany({
      where: { active: true },
      select: {
        honor_category_id: true,
        name: true,
        description: true,
        icon: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 200,
    });

    return this.translationService.translateMany(
      records,
      locale,
      ['name', 'description'],
      'translations',
    );
  }

  // ========================================
  // HONORES DE USUARIO
  // ========================================

  async getUserHonors(userId: string, validated?: boolean) {
    // A single user is not expected to have more than a few hundred honors.
    // The cap of 500 prevents unbounded growth from becoming a problem.
    const honors = await this.prisma.users_honors.findMany({
      where: {
        user_id: userId,
        active: true,
        ...(validated !== undefined && { validate: validated }),
      },
      include: {
        ...USER_HONOR_INSTRUCTOR_LIST_INCLUDE,
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            club_type_id: true,
            skill_level: true,
            club_types: { select: { name: true } },
            honors_categories: {
              select: { honor_category_id: true, name: true, icon: true },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    });

    // D11: solo una especialidad APPROVED puede tener propuesta; una consulta para todas.
    const proposals = await loadLatestProposalViews(
      this.prisma,
      honors
        .filter((userHonor) => userHonor.validation_status === 'APPROVED')
        .map((userHonor) => userHonor.user_honor_id),
    );

    return Promise.all(
      honors.map(async (userHonor) => ({
        ...(await HONOR_DETAIL_URL_LIMITER(() =>
          this.mapUserHonorPrivateUrls(userHonor),
        )),
        instructor_proposal: proposals.get(userHonor.user_honor_id) ?? null,
      })),
    );
  }

  private async assertHonorMatchesActiveClubSection(
    userId: string,
    honor: { honor_id: number; club_type_id: number },
  ) {
    await this.assertHonorsMatchActiveClubSection(userId, [honor]);
  }

  private async assertHonorsMatchActiveClubSection(
    userId: string,
    honors: Array<{ honor_id: number; club_type_id: number }>,
  ) {
    const activeClubTypeId = await this.resolveUserActiveClubTypeId(userId);
    if (activeClubTypeId == null) {
      throw new AppBadRequestException(ErrorCode.HONOR_ACTIVE_SECTION_REQUIRED);
    }

    const allowedClubTypeIds =
      this.getHonorClubTypeIdsForActiveSection(activeClubTypeId);
    const blockedHonorIds = honors
      .filter((honor) => !allowedClubTypeIds.includes(honor.club_type_id))
      .map((honor) => honor.honor_id);

    if (blockedHonorIds.length > 0) {
      throw new AppBadRequestException(ErrorCode.HONOR_CLUB_TYPE_NOT_ALLOWED, {
        ids: blockedHonorIds.join(', '),
        active_club_type_id: activeClubTypeId,
        allowed_club_type_ids: allowedClubTypeIds.join(', '),
      });
    }
  }

  private getHonorClubTypeIdsForActiveSection(activeClubTypeId: number) {
    if (activeClubTypeId === ADVENTURERS_CLUB_TYPE_ID) {
      return [ADVENTURERS_CLUB_TYPE_ID];
    }

    if (
      activeClubTypeId === PATHFINDERS_CLUB_TYPE_ID ||
      activeClubTypeId === MASTER_GUIDES_CLUB_TYPE_ID
    ) {
      return [PATHFINDERS_CLUB_TYPE_ID, MASTER_GUIDES_CLUB_TYPE_ID];
    }

    return [activeClubTypeId];
  }

  private async resolveUserActiveClubTypeId(userId: string) {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
      select: { active_club_assignment_id: true },
    });

    const activeClubTypeSelect = {
      club_sections: {
        select: { club_type_id: true },
      },
    } satisfies Prisma.club_role_assignmentsSelect;

    const explicitAssignment = userPr?.active_club_assignment_id
      ? await this.prisma.club_role_assignments.findFirst({
          where: {
            assignment_id: userPr.active_club_assignment_id,
            user_id: userId,
            active: true,
            status: 'active',
          },
          select: activeClubTypeSelect,
        })
      : null;

    const assignment =
      explicitAssignment ??
      (await this.prisma.club_role_assignments.findFirst({
        where: { user_id: userId, active: true, status: 'active' },
        orderBy: { start_date: 'desc' },
        select: activeClubTypeSelect,
      }));

    return assignment?.club_sections?.club_type_id ?? null;
  }

  async startHonor(userId: string, honorId: number, dto?: StartHonorDto) {
    // Verificar que el honor existe y está activo
    const honor = await this.findOne(honorId);
    await this.assertHonorMatchesActiveClubSection(userId, honor);

    // Buscar si existe un registro previo (activo o inactivo)
    const existing = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
      },
    });

    // Si ya está activo, rechazar
    if (existing && existing.active) {
      throw new AppConflictException(ErrorCode.HONOR_USER_ALREADY_IN_PROGRESS);
    }

    // Si existe pero está inactivo, reactivar; si no, crear nuevo
    if (existing) {
      // Filas APPROVED / PENDING_REVIEW abandonadas antes del guard en
      // abandonHonor: solo se restaura `active`, sin resetear validación,
      // archivos ni fechas.
      const isBlockedStatus = HONOR_MUTATION_BLOCKED_STATUSES.includes(
        existing.validation_status as (typeof HONOR_MUTATION_BLOCKED_STATUSES)[number],
      );
      const reactivationData: Prisma.users_honorsUncheckedUpdateInput =
        isBlockedStatus
          ? { active: true, modified_at: new Date() }
          : {
              active: true,
              date: dto?.date ? new Date(dto.date) : new Date(),
              validate: false,
              validation_status: 'IN_PROGRESS',
              completion_mode: INITIAL_HONOR_COMPLETION_MODE,
              certificate: '',
              images: [],
              document: null,
              submitted_at: null,
              validated_by_id: null,
              validated_at: null,
              rejection_reason: null,
              // El reinicio vacía también lo declarado: instructor y finalización.
              instructor_user_id: null,
              instructor_name: null,
              completed_at: null,
              modified_at: new Date(),
            };

      const updated = await this.prisma.users_honors.update({
        where: { user_honor_id: existing.user_honor_id },
        data: reactivationData,
        include: {
          ...USER_HONOR_INSTRUCTOR_INCLUDE,
          honors: {
            select: {
              name: true,
              honor_image: true,
              club_type_id: true,
              skill_level: true,
              club_types: { select: { name: true } },
              honors_categories: {
                select: { honor_category_id: true, name: true },
              },
            },
          },
        },
      });

      await this.evaluateMasterHonors(userId);

      try {
        await this.achievementsService.emitEvent({
          userId,
          eventType: 'honor.started',
          payload: {
            honor_id: honor.honor_id,
            category_id: honor.honors_category_id,
            honor_name: honor.name,
            club_type_id: honor.club_type_id,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to emit achievement event: ${(error as Error).message}`,
        );
      }

      return this.mapUserHonorPrivateUrls(updated, SINGLE_ROW);
    }

    // Crear nuevo registro
    const created = await this.prisma.users_honors.create({
      data: {
        user_id: userId,
        honor_id: honorId,
        date: dto?.date ? new Date(dto.date) : new Date(),
        validate: false,
        validation_status: 'IN_PROGRESS',
        completion_mode: INITIAL_HONOR_COMPLETION_MODE,
        certificate: '',
        images: [],
        active: true,
      },
      include: {
        ...USER_HONOR_INSTRUCTOR_INCLUDE,
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            club_type_id: true,
            skill_level: true,
            club_types: { select: { name: true } },
            honors_categories: {
              select: { honor_category_id: true, name: true },
            },
          },
        },
      },
    });

    try {
      await this.achievementsService.emitEvent({
        userId,
        eventType: 'honor.started',
        payload: {
          honor_id: honor.honor_id,
          category_id: honor.honors_category_id,
          honor_name: honor.name,
          club_type_id: honor.club_type_id,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to emit achievement event: ${(error as Error).message}`,
      );
    }

    return this.mapUserHonorPrivateUrls(created, SINGLE_ROW);
  }

  private async evaluateMasterHonors(userId: string) {
    try {
      await this.masterHonorsEvaluator.evaluateUser(userId);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to evaluate master honors for user ${userId} after start honor: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async createUserHonor(userId: string, dto: CreateUserHonorDto) {
    const honor = await this.findOne(dto.honorId);
    await this.assertHonorMatchesActiveClubSection(userId, honor);

    const existing = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: dto.honorId,
      },
      select: {
        user_honor_id: true,
        validation_status: true,
        instructor_user_id: true,
        instructor_name: true,
      },
    });

    if (existing) {
      this.assertHonorIsMutable(existing.validation_status);
      const instructorData = await this.buildInstructorCompletionData(
        userId,
        existing,
        dto,
      );

      const updated = await this.prisma.users_honors.update({
        where: { user_honor_id: existing.user_honor_id },
        data: {
          ...this.buildUpdateDataFromCreateDto(dto),
          ...instructorData,
        },
        include: {
          ...USER_HONOR_INSTRUCTOR_INCLUDE,
          honors: {
            select: {
              honor_id: true,
              name: true,
              honor_image: true,
              club_type_id: true,
              skill_level: true,
              club_types: { select: { name: true } },
              honors_categories: {
                select: { honor_category_id: true, name: true },
              },
            },
          },
        },
      });

      return this.mapUserHonorPrivateUrls(updated, SINGLE_ROW);
    }

    const instructorData = await this.buildInstructorCompletionData(
      userId,
      null,
      dto,
    );
    const created = await this.prisma.users_honors.create({
      data: {
        user_id: userId,
        honor_id: dto.honorId,
        ...this.buildCreateDataFromCreateDto(dto),
        ...instructorData,
      },
      include: {
        ...USER_HONOR_INSTRUCTOR_INCLUDE,
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            club_type_id: true,
            skill_level: true,
            club_types: { select: { name: true } },
            honors_categories: {
              select: { honor_category_id: true, name: true },
            },
          },
        },
      },
    });

    return this.mapUserHonorPrivateUrls(created, SINGLE_ROW);
  }

  async createUserHonorsBulk(userId: string, dto: BulkCreateUserHonorsDto) {
    const honorIds = dto.honors.map((item) => item.honorId);

    const seen = new Set<number>();
    const duplicated = new Set<number>();
    for (const honorId of honorIds) {
      if (seen.has(honorId)) duplicated.add(honorId);
      seen.add(honorId);
    }

    if (duplicated.size > 0) {
      throw new AppBadRequestException(ErrorCode.HONOR_BULK_DUPLICATE_IDS, {
        ids: Array.from(duplicated).join(', '),
      });
    }

    const activeHonors = await this.prisma.honors.findMany({
      where: {
        honor_id: { in: honorIds },
        active: true,
      },
      select: { honor_id: true, club_type_id: true },
    });

    const activeHonorIds = new Set(activeHonors.map((item) => item.honor_id));
    const missingHonorIds = honorIds.filter(
      (honorId) => !activeHonorIds.has(honorId),
    );
    if (missingHonorIds.length > 0) {
      throw new AppNotFoundException(ErrorCode.HONOR_BULK_NOT_FOUND, {
        ids: missingHonorIds.join(', '),
      });
    }

    await this.assertHonorsMatchActiveClubSection(userId, activeHonors);

    const existingUserHonors = await this.prisma.users_honors.findMany({
      where: {
        user_id: userId,
        honor_id: { in: honorIds },
      },
      select: {
        user_honor_id: true,
        honor_id: true,
        validation_status: true,
        instructor_user_id: true,
        instructor_name: true,
      },
    });

    // Validate every existing row before writing anything, so a blocked row
    // (PENDING_REVIEW / APPROVED) fails the whole bulk without partial writes.
    for (const item of existingUserHonors) {
      this.assertHonorIsMutable(item.validation_status);
    }

    const existingByHonorId = new Map(
      existingUserHonors.map((item) => [item.honor_id, item]),
    );

    // Instructor y finalización se validan para todo el lote antes de escribir.
    const instructorData = await Promise.all(
      dto.honors.map((item) =>
        this.buildInstructorCompletionData(
          userId,
          existingByHonorId.get(item.honorId) ?? null,
          item,
        ),
      ),
    );

    const operations = dto.honors.map((item, index) => {
      const existingId = existingByHonorId.get(item.honorId)?.user_honor_id;
      if (existingId) {
        return this.prisma.users_honors.update({
          where: { user_honor_id: existingId },
          data: {
            ...this.buildUpdateDataFromCreateDto(item),
            ...instructorData[index],
          },
          include: {
            ...USER_HONOR_INSTRUCTOR_LIST_INCLUDE,
            honors: {
              select: {
                honor_id: true,
                name: true,
                honor_image: true,
                club_type_id: true,
                skill_level: true,
                club_types: { select: { name: true } },
                honors_categories: {
                  select: { honor_category_id: true, name: true },
                },
              },
            },
          },
        });
      }

      return this.prisma.users_honors.create({
        data: {
          user_id: userId,
          honor_id: item.honorId,
          ...this.buildCreateDataFromCreateDto(item),
          ...instructorData[index],
        },
        include: {
          ...USER_HONOR_INSTRUCTOR_LIST_INCLUDE,
          honors: {
            select: {
              honor_id: true,
              name: true,
              honor_image: true,
              club_type_id: true,
              skill_level: true,
              club_types: { select: { name: true } },
              honors_categories: {
                select: { honor_category_id: true, name: true },
              },
            },
          },
        },
      });
    });

    const createdOrUpdated = await Promise.all(operations);
    return Promise.all(
      createdOrUpdated.map((userHonor) =>
        HONOR_DETAIL_URL_LIMITER(() => this.mapUserHonorPrivateUrls(userHonor)),
      ),
    );
  }

  async uploadUserHonorFiles(
    userId: string,
    honorId: number,
    files: {
      certificate?: Express.Multer.File[];
      document?: Express.Multer.File[];
      images?: Express.Multer.File[];
    },
  ) {
    const certificateFile = files.certificate?.[0];
    const documentFile = files.document?.[0];
    const imageFiles = files.images ?? [];

    if (!certificateFile && !documentFile && imageFiles.length === 0) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_REQUIRED);
    }

    // Hard cap: reject requests that exceed the maximum number of images per
    // upload. The controller enforces maxCount: 10 via Multer, but this guard
    // defends against direct service calls (tests, CLI, future callers) that
    // bypass the HTTP layer. Keeps the presign fan-out bounded at 10 URLs max.
    if (imageFiles.length > 10) {
      throw new AppBadRequestException(ErrorCode.HONOR_EVIDENCE_MAX_REACHED);
    }

    await this.findOne(honorId);

    if (certificateFile) {
      this.validateCertificateFile(certificateFile);
    }
    if (documentFile) {
      this.validateDocumentFile(documentFile);
    }
    for (const imageFile of imageFiles) {
      this.validateImageFile(imageFile);
    }

    const existingUserHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
      },
      select: {
        user_honor_id: true,
        date: true,
        validate: true,
        certificate: true,
        images: true,
        document: true,
        validation_status: true,
      },
    });

    this.assertHonorIsMutable(existingUserHonor?.validation_status);

    const currentImages = this.extractImageUrls(existingUserHonor?.images);
    if (currentImages.length + imageFiles.length > 10) {
      throw new AppBadRequestException(ErrorCode.HONOR_EVIDENCE_MAX_REACHED);
    }

    let nextCertificateUrl = existingUserHonor?.certificate || '';
    let nextDocumentUrl =
      typeof existingUserHonor?.document === 'string'
        ? existingUserHonor.document
        : null;
    const previousCertificateUrl = existingUserHonor?.certificate || '';
    const previousDocumentUrl =
      typeof existingUserHonor?.document === 'string'
        ? existingUserHonor.document
        : null;
    const uploadedImageUrls: string[] = [];
    const uploadedObjects: UploadedObjectRef[] = [];

    try {
      if (certificateFile) {
        const certificateExtension = this.getFileExtension(certificateFile);
        const certificateName = `cert-${userId}-${honorId}-${Date.now()}.${certificateExtension}`;
        const uploadedCertificate = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS_CERT,
          certificateName,
          certificateFile.buffer,
          {
            contentType: certificateFile.mimetype,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS_CERT,
          key: uploadedCertificate.key,
        });
        nextCertificateUrl = uploadedCertificate.url;
      }

      if (documentFile) {
        const documentExtension = this.getFileExtension(documentFile);
        const documentName = `doc-${userId}-${honorId}-${Date.now()}.${documentExtension}`;
        const uploadedDocument = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS,
          documentName,
          documentFile.buffer,
          {
            contentType: documentFile.mimetype,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS,
          key: uploadedDocument.key,
        });
        nextDocumentUrl = uploadedDocument.url;
      }

      let imageIndex = currentImages.length + 1;
      for (const imageFile of imageFiles) {
        const extension = this.getFileExtension(imageFile);
        const imageName = `img-${userId}-${honorId}-${Date.now()}-${randomUUID()}-img${imageIndex}.${extension}`;
        const uploadedImage = await this.fileStorage.upload(
          StorageBucketAlias.USERS_HONORS,
          imageName,
          imageFile.buffer,
          {
            contentType: imageFile.mimetype,
            overwrite: false,
          },
        );
        uploadedObjects.push({
          bucketAlias: StorageBucketAlias.USERS_HONORS,
          key: uploadedImage.key,
        });
        uploadedImageUrls.push(uploadedImage.url);
        imageIndex += 1;
      }
    } catch (error) {
      this.logger.error(
        `Failed to upload honor evidence files for user=${userId} honor=${honorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.rollbackUploadedObjects(uploadedObjects);
      throw new AppInternalServerErrorException(
        ErrorCode.HONOR_FILE_UPLOAD_FAILED,
      );
    }

    const finalImages = [...currentImages, ...uploadedImageUrls];

    let updated: any;
    try {
      updated = await this.prisma.$transaction((tx) =>
        tx.users_honors.upsert({
          where: {
            user_id_honor_id: {
              user_id: userId,
              honor_id: honorId,
            },
          },
          update: {
            active: true,
            modified_at: new Date(),
            ...(certificateFile ? { certificate: nextCertificateUrl } : {}),
            ...(documentFile ? { document: nextDocumentUrl } : {}),
            ...(uploadedImageUrls.length > 0 ? { images: finalImages } : {}),
          },
          create: {
            user_id: userId,
            honor_id: honorId,
            date: existingUserHonor?.date ?? new Date(),
            validate: existingUserHonor?.validate ?? false,
            certificate: certificateFile
              ? nextCertificateUrl
              : previousCertificateUrl,
            images: finalImages,
            document: documentFile
              ? nextDocumentUrl
              : (existingUserHonor?.document ?? null),
            active: true,
          },
          include: {
            ...USER_HONOR_INSTRUCTOR_INCLUDE,
            honors: {
              select: {
                honor_id: true,
                name: true,
                honor_image: true,
                club_type_id: true,
                skill_level: true,
                club_types: { select: { name: true } },
                honors_categories: {
                  select: { honor_category_id: true, name: true },
                },
              },
            },
          },
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist honor evidence files for user=${userId} honor=${honorId}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.rollbackUploadedObjects(uploadedObjects);
      throw new AppInternalServerErrorException(
        ErrorCode.HONOR_FILE_UPLOAD_FAILED,
      );
    }

    if (
      certificateFile &&
      previousCertificateUrl &&
      previousCertificateUrl !== nextCertificateUrl
    ) {
      await this.cleanupPreviousCertificate(previousCertificateUrl);
    }
    if (
      documentFile &&
      previousDocumentUrl &&
      previousDocumentUrl !== nextDocumentUrl
    ) {
      await this.cleanupPreviousDocument(previousDocumentUrl);
    }

    // After the files committed; never throws and stays silent for a guardian
    // acting for the child.
    void this.guardianNotifications.onDependentEvidenceUploaded({
      dependentUserId: userId,
      kind: 'honor',
    });

    return {
      status: 'success',
      data: {
        user_honor: await this.mapUserHonorPrivateUrls(updated, SINGLE_ROW),
        uploaded: {
          certificate:
            certificateFile && nextCertificateUrl
              ? await this.resolvePrivateAssetUrl(
                  StorageBucketAlias.USERS_HONORS_CERT,
                  nextCertificateUrl,
                )
              : null,
          document:
            documentFile && nextDocumentUrl
              ? await this.resolvePrivateAssetUrl(
                  StorageBucketAlias.USERS_HONORS,
                  nextDocumentUrl,
                )
              : null,
          images: await Promise.all(
            uploadedImageUrls.map((url) =>
              HONOR_DETAIL_URL_LIMITER(() =>
                this.resolvePrivateAssetUrl(
                  StorageBucketAlias.USERS_HONORS,
                  url,
                ),
              ),
            ),
          ),
        },
      },
      message: 'Archivos del honor subidos exitosamente',
    };
  }

  async updateUserHonor(
    userId: string,
    honorId: number,
    dto: UpdateUserHonorDto,
  ) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
        active: true,
      },
    });

    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.HONOR_USER_HONOR_NOT_FOUND);
    }

    this.assertHonorIsMutable(userHonor.validation_status);

    const updateData: any = {
      modified_at: new Date(),
    };

    // Permitir actualizar validación
    if (dto.validate !== undefined) updateData.validate = dto.validate;

    // Permitir limpiar certificado (null o string vacío)
    if (dto.certificate !== undefined) {
      updateData.certificate = dto.certificate || '';
    }

    // Permitir limpiar imágenes (null o array vacío)
    if (dto.images !== undefined) {
      updateData.images = (dto.images || []) as Prisma.InputJsonValue;
    }

    // Permitir limpiar documento (null)
    if (dto.document !== undefined) {
      updateData.document = dto.document || null;
    }

    // Permitir seleccionar o limpiar el modo de trabajo mientras el honor sea mutable
    if (dto.completionMode !== undefined) {
      updateData.completion_mode = dto.completionMode;
    }

    // Actualizar fecha de inicio
    if (dto.date) updateData.date = new Date(dto.date);

    // Instructor (D10) y fecha de finalización: solo con la fila mutable (guard de arriba).
    const instructorData = await this.buildInstructorCompletionData(
      userId,
      userHonor,
      dto,
    );
    Object.assign(updateData, instructorData);
    const nextInstructor = {
      instructor_user_id:
        instructorData.instructor_user_id !== undefined
          ? instructorData.instructor_user_id
          : userHonor.instructor_user_id,
      instructor_name:
        instructorData.instructor_name !== undefined
          ? instructorData.instructor_name
          : userHonor.instructor_name,
    };

    const args = {
      where: { user_honor_id: userHonor.user_honor_id },
      data: updateData,
      include: {
        ...USER_HONOR_INSTRUCTOR_INCLUDE,
        honors: {
          select: {
            honor_id: true,
            name: true,
            honor_image: true,
            club_type_id: true,
            skill_level: true,
            club_types: { select: { name: true } },
            honors_categories: {
              select: { honor_category_id: true, name: true },
            },
          },
        },
      },
    } satisfies Prisma.users_honorsUpdateArgs;

    // Auditoría: solo cambia el tipo/identidad, nunca se copia el nombre libre.
    const updated = sameInstructor(userHonor, nextInstructor)
      ? await this.prisma.users_honors.update(args)
      : await this.prisma.$transaction(async (tx) => {
          const row = await tx.users_honors.update(args);
          await tx.validation_logs.create({
            data: {
              entity_type: 'honor',
              entity_id: String(userHonor.user_honor_id),
              user_id: userId,
              action: 'instructor_set',
              performed_by: userId,
              comment: `Instructor de la especialidad: ${instructorKind(nextInstructor)}`,
            },
          });
          return row;
        });

    return this.mapUserHonorPrivateUrls(updated, SINGLE_ROW);
  }

  async abandonHonor(userId: string, honorId: number) {
    const userHonor = await this.prisma.users_honors.findFirst({
      where: {
        user_id: userId,
        honor_id: honorId,
        active: true,
      },
    });

    if (!userHonor) {
      throw new AppNotFoundException(ErrorCode.HONOR_USER_HONOR_NOT_FOUND);
    }

    // No se puede abandonar un honor en revisión o aprobado
    this.assertHonorIsMutable(userHonor.validation_status);

    return this.prisma.users_honors.update({
      where: { user_honor_id: userHonor.user_honor_id },
      data: {
        active: false,
        modified_at: new Date(),
      },
    });
  }

  // ========================================
  // ESTADÍSTICAS
  // ========================================

  async getUserHonorStats(userId: string) {
    const where = { user_id: userId, active: true };

    const [total, approved, pendingReview, rejected, inProgress] =
      await Promise.all([
        this.prisma.users_honors.count({ where }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'APPROVED' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'PENDING_REVIEW' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'REJECTED' },
        }),
        this.prisma.users_honors.count({
          where: { ...where, validation_status: 'IN_PROGRESS' },
        }),
      ]);

    return {
      total,
      validated: approved, // backward compat
      in_progress: inProgress,
      pending_review: pendingReview,
      rejected,
      approved,
    };
  }

  private buildCreateDataFromCreateDto(dto: CreateUserHonorDto) {
    return {
      active: true,
      date: dto.date ? new Date(dto.date) : new Date(),
      validate: dto.validate ?? false,
      completion_mode: INITIAL_HONOR_COMPLETION_MODE,
      certificate: dto.certificate || '',
      images: (dto.images || []) as Prisma.InputJsonValue,
      document: dto.document || null,
    };
  }

  /**
   * D1/D10. Instructor y fecha de finalización que escribe el flujo normal.
   * `undefined` = no cambia, `null` = borra, valor = asigna (y un usuario limpia
   * el nombre libre y al revés). La elegibilidad se evalúa contra el DUEÑO de la
   * especialidad (`ownerUserId`), no contra quien llama, y solo si el usuario
   * elegido es distinto del actual. El rango de `completedAt` ya lo validó el DTO.
   */
  private async buildInstructorCompletionData(
    ownerUserId: string,
    current: InstructorColumns | null,
    input: InstructorCompletionInput,
  ): Promise<InstructorCompletionData> {
    const givenUser = typeof input.instructorUserId === 'string';
    const givenName = typeof input.instructorName === 'string';
    if (givenUser && givenName) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_AMBIGUOUS);
    }
    if (givenUser && input.instructorUserId !== current?.instructor_user_id) {
      await this.instructors.assertEligible(
        ownerUserId,
        input.instructorUserId as string,
      );
    }

    const data: InstructorCompletionData = {};
    if (input.instructorUserId !== undefined) {
      data.instructor_user_id = input.instructorUserId;
      if (givenUser) data.instructor_name = null;
    }
    if (input.instructorName !== undefined) {
      data.instructor_name = input.instructorName;
      if (givenName) data.instructor_user_id = null;
    }
    if (input.completedAt !== undefined) {
      data.completed_at =
        input.completedAt === null ? null : new Date(input.completedAt);
    }
    return data;
  }

  private assertHonorIsMutable(validationStatus?: string | null) {
    if (
      validationStatus &&
      HONOR_MUTATION_BLOCKED_STATUSES.includes(
        validationStatus as (typeof HONOR_MUTATION_BLOCKED_STATUSES)[number],
      )
    ) {
      throw new AppBadRequestException(
        ErrorCode.VALIDATION_HONOR_INVALID_STATUS,
        {
          status: validationStatus,
        },
      );
    }
  }

  private buildUpdateDataFromCreateDto(dto: CreateUserHonorDto) {
    const data: Prisma.users_honorsUncheckedUpdateInput = {
      active: true,
      completion_mode: INITIAL_HONOR_COMPLETION_MODE,
      modified_at: new Date(),
    };

    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.validate !== undefined) data.validate = dto.validate;
    if (dto.certificate !== undefined) data.certificate = dto.certificate || '';
    if (dto.images !== undefined) data.images = dto.images || [];
    if (dto.document !== undefined) data.document = dto.document || null;

    return data;
  }

  private extractImageUrls(
    images: Prisma.JsonValue | null | undefined,
  ): string[] {
    if (!Array.isArray(images)) return [];
    return images.filter((value): value is string => typeof value === 'string');
  }

  private getFileExtension(file: Express.Multer.File): string {
    const mimeToExtension: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    if (mimeToExtension[file.mimetype]) {
      return mimeToExtension[file.mimetype];
    }

    const originalExtension = file.originalname.split('.').pop()?.toLowerCase();
    if (originalExtension) return originalExtension;
    return 'bin';
  }

  private validateCertificateFile(file: Express.Multer.File) {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_INVALID_FORMAT, {
        allowed: 'PDF, JPG, PNG, WEBP',
      });
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_TOO_LARGE, {
        max_mb: '10',
      });
    }
  }

  private validateImageFile(file: Express.Multer.File) {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_INVALID_FORMAT, {
        allowed: 'JPG, PNG, WEBP',
      });
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_TOO_LARGE, {
        max_mb: '10',
      });
    }
  }

  private validateDocumentFile(file: Express.Multer.File) {
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_INVALID_FORMAT, {
        allowed: 'PDF, DOC, DOCX, JPG, PNG, WEBP',
      });
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_TOO_LARGE, {
        max_mb: '10',
      });
    }
  }

  private async rollbackUploadedObjects(uploadedObjects: UploadedObjectRef[]) {
    if (uploadedObjects.length === 0) return;

    const keysByBucket = uploadedObjects.reduce<
      Map<StorageBucketAlias, string[]>
    >((acc, uploadedObject) => {
      const existing = acc.get(uploadedObject.bucketAlias) ?? [];
      existing.push(uploadedObject.key);
      acc.set(uploadedObject.bucketAlias, existing);
      return acc;
    }, new Map<StorageBucketAlias, string[]>());

    for (const [bucketAlias, keys] of keysByBucket.entries()) {
      try {
        await this.fileStorage.deleteMany(bucketAlias, keys);
      } catch (error) {
        this.logger.error(
          `Critical: failed to rollback uploaded honors objects in ${bucketAlias}. Manual remediation required.`,
          error,
        );
      }
    }
  }

  private async cleanupPreviousCertificate(previousCertificateUrl: string) {
    const previousKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USERS_HONORS_CERT,
      previousCertificateUrl,
    );

    if (!previousKey) return;

    try {
      await this.fileStorage.deleteMany(StorageBucketAlias.USERS_HONORS_CERT, [
        previousKey,
      ]);
    } catch (error) {
      this.logger.warn(
        `Best-effort cleanup failed for previous certificate: ${previousKey}`,
        error,
      );
    }
  }

  private async cleanupPreviousDocument(previousDocumentUrl: string) {
    const previousKey = this.fileStorage.extractKeyFromPublicUrl(
      StorageBucketAlias.USERS_HONORS,
      previousDocumentUrl,
    );

    if (!previousKey) return;

    try {
      await this.fileStorage.deleteMany(StorageBucketAlias.USERS_HONORS, [
        previousKey,
      ]);
    } catch (error) {
      this.logger.warn(
        `Best-effort cleanup failed for previous document: ${previousKey}`,
        error,
      );
    }
  }

  private async mapUserHonorPrivateUrls<T extends Record<string, any>>(
    userHonor: T,
    options: { instructorPhoto?: boolean } = {},
  ): Promise<T> {
    if (!userHonor) return userHonor;

    const hasCertificate = Object.prototype.hasOwnProperty.call(
      userHonor,
      'certificate',
    );
    const hasDocument = Object.prototype.hasOwnProperty.call(
      userHonor,
      'document',
    );
    const hasImages = Object.prototype.hasOwnProperty.call(userHonor, 'images');

    const [certificate, document] = await Promise.all([
      hasCertificate
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.USERS_HONORS_CERT,
            typeof userHonor.certificate === 'string'
              ? userHonor.certificate
              : null,
          )
        : Promise.resolve(null),
      hasDocument
        ? this.resolvePrivateAssetUrl(
            StorageBucketAlias.USERS_HONORS,
            typeof userHonor.document === 'string' ? userHonor.document : null,
          )
        : Promise.resolve(null),
    ]);

    let images: unknown = userHonor.images;
    if (hasImages && Array.isArray(userHonor.images)) {
      // Filas aprobadas antes de que `images` dejara de recibir PDFs: un PDF de
      // una carga por certificado no se muestra como miniatura (sigue en
      // `certificate`).
      const urls = userHonor.images.filter(
        (value: unknown): value is string =>
          typeof value === 'string' &&
          !(isCertificateImportObjectKey(value) && /\.pdf$/i.test(value)),
      );
      images = await Promise.all(
        urls.map((url) =>
          HONOR_DETAIL_URL_LIMITER(() =>
            this.resolvePrivateAssetUrl(StorageBucketAlias.USERS_HONORS, url),
          ),
        ),
      );
    }

    const mapped: Record<string, unknown> = { ...userHonor };
    if (hasCertificate) mapped.certificate = certificate ?? '';
    if (hasDocument) mapped.document = document ?? null;
    if (hasImages) mapped.images = images;

    // Bloque `instructor` (sin email). Solo si la fila trae la relación cargada,
    // para no inventar "Usuario eliminado" donde solo hay una columna cruda. La
    // foto se firma únicamente en respuestas de una sola fila.
    if (
      'instructor_user_id' in userHonor &&
      (userHonor.instructor_user_id == null || userHonor.instructor)
    ) {
      const photoUrls =
        options.instructorPhoto && userHonor.instructor
          ? await this.instructors.photoUrlsFor([userHonor.instructor])
          : undefined;
      mapped.instructor = toInstructorView(userHonor, photoUrls);
    }

    return mapped as T;
  }

  private async resolvePrivateAssetUrl(
    bucketAlias: StorageBucketAlias,
    value: string | null | undefined,
  ): Promise<string | null> {
    if (!value) return null;

    // Al aprobar una carga por certificado se copia la referencia del archivo del
    // lote, que vive en CERTIFICATE_IMPORTS: firmarla con el bucket de honores
    // daría una URL a un objeto que no existe.
    const bucket = isCertificateImportObjectKey(value)
      ? StorageBucketAlias.CERTIFICATE_IMPORTS
      : bucketAlias;

    try {
      return await this.fileStorage.getSignedDownloadUrl(bucket, value, {
        expiresInSeconds: HonorsService.PRIVATE_ASSET_URL_TTL_SECONDS,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to generate signed URL for ${bucket}. Returning original value.`,
        error,
      );
      return value;
    }
  }
}
