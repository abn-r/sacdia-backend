import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FinanceMonthsStatus {
  /** Months (1..12) that were closed and had at least one movement before the closing. */
  monthsWithMovements: number[];
  /** Months (1..12) that were closed without any movement registered before the closing. */
  missedMonths: number[];
}

/**
 * Finance score: months in which the club registered at least one movement
 * before that month's automatic closing, over 12.
 *
 * A month counts when a `finance_period_closings` row exists with `closed_at`
 * set AND there is an active `finances` row of that year/month, created at or
 * before `closed_at`, in a section of the club. Movements created after the
 * closing (admin-only) do not count.
 */
@Injectable()
export class FinanceScoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single source of truth for the rule. Used by both the score and the
   * ranking breakdown so they cannot diverge.
   */
  async getMonthsStatus(
    clubId: number,
    year: number,
  ): Promise<FinanceMonthsStatus> {
    const rows = await this.prisma.$queryRaw<
      { month: number; has_movement: boolean }[]
    >`
      SELECT c.month,
             EXISTS (
               SELECT 1
               FROM finances f
               JOIN club_sections cs ON cs.club_section_id = f.club_section_id
               WHERE cs.main_club_id = c.club_id
                 AND f.active = true
                 AND f.year = c.year
                 AND f.month = c.month
                 AND f.created_at <= c.closed_at
             ) AS has_movement
      FROM finance_period_closings c
      WHERE c.club_id = ${clubId}
        AND c.year = ${year}
        AND c.closed_at IS NOT NULL
    `;

    const withMovements = new Set<number>();
    const missed = new Set<number>();
    for (const row of rows) {
      const month = Number(row.month);
      if (month < 1 || month > 12) continue;
      if (row.has_movement) {
        withMovements.add(month);
        missed.delete(month);
      } else if (!withMovements.has(month)) {
        missed.add(month);
      }
    }
    const asc = (a: number, b: number) => a - b;
    return {
      monthsWithMovements: [...withMovements].sort(asc),
      missedMonths: [...missed].sort(asc),
    };
  }

  async calc(clubId: number, year: number): Promise<number> {
    const { monthsWithMovements } = await this.getMonthsStatus(clubId, year);
    const score = Math.min((monthsWithMovements.length / 12) * 100, 100);
    return Number(score.toFixed(2));
  }
}
