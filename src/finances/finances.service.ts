import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinanceDto, UpdateFinanceDto, FinanceFiltersDto } from './dto';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';
import { FinancePeriodService } from './finance-period.service';

@Injectable()
export class FinancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financePeriodService: FinancePeriodService,
  ) {}

  // ========================================
  // CATEGORÍAS
  // ========================================

  async getCategories(type?: number) {
    return this.prisma.finances_categories.findMany({
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
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  // ========================================
  // FINANZAS POR CLUB
  // ========================================

  async findByClub(
    clubId: number,
    filters?: FinanceFiltersDto,
    pagination?: PaginationDto,
  ): Promise<PaginatedResult<any>> {
    // Obtener las secciones del club
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_sections: { select: { club_section_id: true } },
      },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const sectionIds = club.club_sections.map((s) => s.club_section_id);

    const where = {
      club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] },
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
          users: { select: { name: true, paternal_last_name: true } },
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

  async getSummary(clubId: number, year?: number, month?: number) {
    // Obtener las secciones del club
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_sections: { select: { club_section_id: true } },
      },
    });

    if (!club) {
      throw new NotFoundException(`Club with ID ${clubId} not found`);
    }

    const sectionIds = club.club_sections.map((s) => s.club_section_id);

    const where = {
      active: true,
      club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] },
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
        users: { select: { name: true, paternal_last_name: true } },
      },
    });

    if (!finance) {
      throw new NotFoundException(
        `Finance record with ID ${financeId} not found`,
      );
    }

    return finance;
  }

  async create(dto: CreateFinanceDto, createdBy: string, clubId?: number) {
    if (clubId != null) {
      await this.financePeriodService.validatePeriodOpen(clubId, dto.year, dto.month, createdBy);
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
          section.main_club_id, existing.year, existing.month, modifiedBy,
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
          section.main_club_id, existing.year, existing.month, modifiedBy,
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
