import { Injectable, Logger } from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

type CategoryBreakdownItem = {
  finance_category_id: number;
  name: string;
  type: number;
  total: number;
};
type SectionBreakdownItem = {
  club_section_id: number;
  club_type_name: string;
  income: number;
  expense: number;
  balance: number;
};
type Breakdown = {
  by_category: CategoryBreakdownItem[];
  by_section: SectionBreakdownItem[];
};

@Injectable()
export class FinancePeriodService {
  private readonly logger = new Logger(FinancePeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  async closeMonthForClub(
    clubId: number,
    year: number,
    month: number,
    closedBy: string | null = null,
  ) {
    const existing = await this.prisma.financePeriodClosing.findUnique({
      where: { club_id_year_month: { club_id: clubId, year, month } },
    });

    if (existing) {
      this.logger.debug(
        `Closing already exists for club ${clubId}, ${year}-${String(month).padStart(2, '0')}. Skipping.`,
      );
      return null;
    }

    const sections = await this.prisma.club_sections.findMany({
      where: { main_club_id: clubId },
      select: { club_section_id: true, club_types: { select: { name: true } } },
    });

    const sectionIds = sections.map((s) => s.club_section_id);

    const movements = await this.prisma.finances.findMany({
      where: {
        active: true,
        year,
        month,
        club_section_id: { in: sectionIds.length > 0 ? sectionIds : [-1] },
      },
      include: {
        finances_categories: {
          select: { finance_category_id: true, name: true, type: true },
        },
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    for (const mov of movements) {
      if (mov.finances_categories.type === 0) {
        totalIncome += mov.amount;
      } else {
        totalExpense += mov.amount;
      }
    }

    const breakdown = this.buildBreakdown(movements, sections);

    return this.prisma.financePeriodClosing.create({
      data: {
        club_id: clubId,
        year,
        month,
        total_income: totalIncome,
        total_expense: totalExpense,
        balance: totalIncome - totalExpense,
        movement_count: movements.length,
        breakdown: breakdown as any,
        closed_at: new Date(),
        closed_by: closedBy,
      },
    });
  }

  async validatePeriodOpen(
    clubId: number,
    year: number,
    month: number,
    userId: string,
  ): Promise<void> {
    const closing = await this.prisma.financePeriodClosing.findUnique({
      where: { club_id_year_month: { club_id: clubId, year, month } },
    });

    if (!closing) return;

    const isAdmin = await this.authorizationContext.hasAnyGlobalRole(userId, [
      'admin',
      'super_admin',
    ]);

    if (!isAdmin) {
      throw new AppForbiddenException(ErrorCode.FINANCE_PERIOD_CLOSED);
    }
  }

  @Cron('0 0 1 * *', { name: 'finance-period-closing', timeZone: 'UTC' })
  async handleMonthlyClosing(): Promise<void> {
    const { month, year } = this.getPreviousMonth(new Date());
    const period = `${year}-${String(month).padStart(2, '0')}`;

    this.logger.log(`Starting monthly period closing for ${period}...`);

    await this.cronLogger.track('finance-period-closing', async () => {
      const BATCH_SIZE = 50;
      let offset = 0;
      let totalProcessed = 0;
      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;

      while (true) {
        const clubs = await this.prisma.clubs.findMany({
          where: { active: true },
          select: { club_id: true, name: true },
          skip: offset,
          take: BATCH_SIZE,
          orderBy: { club_id: 'asc' },
        });

        if (clubs.length === 0) break;

        for (const club of clubs) {
          totalProcessed++;
          try {
            const result = await this.closeMonthForClub(
              club.club_id,
              year,
              month,
            );
            if (result) {
              successCount++;
              this.logger.log(
                `Closed period ${period} for club "${club.name}" (ID: ${club.club_id})`,
              );
            } else {
              skipCount++;
            }
          } catch (error) {
            errorCount++;
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to close period ${period} for club "${club.name}" (ID: ${club.club_id}): ${message}`,
            );
          }
        }

        offset += BATCH_SIZE;
      }

      this.logger.log(
        `Period closing complete for ${period}: ${successCount} closed, ${skipCount} skipped (already closed), ${errorCount} errors, ${totalProcessed} total`,
      );

      return { itemsProcessed: totalProcessed };
    });
  }

  private getPreviousMonth(date: Date): { month: number; year: number } {
    const currentMonth = date.getMonth() + 1;
    const currentYear = date.getFullYear();

    if (currentMonth === 1) {
      return { month: 12, year: currentYear - 1 };
    }

    return { month: currentMonth - 1, year: currentYear };
  }

  private buildBreakdown(
    movements: Array<{
      amount: number;
      club_section_id: number | null;
      finance_category_id: number;
      finances_categories: {
        finance_category_id: number;
        name: string;
        type: number;
      };
    }>,
    sections: Array<{
      club_section_id: number;
      club_types: { name: string | null } | null;
    }>,
  ): Breakdown {
    const categoryMap = new Map<number, CategoryBreakdownItem>();
    for (const mov of movements) {
      const cat = mov.finances_categories;
      const existing = categoryMap.get(cat.finance_category_id);
      if (existing) {
        existing.total += mov.amount;
      } else {
        categoryMap.set(cat.finance_category_id, {
          finance_category_id: cat.finance_category_id,
          name: cat.name,
          type: cat.type,
          total: mov.amount,
        });
      }
    }

    const sectionMap = new Map<number, SectionBreakdownItem>();
    for (const section of sections) {
      sectionMap.set(section.club_section_id, {
        club_section_id: section.club_section_id,
        club_type_name: section.club_types?.name ?? 'Unknown',
        income: 0,
        expense: 0,
        balance: 0,
      });
    }

    for (const mov of movements) {
      if (mov.club_section_id === null) continue;
      const sectionEntry = sectionMap.get(mov.club_section_id);
      if (!sectionEntry) continue;
      if (mov.finances_categories.type === 0) {
        sectionEntry.income += mov.amount;
      } else {
        sectionEntry.expense += mov.amount;
      }
      sectionEntry.balance = sectionEntry.income - sectionEntry.expense;
    }

    return {
      by_category: Array.from(categoryMap.values()),
      by_section: Array.from(sectionMap.values()),
    };
  }
}
