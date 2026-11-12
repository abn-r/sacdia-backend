import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type FinanceYearMonth = { year: number; month: number };

/**
 * Inclusive month range. Missing `from` means "since the beginning"; missing
 * `to` means "up to now" (no upper bound).
 */
export type FinanceRange = { from?: FinanceYearMonth; to?: FinanceYearMonth };

export interface FinanceTotals {
  /** Sum of income movements inside the range. */
  income: number;
  /** Sum of expense movements inside the range. */
  expenses: number;
  /** income - expenses inside the range. */
  net: number;
  /** Number of active movements inside the range. */
  movements: number;
  /**
   * Cash on hand: all-time cumulative net of every active movement up to the
   * end of the range (not reset by ecclesiastical year).
   */
  balance: number;
}

export interface FinanceCategoryTotal {
  category_id: number;
  name: string;
  type: number;
  total: number;
  count: number;
}

export interface FinanceMonthlyPoint {
  year: number;
  month: number;
  income: number;
  expenses: number;
  /** income - expenses of the month. */
  net: number;
  /** All-time cumulative balance at the end of the month. */
  balance: number;
}

export interface FinanceClubTotals extends FinanceTotals {
  club_id: number;
  last_movement_at: Date | null;
}

export interface FinanceClubScope {
  club: { club_id: number; name: string };
  /** Sections the caller may see, already narrowed by the requested section. */
  sections: Array<{ club_section_id: number; name: string }>;
  sectionIds: number[];
}

const ZERO_TOTALS: FinanceTotals = {
  income: 0,
  expenses: 0,
  net: 0,
  movements: 0,
  balance: 0,
};

/** YYYYMM as an integer, so ranges compare with plain numbers. */
export function financePeriodKey(value: FinanceYearMonth): number {
  return value.year * 100 + value.month;
}

/**
 * Single source of truth for finance totals.
 *
 * Everything is computed LIVE from active `finances` movements. The closing
 * snapshots (`finance_period_closings`) are a historical photo and are never
 * read here, so the summary, the monthly/quarterly/annual reports, the export
 * and the overview always agree.
 *
 * Income vs expense: `finances_categories.type = 0` is income, anything else
 * is an expense. Amounts are integer pesos.
 */
@Injectable()
export class FinanceAggregationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves which sections a request covers.
   *
   * - `userSectionId` (a section-scoped member): always that section only; asking
   *   for another one is a 403.
   * - `requestedSectionId`: must belong to the club (404 otherwise).
   * - neither: every section of the club.
   * Unknown club is a 404 FINANCE_CLUB_NOT_FOUND.
   */
  async resolveClubScope(
    clubId: number,
    requestedSectionId?: number | null,
    userSectionId?: number | null,
  ): Promise<FinanceClubScope> {
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: clubId },
      select: {
        club_id: true,
        name: true,
        club_sections: {
          select: {
            club_section_id: true,
            club_types: { select: { name: true } },
          },
          orderBy: { club_section_id: 'asc' },
        },
      },
    });

    if (!club) {
      throw new AppNotFoundException(ErrorCode.FINANCE_CLUB_NOT_FOUND);
    }

    let sections = club.club_sections.map((s) => ({
      club_section_id: s.club_section_id,
      name: s.club_types?.name ?? '',
    }));

    if (userSectionId != null) {
      if (requestedSectionId != null && requestedSectionId !== userSectionId) {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }
      sections = sections.filter((s) => s.club_section_id === userSectionId);
      // A section-scoped member whose section is not in this club sees nothing.
      return {
        club: { club_id: club.club_id, name: club.name },
        sections,
        sectionIds: [userSectionId],
      };
    }

    if (requestedSectionId != null) {
      sections = sections.filter(
        (s) => s.club_section_id === requestedSectionId,
      );
      if (sections.length === 0) {
        throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
      }
    }

    return {
      club: { club_id: club.club_id, name: club.name },
      sections,
      sectionIds: sections.map((s) => s.club_section_id),
    };
  }

  /** Section ids of a club (all sections, active or not, as the legacy code did). */
  async getClubSectionIds(clubId: number): Promise<number[]> {
    const sections = await this.prisma.club_sections.findMany({
      where: { main_club_id: clubId },
      select: { club_section_id: true },
    });
    return sections.map((s) => s.club_section_id);
  }

  /** Totals for a set of sections (a club = all its sections; a section = one id). */
  async aggregate(
    sectionIds: number[],
    range: FinanceRange = {},
  ): Promise<FinanceTotals> {
    if (sectionIds.length === 0) return { ...ZERO_TOTALS };

    const fromKey = range.from ? financePeriodKey(range.from) : 0;
    const toKey = range.to ? financePeriodKey(range.to) : 999999;

    const [row] = await this.prisma.$queryRaw<
      {
        income: bigint | number | null;
        expenses: bigint | number | null;
        movements: bigint | number | null;
        balance: bigint | number | null;
      }[]
    >`
      SELECT
        COALESCE(SUM(f.amount) FILTER (
          WHERE fc.type = 0 AND (f.year * 100 + f.month) >= ${fromKey}
        ), 0)::bigint AS income,
        COALESCE(SUM(f.amount) FILTER (
          WHERE fc.type <> 0 AND (f.year * 100 + f.month) >= ${fromKey}
        ), 0)::bigint AS expenses,
        (COUNT(*) FILTER (
          WHERE (f.year * 100 + f.month) >= ${fromKey}
        ))::bigint AS movements,
        COALESCE(SUM(CASE WHEN fc.type = 0 THEN f.amount ELSE -f.amount END), 0)::bigint AS balance
      FROM finances f
      JOIN finances_categories fc
        ON fc.finance_category_id = f.finance_category_id
      WHERE f.club_section_id IN (${Prisma.join(sectionIds)})
        AND f.active = true
        AND (f.year * 100 + f.month) <= ${toKey}
    `;

    const income = Number(row?.income ?? 0);
    const expenses = Number(row?.expenses ?? 0);
    return {
      income,
      expenses,
      net: income - expenses,
      movements: Number(row?.movements ?? 0),
      balance: Number(row?.balance ?? 0),
    };
  }

  /** Convenience: totals of one calendar month plus the all-time balance up to it. */
  aggregateMonth(
    sectionIds: number[],
    year: number,
    month: number,
  ): Promise<FinanceTotals> {
    const ym = { year, month };
    return this.aggregate(sectionIds, { from: ym, to: ym });
  }

  /** Per-category totals inside the range, biggest first within each type. */
  async aggregateByCategory(
    sectionIds: number[],
    range: FinanceRange = {},
  ): Promise<FinanceCategoryTotal[]> {
    if (sectionIds.length === 0) return [];

    const fromKey = range.from ? financePeriodKey(range.from) : 0;
    const toKey = range.to ? financePeriodKey(range.to) : 999999;

    const rows = await this.prisma.$queryRaw<
      {
        category_id: number;
        name: string;
        type: number;
        total: bigint | number | null;
        count: bigint | number | null;
      }[]
    >`
      SELECT fc.finance_category_id AS category_id,
             fc.name AS name,
             fc.type AS type,
             COALESCE(SUM(f.amount), 0)::bigint AS total,
             COUNT(*)::bigint AS count
      FROM finances f
      JOIN finances_categories fc
        ON fc.finance_category_id = f.finance_category_id
      WHERE f.club_section_id IN (${Prisma.join(sectionIds)})
        AND f.active = true
        AND (f.year * 100 + f.month) >= ${fromKey}
        AND (f.year * 100 + f.month) <= ${toKey}
      GROUP BY fc.finance_category_id, fc.name, fc.type
      ORDER BY SUM(f.amount) DESC, fc.name ASC
    `;

    return rows.map((r) => ({
      category_id: Number(r.category_id),
      name: r.name,
      type: Number(r.type),
      total: Number(r.total ?? 0),
      count: Number(r.count ?? 0),
    }));
  }

  /**
   * Month of the first active movement of the sections, or null when there is
   * none. Used as the start of an open-ended ("all time") monthly series.
   */
  async firstMovementMonth(
    sectionIds: number[],
  ): Promise<FinanceYearMonth | null> {
    if (sectionIds.length === 0) return null;

    const [row] = await this.prisma.$queryRaw<
      { period_key: number | bigint | null }[]
    >`
      SELECT MIN(f.year * 100 + f.month) AS period_key
      FROM finances f
      WHERE f.club_section_id IN (${Prisma.join(sectionIds)})
        AND f.active = true
    `;

    const key = row?.period_key == null ? null : Number(row.period_key);
    if (key == null) return null;
    return { year: Math.floor(key / 100), month: key % 100 };
  }

  /**
   * One row per calendar month from `from` to `to` (inclusive, zero months
   * included) with the month's income/expenses and the all-time balance at the
   * end of that month. A single query: the months are generated in SQL and the
   * running balance sums every movement up to each month (opening balance
   * before `from` included).
   */
  async aggregateMonthlySeries(
    sectionIds: number[],
    from: FinanceYearMonth,
    to: FinanceYearMonth,
  ): Promise<FinanceMonthlyPoint[]> {
    if (sectionIds.length === 0) return [];

    const fromKey = financePeriodKey(from);
    const toKey = financePeriodKey(to);
    if (fromKey > toKey) return [];

    const rows = await this.prisma.$queryRaw<
      {
        year: number | bigint;
        month: number | bigint;
        income: bigint | number | null;
        expenses: bigint | number | null;
        balance: bigint | number | null;
      }[]
    >`
      WITH mv AS (
        SELECT (f.year * 100 + f.month) AS period_key,
               COALESCE(SUM(f.amount) FILTER (WHERE fc.type = 0), 0)::bigint AS income,
               COALESCE(SUM(f.amount) FILTER (WHERE fc.type <> 0), 0)::bigint AS expenses
        FROM finances f
        JOIN finances_categories fc
          ON fc.finance_category_id = f.finance_category_id
        WHERE f.club_section_id IN (${Prisma.join(sectionIds)})
          AND f.active = true
          AND (f.year * 100 + f.month) <= ${toKey}
        GROUP BY (f.year * 100 + f.month)
      ),
      months AS (
        SELECT EXTRACT(YEAR FROM d)::int AS year,
               EXTRACT(MONTH FROM d)::int AS month,
               (EXTRACT(YEAR FROM d)::int * 100 + EXTRACT(MONTH FROM d)::int) AS period_key
        FROM generate_series(
          make_date(${from.year}::int, ${from.month}::int, 1),
          make_date(${to.year}::int, ${to.month}::int, 1),
          interval '1 month'
        ) AS d
      )
      SELECT m.year, m.month,
             COALESCE(cur.income, 0)::bigint AS income,
             COALESCE(cur.expenses, 0)::bigint AS expenses,
             COALESCE((
               SELECT SUM(prev.income - prev.expenses)
               FROM mv prev
               WHERE prev.period_key <= m.period_key
             ), 0)::bigint AS balance
      FROM months m
      LEFT JOIN mv cur ON cur.period_key = m.period_key
      ORDER BY m.period_key ASC
    `;

    return rows.map((r) => {
      const income = Number(r.income ?? 0);
      const expenses = Number(r.expenses ?? 0);
      return {
        year: Number(r.year),
        month: Number(r.month),
        income,
        expenses,
        net: income - expenses,
        balance: Number(r.balance ?? 0),
      };
    });
  }

  /** Totals per club (all sections of each club together). */
  async aggregateByClub(
    clubIds: number[],
    range: FinanceRange = {},
  ): Promise<Map<number, FinanceClubTotals>> {
    const result = new Map<number, FinanceClubTotals>();
    if (clubIds.length === 0) return result;

    const fromKey = range.from ? financePeriodKey(range.from) : 0;
    const toKey = range.to ? financePeriodKey(range.to) : 999999;

    const rows = await this.prisma.$queryRaw<
      {
        club_id: number;
        income: bigint | number | null;
        expenses: bigint | number | null;
        movements: bigint | number | null;
        balance: bigint | number | null;
        last_movement_at: Date | null;
      }[]
    >`
      SELECT cs.main_club_id AS club_id,
        COALESCE(SUM(f.amount) FILTER (
          WHERE fc.type = 0 AND (f.year * 100 + f.month) >= ${fromKey}
        ), 0)::bigint AS income,
        COALESCE(SUM(f.amount) FILTER (
          WHERE fc.type <> 0 AND (f.year * 100 + f.month) >= ${fromKey}
        ), 0)::bigint AS expenses,
        (COUNT(*) FILTER (
          WHERE (f.year * 100 + f.month) >= ${fromKey}
        ))::bigint AS movements,
        COALESCE(SUM(CASE WHEN fc.type = 0 THEN f.amount ELSE -f.amount END), 0)::bigint AS balance,
        MAX(f.created_at) AS last_movement_at
      FROM finances f
      JOIN finances_categories fc
        ON fc.finance_category_id = f.finance_category_id
      JOIN club_sections cs
        ON cs.club_section_id = f.club_section_id
      WHERE cs.main_club_id IN (${Prisma.join(clubIds)})
        AND f.active = true
        AND (f.year * 100 + f.month) <= ${toKey}
      GROUP BY cs.main_club_id
    `;

    for (const r of rows) {
      const income = Number(r.income ?? 0);
      const expenses = Number(r.expenses ?? 0);
      result.set(Number(r.club_id), {
        club_id: Number(r.club_id),
        income,
        expenses,
        net: income - expenses,
        movements: Number(r.movements ?? 0),
        balance: Number(r.balance ?? 0),
        last_movement_at: r.last_movement_at ?? null,
      });
    }
    return result;
  }
}
