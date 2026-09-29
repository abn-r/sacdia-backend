import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import {
  BACKGROUND_JOBS_QUEUE,
  BackgroundJobName,
  FinancePeriodCloseMonthPayload,
} from '../background-jobs/background-jobs.types';

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

export type CloseMonthOptions = {
  replace?: boolean;
  closedAt?: Date;
};

export function previousUtcMonth(date: Date): { month: number; year: number } {
  const currentMonth = date.getUTCMonth() + 1;
  const currentYear = date.getUTCFullYear();

  if (currentMonth === 1) {
    return { month: 12, year: currentYear - 1 };
  }

  return { month: currentMonth - 1, year: currentYear };
}

export function utcMonthClosedAt(year: number, month: number): Date {
  if (month === 12) {
    return new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
  }
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
}

export function listUtcMonthsThroughPrevious(
  rangeStart: Date,
  now: Date,
): { year: number; month: number }[] {
  const end = previousUtcMonth(now);
  let year = rangeStart.getUTCFullYear();
  let month = rangeStart.getUTCMonth() + 1;
  const months: { year: number; month: number }[] = [];

  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

@Injectable()
export class FinancePeriodService {
  private readonly logger = new Logger(FinancePeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly cronLogger: CronRunLogger,
    @Optional()
    @InjectQueue(BACKGROUND_JOBS_QUEUE)
    private readonly financePeriodQueue: Queue | null,
  ) {}

  async closeMonthForClub(
    clubId: number,
    year: number,
    month: number,
    closedBy: string | null = null,
    options: CloseMonthOptions = {},
  ) {
    const existing = await this.prisma.financePeriodClosing.findUnique({
      where: { club_id_year_month: { club_id: clubId, year, month } },
    });

    if (existing && !options.replace) {
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

    const closingData = {
      club_id: clubId,
      year,
      month,
      total_income: totalIncome,
      total_expense: totalExpense,
      balance: totalIncome - totalExpense,
      movement_count: movements.length,
      breakdown: breakdown as any,
      closed_at: options.closedAt ?? new Date(),
      closed_by: closedBy,
    };

    if (existing && options.replace) {
      return this.prisma.financePeriodClosing.update({
        where: {
          finance_period_closing_id: existing.finance_period_closing_id,
        },
        data: {
          total_income: closingData.total_income,
          total_expense: closingData.total_expense,
          balance: closingData.balance,
          movement_count: closingData.movement_count,
          breakdown: closingData.breakdown,
          closed_at: closingData.closed_at,
          closed_by: closingData.closed_by,
        },
      });
    }

    return this.prisma.financePeriodClosing.create({
      data: closingData,
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
      'super-admin',
    ]);

    if (!isAdmin) {
      throw new AppForbiddenException(ErrorCode.FINANCE_PERIOD_CLOSED);
    }
  }

  @Cron('0 0 1 * *', { name: 'finance-period-closing', timeZone: 'UTC' })
  async handleMonthlyClosing(): Promise<void> {
    const { month, year } = previousUtcMonth(new Date());
    const period = `${year}-${String(month).padStart(2, '0')}`;

    this.logger.log(
      `Finance period-closing cron triggered for ${period} — enqueuing BullMQ job...`,
    );

    if (this.financePeriodQueue) {
      const jobData: FinancePeriodCloseMonthPayload = {
        triggeredAt: new Date().toISOString(),
        year,
        month,
      };
      await this.financePeriodQueue.add(
        BackgroundJobName.FINANCE_PERIOD_CLOSE_MONTH,
        jobData,
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 }, // 1 min → 2 → 4 → 8 → 16 min
          removeOnComplete: { age: 7 * 86_400 },
          removeOnFail: { age: 30 * 86_400 },
        },
      );
      this.logger.log(
        `finance-period-closing job enqueued for ${period} with 5 attempts + exponential backoff`,
      );
    } else {
      // Redis unavailable — execute directly (no retry fallback)
      this.logger.warn(
        `BullMQ queue unavailable — running finance-period closing for ${period} directly (no retry)`,
      );
      await this.runMonthlyClosing(year, month);
    }
  }

  /**
   * Runs the full batched monthly-closing loop for the given year/month.
   * Called by the BullMQ processor (with retry) and as a direct fallback
   * when Redis is unavailable.
   *
   * Idempotency: closeMonthForClub() returns null when the period is already
   * closed, so retries are safe.
   */
  async runMonthlyClosing(
    year: number,
    month: number,
  ): Promise<{ itemsProcessed: number }> {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    this.logger.log(`Starting monthly period closing for ${period}...`);

    return this.cronLogger.track('finance-period-closing', async () => {
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

  async rebuildCompletedClosings(now = new Date()): Promise<{
    months: number;
    itemsProcessed: number;
    rebuilt: number;
  }> {
    const activeYear = await this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      select: { start_date: true },
    });

    if (!activeYear) {
      this.logger.warn(
        'No active ecclesiastical year — skipping finance period rebuild',
      );
      return { months: 0, itemsProcessed: 0, rebuilt: 0 };
    }

    const months = listUtcMonthsThroughPrevious(activeYear.start_date, now);
    const BATCH_SIZE = 50;
    let itemsProcessed = 0;
    let rebuilt = 0;

    for (const { year, month } of months) {
      const closedAt = utcMonthClosedAt(year, month);
      const period = `${year}-${String(month).padStart(2, '0')}`;
      let offset = 0;

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
          itemsProcessed += 1;
          try {
            const result = await this.closeMonthForClub(
              club.club_id,
              year,
              month,
              null,
              { replace: true, closedAt },
            );
            if (result) {
              rebuilt += 1;
              this.logger.log(
                `Rebuilt period ${period} for club "${club.name}" (ID: ${club.club_id})`,
              );
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to rebuild period ${period} for club "${club.name}" (ID: ${club.club_id}): ${message}`,
            );
          }
        }

        offset += BATCH_SIZE;
      }
    }

    this.logger.log(
      `Finance period rebuild complete: ${rebuilt} snapshots across ${months.length} months`,
    );

    return { months: months.length, itemsProcessed, rebuilt };
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
