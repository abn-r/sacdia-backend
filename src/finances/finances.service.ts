import { Injectable } from '@nestjs/common';
import {
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

@Injectable()
export class FinancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financePeriodService: FinancePeriodService,
    private readonly translationService: TranslationService,
  ) {}

  // ========================================
  // CATEGORÍAS
  // ========================================

  async getCategories(type?: number) {
    const locale = this.translationService.getCurrentLocale();
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
    return this.translationService.translateMany(records, locale, ['name', 'description'], 'translations');
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
    let sectionFilter: { club_section_id: { in: number[] } } | { club_section_id: number };

    if (userSectionId == null) {
      const sectionIds = club.club_sections.map((s) => s.club_section_id);
      sectionFilter = { club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] } };
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
          users: { select: { name: true, paternal_last_name: true, user_image: true } },
        },
        orderBy: [{ finance_date: 'desc' }, { created_at: 'desc' }],
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 20,
      }),
      this.prisma.finances.count({ where }),
    ]);

    return createPaginatedResult(
      data,
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
    let sectionFilter: { club_section_id: { in: number[] } } | { club_section_id: number };

    if (userSectionId == null) {
      const sectionIds = club.club_sections.map((s) => s.club_section_id);
      sectionFilter = { club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] } };
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
              description: { contains: dto.search, mode: 'insensitive' as const },
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
        ? [{ amount: sortDir as 'asc' | 'desc' }]
        : dto.sortBy === 'category'
          ? [{ finances_categories: { name: sortDir as 'asc' | 'desc' } }]
          : [{ finance_date: sortDir as 'asc' | 'desc' }];

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
    let sectionFilter: { club_section_id: { in: number[] } } | { club_section_id: number };

    if (userSectionId == null) {
      const sectionIds = club.club_sections.map((s) => s.club_section_id);
      sectionFilter = { club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] } };
    } else {
      sectionFilter = { club_section_id: userSectionId };
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

  async findOne(financeId: number) {
    const finance = await this.prisma.finances.findUnique({
      where: { finance_id: financeId },
      include: {
        finances_categories: true,
        club_types: { select: { name: true } },
        users: { select: { name: true, paternal_last_name: true, user_image: true } },
      },
    });

    if (!finance) {
      throw new AppNotFoundException(ErrorCode.FINANCE_TRANSACTION_NOT_FOUND);
    }

    return finance;
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

    return this.prisma.finances.create({
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

    return this.prisma.finances.update({
      where: { finance_id: financeId },
      data: updateData,
      include: {
        finances_categories: { select: { name: true, type: true } },
      },
    });
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
