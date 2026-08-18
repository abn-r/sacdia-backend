import { Inject, Injectable, Logger } from '@nestjs/common';
import 'multer';
import {
  AppBadRequestException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
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
import { FinancePeriodService } from './finance-period.service';
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

type FinanceSectionFilter =
  | { club_section_id: { in: number[] } }
  | { club_section_id: number };

type FinancePeriodTotals = {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  movementCount: number;
};

type FinancePeriod = {
  year: number;
  month: number;
};

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
    // Obtener las secciones del club
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
    //   optionally narrowed by clubTypeId filter — preserves original broad behaviour.
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

    const where = {
      active: true,
      ...sectionFilter,
      ...(filters?.year && { year: filters.year }),
      ...(filters?.month && { month: filters.month }),
      ...(filters?.clubTypeId && { club_type_id: filters.clubTypeId }),
      ...(filters?.categoryId && { finance_category_id: filters.categoryId }),
    };

    const [data, total] = await Promise.all([
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
    const evidencesByFinanceId = await this.getEvidenceMap(
      data.map((record) => record.finance_id),
    );
    const dataWithEvidences = data.map((record) => ({
      ...record,
      evidences: evidencesByFinanceId.get(record.finance_id) ?? [],
    }));

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
                contains: dto.search,
                mode: 'insensitive' as const,
              },
            },
            {
              finances_categories: {
                name: { contains: dto.search, mode: 'insensitive' as const },
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
  ) {
    // Obtener las secciones del club
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
    // - Admin bypass (userSectionId === null): show all sections — original behaviour.
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

    if (year && month) {
      return this.getEcclesiasticalYearToDateSummary(
        clubId,
        year,
        month,
        sectionFilter,
        userSectionId,
      );
    }

    const where = {
      active: true,
      ...sectionFilter,
      ...(year && { year }),
      ...(month && { month }),
    };

    // Obtener todos los movimientos
    const movements = await this.prisma.finances.findMany({
      where,
      include: {
        finances_categories: { select: { type: true } },
      },
    });

    // Calcular totales
    let totalIncome = 0;
    let totalExpense = 0;

    movements.forEach((mov) => {
      if (mov.finances_categories.type === 0) {
        totalIncome += mov.amount;
      } else {
        totalExpense += mov.amount;
      }
    });

    return {
      club_id: clubId,
      period: year
        ? `${year}${month ? `-${String(month).padStart(2, '0')}` : ''}`
        : 'all',
      total_income: totalIncome,
      total_expense: totalExpense,
      balance: totalIncome - totalExpense,
      movement_count: movements.length,
    };
  }

  /**
   * Returns the carried balance for the ecclesiastical year containing
   * [year]/[month], from the ecclesiastical-year start through the selected
   * month. Closed months use the immutable FinancePeriodClosing snapshot; open
   * months are computed from live movements.
   */
  private async getEcclesiasticalYearToDateSummary(
    clubId: number,
    year: number,
    month: number,
    sectionFilter: FinanceSectionFilter,
    userSectionId?: number | null,
  ) {
    const targetMonthStart = this.startOfMonthUtc(year, month);
    const targetMonthEnd = this.endOfMonthUtc(year, month);

    const ecclesiasticalYear = await this.prisma.ecclesiastical_years.findFirst(
      {
        where: {
          start_date: { lte: targetMonthStart },
          end_date: { gte: targetMonthStart },
        },
        select: {
          start_date: true,
          end_date: true,
        },
        orderBy: { start_date: 'desc' },
      },
    );

    const rangeStart =
      ecclesiasticalYear?.start_date ?? this.startOfMonthUtc(year, 1);
    const rangeEnd = ecclesiasticalYear
      ? this.minDate(targetMonthEnd, ecclesiasticalYear.end_date)
      : targetMonthEnd;

    const periods = this.buildMonthRange(rangeStart, rangeEnd);
    const closedTotals = await this.getClosedPeriodTotals(
      clubId,
      periods,
      userSectionId,
    );

    const closedKeys = new Set(
      closedTotals.closedPeriods.map((p) => this.periodKey(p.year, p.month)),
    );
    const openPeriods = periods.filter(
      (p) => !closedKeys.has(this.periodKey(p.year, p.month)),
    );
    const liveTotals = await this.getLivePeriodTotals(
      openPeriods,
      sectionFilter,
    );

    const totalIncome =
      closedTotals.totals.totalIncome + liveTotals.totalIncome;
    const totalExpense =
      closedTotals.totals.totalExpense + liveTotals.totalExpense;

    return {
      club_id: clubId,
      period: `${year}-${String(month).padStart(2, '0')}`,
      total_income: totalIncome,
      total_expense: totalExpense,
      balance: totalIncome - totalExpense,
      movement_count:
        closedTotals.totals.movementCount + liveTotals.movementCount,
    };
  }

  private async getClosedPeriodTotals(
    clubId: number,
    periods: FinancePeriod[],
    userSectionId?: number | null,
  ): Promise<{ totals: FinancePeriodTotals; closedPeriods: FinancePeriod[] }> {
    const totals: FinancePeriodTotals = {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      movementCount: 0,
    };

    if (periods.length === 0) {
      return { totals, closedPeriods: [] };
    }

    const closings = await this.prisma.financePeriodClosing.findMany({
      where: {
        club_id: clubId,
        OR: periods.map((p) => ({ year: p.year, month: p.month })),
      },
      select: {
        year: true,
        month: true,
        total_income: true,
        total_expense: true,
        balance: true,
        movement_count: true,
        breakdown: true,
      },
    });

    for (const closing of closings) {
      if (userSectionId == null) {
        totals.totalIncome += closing.total_income;
        totals.totalExpense += closing.total_expense;
        totals.balance += closing.balance;
        totals.movementCount += closing.movement_count;
        continue;
      }

      const sectionTotals = this.getSectionTotalsFromClosing(
        closing.breakdown,
        userSectionId,
      );
      totals.totalIncome += sectionTotals.totalIncome;
      totals.totalExpense += sectionTotals.totalExpense;
      totals.balance += sectionTotals.balance;
    }

    return {
      totals,
      closedPeriods: closings.map((c) => ({ year: c.year, month: c.month })),
    };
  }

  private async getLivePeriodTotals(
    periods: FinancePeriod[],
    sectionFilter: FinanceSectionFilter,
  ): Promise<FinancePeriodTotals> {
    const totals: FinancePeriodTotals = {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      movementCount: 0,
    };

    if (periods.length === 0) return totals;

    const movements = await this.prisma.finances.findMany({
      where: {
        active: true,
        ...sectionFilter,
        OR: periods.map((p) => ({ year: p.year, month: p.month })),
      },
      include: {
        finances_categories: { select: { type: true } },
      },
    });

    for (const movement of movements) {
      if (movement.finances_categories.type === 0) {
        totals.totalIncome += movement.amount;
      } else {
        totals.totalExpense += movement.amount;
      }
    }

    totals.balance = totals.totalIncome - totals.totalExpense;
    totals.movementCount = movements.length;
    return totals;
  }

  private getSectionTotalsFromClosing(
    breakdown: unknown,
    sectionId: number,
  ): FinancePeriodTotals {
    const empty: FinancePeriodTotals = {
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      movementCount: 0,
    };

    if (!breakdown || typeof breakdown !== 'object') return empty;

    const bySection = (breakdown as { by_section?: unknown }).by_section;
    if (!Array.isArray(bySection)) return empty;

    const section = bySection.find((item) => {
      if (!item || typeof item !== 'object') return false;
      return (
        (item as { club_section_id?: unknown }).club_section_id === sectionId
      );
    });

    if (!section || typeof section !== 'object') return empty;

    const data = section as {
      income?: unknown;
      expense?: unknown;
      balance?: unknown;
    };

    return {
      totalIncome: this.toNumber(data.income),
      totalExpense: this.toNumber(data.expense),
      balance: this.toNumber(data.balance),
      movementCount: 0,
    };
  }

  private buildMonthRange(startDate: Date, endDate: Date): FinancePeriod[] {
    const periods: FinancePeriod[] = [];
    const cursor = this.startOfMonthUtc(
      startDate.getUTCFullYear(),
      startDate.getUTCMonth() + 1,
    );
    const end = this.startOfMonthUtc(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth() + 1,
    );

    while (cursor <= end) {
      periods.push({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth() + 1,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return periods;
  }

  private startOfMonthUtc(year: number, month: number): Date {
    return new Date(Date.UTC(year, month - 1, 1));
  }

  private endOfMonthUtc(year: number, month: number): Date {
    return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  }

  private minDate(a: Date, b: Date): Date {
    return a.getTime() <= b.getTime() ? a : b;
  }

  private periodKey(year: number, month: number): string {
    return `${year}-${month}`;
  }

  private toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value) || 0;
    return 0;
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
          file_name: file.originalname || objectKey,
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

    return {
      ...finance,
      evidences: await this.getEvidenceForFinance(financeId),
    };
  }

  async create(dto: CreateFinanceDto, createdBy: string, clubId?: number) {
    if (clubId != null) {
      await this.financePeriodService.validatePeriodOpen(
        clubId,
        dto.year,
        dto.month,
        createdBy,
      );
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
        post_closing_note: dto.post_closing_note ?? null,
      },
      include: {
        finances_categories: { select: { name: true, type: true } },
      },
    });

    return {
      ...created,
      evidences: [],
    };
  }

  async update(financeId: number, dto: UpdateFinanceDto, modifiedBy?: string) {
    const existing = await this.findOne(financeId);

    // Period validation: resolve clubId from movement's club_section
    if (existing.club_section_id && modifiedBy) {
      const section = await this.prisma.club_sections.findUnique({
        where: { club_section_id: existing.club_section_id },
        select: { main_club_id: true },
      });
      if (section?.main_club_id) {
        await this.financePeriodService.validatePeriodOpen(
          section.main_club_id,
          existing.year,
          existing.month,
          modifiedBy,
        );
      }
    }

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
    if (dto.post_closing_note !== undefined)
      updateData.post_closing_note = dto.post_closing_note;

    const updated = await this.prisma.finances.update({
      where: { finance_id: financeId },
      data: updateData,
      include: {
        finances_categories: { select: { name: true, type: true } },
      },
    });

    return {
      ...updated,
      evidences: await this.getEvidenceForFinance(financeId),
    };
  }

  async remove(financeId: number, modifiedBy?: string, reason?: string) {
    const existing = await this.findOne(financeId);

    // Period validation: resolve clubId from movement's club_section
    if (existing.club_section_id && modifiedBy) {
      const section = await this.prisma.club_sections.findUnique({
        where: { club_section_id: existing.club_section_id },
        select: { main_club_id: true },
      });
      if (section?.main_club_id) {
        await this.financePeriodService.validatePeriodOpen(
          section.main_club_id,
          existing.year,
          existing.month,
          modifiedBy,
        );
      }
    }

    return this.prisma.finances.update({
      where: { finance_id: financeId },
      data: {
        active: false,
        modified_at: new Date(),
        ...(modifiedBy && { modified_by_id: modifiedBy }),
        ...(reason && { post_closing_note: reason }),
      },
    });
  }
}
