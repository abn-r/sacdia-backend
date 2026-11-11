import { Inject, Injectable, Logger } from '@nestjs/common';
import 'multer';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLikeWildcards } from '../common/utils/escape-like';
import {
  CreateFinanceDto,
  UpdateFinanceDto,
  FinanceFiltersDto,
  GetAllTransactionsDto,
} from './dto';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import {
  FinancePeriodService,
  closedPeriodKey,
} from './finance-period.service';
import {
  FinanceAggregationService,
  type FinanceRange,
} from './finance-aggregation.service';
import { TranslationService } from '../common/services/translation.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
  FINANCE_CACHE_NAMESPACE,
} from '../catalogs/catalog-cache.service';
import { decodeMultipartFileName } from '../common/utils/multipart-file-name';

type FinanceSectionFilter =
  { club_section_id: { in: number[] } } | { club_section_id: number };

type FinanceEvidenceRow = {
  finance_evidence_file_id: number;
  finance_id: number;
  file_url: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  uploaded_by_id: string;
  uploaded_at: Date;
  active: boolean;
};

type FinanceEvidenceResponse = {
  evidence_id: number;
  finance_id: number;
  url: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  uploaded_by_id: string;
  uploaded_at: Date;
  active: boolean;
};

@Injectable()
export class FinancesService {
  private readonly logger = new Logger(FinancesService.name);
  private static readonly MAX_EVIDENCE_FILES = 3;
  private static readonly EVIDENCE_URL_TTL_SECONDS = 15 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly financePeriodService: FinancePeriodService,
    private readonly aggregation: FinanceAggregationService,
    private readonly translationService: TranslationService,
    private readonly catalogCache: CatalogCacheService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  // ========================================
  // CATEGORÍAS
  // ========================================

  async getCategories(type?: number) {
    const locale = this.translationService.getCurrentLocale();
    const epoch = await this.catalogCache.getEpoch(FINANCE_CACHE_NAMESPACE);
    const key = CATALOG_CACHE_KEYS.FINANCE_CATEGORIES({
      epoch,
      locale,
      type,
    });
    return this.catalogCache.getOrSet(key, () =>
      this.loadCategories(locale, type),
    );
  }

  private async loadCategories(locale: string, type?: number) {
    const records = await this.prisma.finances_categories.findMany({
      where: {
        active: true,
        ...(type !== undefined && { type }),
      },
      select: {
        finance_category_id: true,
        name: true,
        description: true,
        icon: true,
        type: true, // 0=ingreso, 1=egreso
        translations: {
          where: { locale },
          select: { locale: true, name: true, description: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    return this.translationService.translateMany(
      records,
      locale,
      ['name', 'description'],
      'translations',
    );
  }

  private async assertUsableFinanceCategory(categoryId: number) {
    const category = await this.prisma.finances_categories.findUnique({
      where: { finance_category_id: categoryId },
      select: {
        finance_category_id: true,
        active: true,
        type: true,
      },
    });

    if (!category) {
      throw new AppNotFoundException(ErrorCode.FINANCE_CATEGORY_NOT_FOUND, {
        categoryId,
      });
    }

    if (!category.active) {
      throw new AppBadRequestException(ErrorCode.FINANCE_CATEGORY_INACTIVE, {
        categoryId,
      });
    }

    if (category.type !== 0 && category.type !== 1) {
      throw new AppBadRequestException(
        ErrorCode.FINANCE_CATEGORY_TYPE_INVALID,
        { categoryId },
      );
    }
  }

  // ========================================
  // FINANZAS POR CLUB
  // ========================================

  async findByClub(
    clubId: number,
    filters?: FinanceFiltersDto,
    pagination?: PaginationDto,
    /**
     * When provided, results are scoped to finance records belonging to this
     * specific section (mirrors the check in PermissionsGuard.validateInstanceScope).
     * Pass `null` to skip section filtering (admin / club-manager bypass).
     */
    userSectionId?: number | null,
  ): Promise<PaginatedResult<any>> {
    // Build section filter.
    // - Admin bypass (userSectionId === null): show all sections of the club,
    //   optionally narrowed by clubTypeId filter — preserves original broad behaviour.
    //   Filtered through the section relation so the club's section ids need
    //   no separate round trip first.
    // - Regular member (userSectionId is a number): strict filter to their section only.
    // - `clubSectionId` filter: one exact section. A section-scoped member may
    //   only ask for their own (403 otherwise); for everyone else the section
    //   must belong to the club, so another club's section returns nothing.
    const requestedSectionId = filters?.clubSectionId ?? null;
    if (
      userSectionId != null &&
      requestedSectionId != null &&
      requestedSectionId !== userSectionId
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    const sectionFilter: Prisma.financesWhereInput =
      userSectionId != null
        ? { club_section_id: userSectionId }
        : requestedSectionId != null
          ? {
              club_section_id: requestedSectionId,
              club_sections: { main_club_id: clubId },
            }
          : { club_sections: { main_club_id: clubId } };

    const where: Prisma.financesWhereInput = {
      active: true,
      ...sectionFilter,
      ...(filters?.year && { year: filters.year }),
      ...(filters?.month && { month: filters.month }),
      ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
      ...(filters?.categoryId && { finance_category_id: filters.categoryId }),
    };

    // The club existence check runs alongside the page queries; on a 404
    // their rows are discarded.
    const [club, data, total] = await Promise.all([
      this.prisma.clubs.findUnique({
        where: { club_id: clubId },
        select: { club_id: true },
      }),
      this.prisma.finances.findMany({
        where,
        include: {
          finances_categories: { select: { name: true, type: true } },
          club_types: { select: { name: true } },
          users: {
            select: { name: true, paternal_last_name: true, user_image: true },
          },
        },
        orderBy: [{ finance_date: 'desc' }, { created_at: 'desc' }],
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.finances.count({ where }),
    ]);

    if (!club) {
      throw new AppNotFoundException(ErrorCode.FINANCE_CLUB_NOT_FOUND);
    }

    const evidencesByFinanceId = await this.getEvidenceMap(
      data.map((record) => record.finance_id),
    );
    const dataWithEvidences = await this.withPeriodClosed(
      clubId,
      data.map((record) => ({
        ...record,
        evidences: evidencesByFinanceId.get(record.finance_id) ?? [],
      })),
    );

    return createPaginatedResult(
      dataWithEvidences,
      total,
      pagination ?? new PaginationDto(),
    );
  }

  async getAllTransactions(
    clubId: number,
    dto: GetAllTransactionsDto,
    /**
     * When provided, results are scoped to finance records belonging to this
     * specific section (mirrors the check in PermissionsGuard.validateInstanceScope).
     * Pass `null` to skip section filtering (admin / club-manager bypass).
     */
    userSectionId?: number | null,
  ): Promise<PaginatedResult<any>> {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_sections: { select: { club_section_id: true } },
      },
    });

    if (!club) {
      throw new AppNotFoundException(ErrorCode.FINANCE_CLUB_NOT_FOUND);
    }

    // Build section filter.
    // - Admin bypass (userSectionId === null): show all sections of the club,
    //   preserving original broad behaviour.
    // - Regular member (userSectionId is a number): strict filter to their section only.
    let sectionFilter: FinanceSectionFilter;

    if (userSectionId == null) {
      const sectionIds = club.club_sections.map((s) => s.club_section_id);
      sectionFilter = {
        club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] },
      };
    } else {
      sectionFilter = { club_section_id: userSectionId };
    }

    // Type filter: finances_categories.type 0=ingreso, 1=egreso
    const typeFilter =
      dto.type === 'income'
        ? { finances_categories: { type: 0 } }
        : dto.type === 'expense'
          ? { finances_categories: { type: 1 } }
          : {};

    // Search filter: description OR category name (case-insensitive)
    const searchFilter = dto.search
      ? {
          OR: [
            {
              description: {
                contains: escapeLikeWildcards(dto.search),
                mode: 'insensitive' as const,
              },
            },
            {
              finances_categories: {
                name: {
                  contains: escapeLikeWildcards(dto.search),
                  mode: 'insensitive' as const,
                },
              },
            },
          ],
        }
      : {};

    // Date range filter: endDate is inclusive so extend to end of day
    const dateFilter = {
      ...(dto.startDate && {
        finance_date: { gte: new Date(dto.startDate) },
      }),
      ...(dto.endDate && {
        finance_date: { lte: new Date(`${dto.endDate}T23:59:59.999Z`) },
      }),
    };

    // Merge date filters: both startDate and endDate present requires an AND
    const dateRangeFilter =
      dto.startDate && dto.endDate
        ? {
            finance_date: {
              gte: new Date(dto.startDate),
              lte: new Date(`${dto.endDate}T23:59:59.999Z`),
            },
          }
        : dateFilter;

    const where = {
      active: true,
      ...sectionFilter,
      ...typeFilter,
      ...searchFilter,
      ...dateRangeFilter,
    };

    // Resolve orderBy based on sortBy field
    const sortDir = dto.sortOrder ?? 'desc';
    const orderBy =
      dto.sortBy === 'amount'
        ? [{ amount: sortDir }]
        : dto.sortBy === 'category'
          ? [{ finances_categories: { name: sortDir } }]
          : [{ finance_date: sortDir }];

    const [data, total] = await Promise.all([
      this.prisma.finances.findMany({
        where,
        include: {
          finances_categories: {
            select: {
              finance_category_id: true,
              name: true,
              icon: true,
              type: true,
            },
          },
          club_types: { select: { name: true } },
          users: {
            select: { name: true, paternal_last_name: true, user_image: true },
          },
          modified_by: {
            select: { name: true, paternal_last_name: true },
          },
        },
        orderBy,
        skip: dto.skip,
        take: dto.take,
      }),
      this.prisma.finances.count({ where }),
    ]);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const totalPages = Math.ceil(total / limit);
    const evidencesByFinanceId = await this.getEvidenceMap(
      data.map((record) => record.finance_id),
    );

    const closedKeys = await this.financePeriodService.getClosedPeriodKeys(
      clubId,
      data.map((r) => ({ year: r.year, month: r.month })),
    );

    // Map to response shape defined in spec
    const mapped = data.map((record) => ({
      id: record.finance_id,
      type: record.finances_categories.type === 0 ? 'income' : 'expense',
      amount: record.amount,
      description: record.description ?? null,
      notes: record.post_closing_note ?? null,
      date: record.finance_date,
      year: record.year,
      month: record.month,
      period_closed: closedKeys.has(closedPeriodKey(record.year, record.month)),
      category: {
        id: record.finances_categories.finance_category_id,
        name: record.finances_categories.name,
        iconIndex: record.finances_categories.icon ?? 0,
        typeCode: record.finances_categories.type,
      },
      registeredByName: record.users
        ? `${record.users.name} ${record.users.paternal_last_name}`.trim()
        : null,
      registeredAt: record.created_at ?? null,
      modifiedByName: record.modified_by
        ? `${record.modified_by.name} ${record.modified_by.paternal_last_name}`.trim()
        : null,
      modifiedAt: record.modified_at ?? null,
      evidences: evidencesByFinanceId.get(record.finance_id) ?? [],
    }));

    return {
      data: mapped,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Financial summary of a club (or one section).
   *
   * - `total_income` / `total_expense` / `net` / `movement_count`: the requested
   *   period only (year+month = that month, year = that calendar year, none =
   *   everything).
   * - `balance`: cash on hand = all-time cumulative net up to the end of the
   *   period. It does NOT reset with the ecclesiastical year.
   * - `year_income` / `year_expenses`: ecclesiastical-year-to-date through the
   *   requested month (what `total_*` used to mean when year+month were sent).
   *   Without year+month they equal the period totals.
   * - `period_closed`: whether the requested month is closed (null without
   *   year+month).
   *
   * Everything is computed live from active movements (see
   * FinanceAggregationService); closing snapshots are never read.
   */
  async getSummary(
    clubId: number,
    year?: number,
    month?: number,
    /**
     * When provided, results are scoped to finance records belonging to this
     * specific section (mirrors the check in PermissionsGuard.validateInstanceScope).
     * Pass `null` to skip section filtering (admin / club-manager bypass).
     */
    userSectionId?: number | null,
    /** Optional narrowing to one section of the club (admin view). */
    requestedSectionId?: number | null,
  ) {
    const scope = await this.aggregation.resolveClubScope(
      clubId,
      requestedSectionId,
      userSectionId,
    );

    const range = this.buildSummaryRange(year, month);
    const totals = await this.aggregation.aggregate(scope.sectionIds, range);

    let yearIncome = totals.income;
    let yearExpenses = totals.expenses;
    let periodClosed: boolean | null = null;

    if (year && month) {
      const ytd = await this.getEcclesiasticalYearToDate(
        scope.sectionIds,
        year,
        month,
      );
      yearIncome = ytd.income;
      yearExpenses = ytd.expenses;
      const closed = await this.financePeriodService.getClosedPeriodKeys(
        clubId,
        [{ year, month }],
      );
      periodClosed = closed.has(closedPeriodKey(year, month));
    }

    return {
      club_id: clubId,
      period: year
        ? `${year}${month ? `-${String(month).padStart(2, '0')}` : ''}`
        : 'all',
      total_income: totals.income,
      total_expense: totals.expenses,
      net: totals.net,
      balance: totals.balance,
      movement_count: totals.movements,
      year_income: yearIncome,
      year_expenses: yearExpenses,
      period_closed: periodClosed,
    };
  }

  private buildSummaryRange(year?: number, month?: number): FinanceRange {
    if (year && month) {
      return { from: { year, month }, to: { year, month } };
    }
    if (year) {
      return { from: { year, month: 1 }, to: { year, month: 12 } };
    }
    return {};
  }

  /** Income and expenses from the start of the ecclesiastical year through [year]/[month]. */
  private async getEcclesiasticalYearToDate(
    sectionIds: number[],
    year: number,
    month: number,
  ) {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const ecclesiasticalYear = await this.prisma.ecclesiastical_years.findFirst(
      {
        where: {
          start_date: { lte: monthStart },
          end_date: { gte: monthStart },
        },
        select: { start_date: true },
        orderBy: { start_date: 'desc' },
      },
    );

    const from = ecclesiasticalYear
      ? {
          year: ecclesiasticalYear.start_date.getUTCFullYear(),
          month: ecclesiasticalYear.start_date.getUTCMonth() + 1,
        }
      : { year, month: 1 };

    return this.aggregation.aggregate(sectionIds, {
      from,
      to: { year, month },
    });
  }

  /** Marks each movement with `period_closed` using one closings query. */
  private async withPeriodClosed<T extends { year: number; month: number }>(
    clubId: number,
    rows: T[],
  ): Promise<Array<T & { period_closed: boolean }>> {
    const closed = await this.financePeriodService.getClosedPeriodKeys(
      clubId,
      rows.map((r) => ({ year: r.year, month: r.month })),
    );
    return rows.map((r) => ({
      ...r,
      period_closed: closed.has(closedPeriodKey(r.year, r.month)),
    }));
  }

  /**
   * Club that owns a movement, through its section. Null for legacy movements
   * without a section (their club cannot be known).
   */
  private async resolveMovementClubId(
    clubSectionId: number | null,
  ): Promise<number | null> {
    if (clubSectionId == null) return null;
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: { main_club_id: true },
    });
    return section?.main_club_id ?? null;
  }

  /**
   * Closed-month guard for an existing movement. Unknown club (legacy movement
   * without section, or a section without club) is treated as closed: admin
   * only and note required.
   */
  private async guardExistingMovement(
    existing: { club_section_id: number | null; year: number; month: number },
    userId: string | undefined,
    note: string | null | undefined,
  ): Promise<{ closed: boolean; note: string | null }> {
    if (!userId) return { closed: false, note: null };
    const clubId = await this.resolveMovementClubId(existing.club_section_id);
    if (clubId == null) {
      return this.financePeriodService.validateUnscopedMovement(userId, note);
    }
    return this.financePeriodService.validatePeriodOpen(
      clubId,
      existing.year,
      existing.month,
      userId,
      note,
    );
  }

  async uploadEvidence(
    financeId: number,
    performedBy: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer) {
      throw new AppBadRequestException(
        ErrorCode.FINANCE_EVIDENCE_FILE_REQUIRED,
      );
    }

    const finance = await this.prisma.finances.findUnique({
      where: { finance_id: financeId },
      select: { finance_id: true },
    });

    if (!finance) {
      throw new AppNotFoundException(ErrorCode.FINANCE_TRANSACTION_NOT_FOUND);
    }

    const evidenceClient = this.financeEvidenceClient();
    const activeCount = await evidenceClient.count({
      where: { finance_id: financeId, active: true },
    });

    if (activeCount >= FinancesService.MAX_EVIDENCE_FILES) {
      throw new AppBadRequestException(
        ErrorCode.FINANCE_EVIDENCE_LIMIT_EXCEEDED,
      );
    }

    const extension = this.resolveFileExtension(file);
    const objectKey = `finances/${financeId}/evidence-${Date.now()}.${extension}`;
    const uploaded = await this.fileStorage.upload(
      StorageBucketAlias.EVIDENCE_FILES,
      objectKey,
      file.buffer,
      { contentType: file.mimetype },
    );

    try {
      const created = await evidenceClient.create({
        data: {
          finance_id: financeId,
          file_url: uploaded.url,
          file_name: decodeMultipartFileName(file.originalname) || objectKey,
          file_type: file.mimetype,
          file_size: file.size,
          uploaded_by_id: performedBy,
          active: true,
        },
      });

      return this.mapEvidenceRow(created);
    } catch (error) {
      await this.fileStorage
        .deleteMany(StorageBucketAlias.EVIDENCE_FILES, [uploaded.key])
        .catch((deleteError) =>
          this.logger.warn(
            'Failed to cleanup finance evidence after DB error',
            deleteError,
          ),
        );
      this.logger.error('Finance evidence DB create failed', error);
      throw new AppInternalServerErrorException(ErrorCode.R2_UPLOAD_FAILED);
    }
  }

  private financeEvidenceClient() {
    return (
      this.prisma as unknown as {
        finance_evidence_files: {
          count(args: unknown): Promise<number>;
          create(args: unknown): Promise<FinanceEvidenceRow>;
          findMany(args: unknown): Promise<FinanceEvidenceRow[]>;
        };
      }
    ).finance_evidence_files;
  }

  private async getEvidenceMap(financeIds: number[]) {
    const map = new Map<number, FinanceEvidenceResponse[]>();
    const uniqueIds = [...new Set(financeIds)].filter((id) => id > 0);
    if (uniqueIds.length === 0) return map;

    const rows = await this.financeEvidenceClient().findMany({
      where: {
        finance_id: { in: uniqueIds },
        active: true,
      },
      orderBy: { uploaded_at: 'asc' },
    });

    for (const row of rows) {
      const mapped = await this.mapEvidenceRow(row);
      const current = map.get(row.finance_id) ?? [];
      current.push(mapped);
      map.set(row.finance_id, current);
    }

    return map;
  }

  private async getEvidenceForFinance(financeId: number) {
    const rows = await this.financeEvidenceClient().findMany({
      where: { finance_id: financeId, active: true },
      orderBy: { uploaded_at: 'asc' },
    });

    return Promise.all(rows.map((row) => this.mapEvidenceRow(row)));
  }

  private async mapEvidenceRow(
    row: FinanceEvidenceRow,
  ): Promise<FinanceEvidenceResponse> {
    return {
      evidence_id: row.finance_evidence_file_id,
      finance_id: row.finance_id,
      url: await this.resolveEvidenceUrl(row.file_url),
      file_name: row.file_name,
      file_type: row.file_type,
      file_size: row.file_size,
      uploaded_by_id: row.uploaded_by_id,
      uploaded_at: row.uploaded_at,
      active: row.active,
    };
  }

  private async resolveEvidenceUrl(value: string) {
    try {
      return await this.fileStorage.getSignedDownloadUrl(
        StorageBucketAlias.EVIDENCE_FILES,
        value,
        {
          expiresInSeconds: FinancesService.EVIDENCE_URL_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.logger.warn(
        'Failed to resolve signed finance evidence URL; returning stored value',
        error,
      );
      return value;
    }
  }

  private resolveFileExtension(file: Express.Multer.File) {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    return mimeToExt[file.mimetype] ?? 'jpg';
  }

  async findOne(financeId: number) {
    const finance = await this.prisma.finances.findUnique({
      where: { finance_id: financeId },
      include: {
        finances_categories: true,
        club_types: { select: { name: true } },
        users: {
          select: { name: true, paternal_last_name: true, user_image: true },
        },
      },
    });

    if (!finance) {
      throw new AppNotFoundException(ErrorCode.FINANCE_TRANSACTION_NOT_FOUND);
    }

    // Unknown club (legacy movement without section) counts as closed: changing
    // it needs an admin and a note.
    const clubId = await this.resolveMovementClubId(finance.club_section_id);
    const periodClosed =
      clubId == null
        ? true
        : (
            await this.financePeriodService.getClosedPeriodKeys(clubId, [
              { year: finance.year, month: finance.month },
            ])
          ).has(closedPeriodKey(finance.year, finance.month));

    return {
      ...finance,
      period_closed: periodClosed,
      evidences: await this.getEvidenceForFinance(financeId),
    };
  }

  async create(dto: CreateFinanceDto, createdBy: string, clubId?: number) {
    let closingNote: string | null = null;
    let periodClosed = false;
    if (clubId != null) {
      const guard = await this.financePeriodService.validatePeriodOpen(
        clubId,
        dto.year,
        dto.month,
        createdBy,
        dto.post_closing_note,
      );
      periodClosed = guard.closed;
      closingNote = guard.note;
    }

    await this.assertUsableFinanceCategory(dto.finance_category_id);

    const created = await this.prisma.finances.create({
      data: {
        year: dto.year,
        month: dto.month,
        amount: dto.amount,
        description: dto.description,
        club_type_id: dto.club_type_id,
        finance_category_id: dto.finance_category_id,
        finance_date: new Date(dto.finance_date),
        club_section_id: dto.club_section_id,
        created_by: createdBy,
        active: true,
        created_at: new Date(),
        modified_at: new Date(),
        post_closing_note: closingNote ?? dto.post_closing_note?.trim() ?? null,
      },
      include: {
        finances_categories: { select: { name: true, type: true } },
      },
    });

    return {
      ...created,
      period_closed: periodClosed,
      evidences: [],
    };
  }

  async update(financeId: number, dto: UpdateFinanceDto, modifiedBy?: string) {
    const existing = await this.findOne(financeId);

    const guard = await this.guardExistingMovement(
      existing,
      modifiedBy,
      dto.post_closing_note,
    );

    if (dto.finance_category_id !== undefined) {
      await this.assertUsableFinanceCategory(dto.finance_category_id);
    }

    const updateData: any = {
      modified_at: new Date(),
      ...(modifiedBy && { modified_by_id: modifiedBy }),
    };

    if (dto.amount !== undefined) updateData.amount = dto.amount;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.finance_category_id !== undefined)
      updateData.finance_category_id = dto.finance_category_id;
    if (dto.finance_date !== undefined)
      updateData.finance_date = new Date(dto.finance_date);
    if (guard.closed) {
      updateData.post_closing_note = guard.note;
    } else if (dto.post_closing_note !== undefined) {
      updateData.post_closing_note = dto.post_closing_note.trim() || null;
    }

    const updated = await this.prisma.finances.update({
      where: { finance_id: financeId },
      data: updateData,
      include: {
        finances_categories: { select: { name: true, type: true } },
      },
    });

    return {
      ...updated,
      period_closed: existing.period_closed,
      evidences: await this.getEvidenceForFinance(financeId),
    };
  }

  /**
   * Deactivates a movement. In a closed month (admin only) `reason` is the
   * required closing note (5 to 500 characters).
   */
  async remove(financeId: number, modifiedBy?: string, reason?: string) {
    const existing = await this.findOne(financeId);

    const guard = await this.guardExistingMovement(
      existing,
      modifiedBy,
      reason,
    );
    const note = guard.closed
      ? guard.note
      : reason?.trim().slice(0, 500) || null;

    return this.prisma.finances.update({
      where: { finance_id: financeId },
      data: {
        active: false,
        modified_at: new Date(),
        ...(modifiedBy && { modified_by_id: modifiedBy }),
        ...(note && { post_closing_note: note }),
      },
    });
  }
}
