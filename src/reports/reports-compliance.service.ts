import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import {
  buildReportClubSectionWhere,
  resolveReportVisibilityScopeForActor,
} from './report-visibility-scope';

/** Same fallback and bounds as MonthlyReportsService.runAutoGeneration. */
const DEFAULT_DUE_DAY = 5;
const DUE_DAY_CONFIG_KEY = 'reports.auto_generate_day';

/** Monthly: only `submitted` counts. Quarterly / annual: closed by an admin. */
const MONTHLY_SUBMITTED_STATUSES = new Set(['submitted']);
const CLUB_REPORT_SUBMITTED_STATUSES = new Set(['finalized', 'archived']);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type ComplianceCounts = {
  expected: number;
  submitted: number;
  pending: number;
  overdue: number;
};

export type ComplianceFilters = {
  ecclesiasticalYearId?: number;
  clubTypeId?: number;
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
  /** Calendar year that narrows `month` / `quarter` (optional). */
  year?: number;
  month?: number;
  quarter?: number;
  page?: number;
  limit?: number;
};

type Period = {
  year: number;
  /** Month (1-12) or quarter (1-4), depending on the report type. */
  index: number;
  /** First instant after the period. */
  endsAt: Date;
  /** Due date: `due_day` of the month after the period, 23:00 UTC. */
  dueAt: Date;
};

type PeriodOutcome = 'submitted' | 'pending' | 'overdue' | 'not_due';

const emptyCounts = (): ComplianceCounts => ({
  expected: 0,
  submitted: 0,
  pending: 0,
  overdue: 0,
});

function addOutcome(counts: ComplianceCounts, outcome: PeriodOutcome): void {
  if (outcome === 'not_due') return;
  counts.expected += 1;
  counts[outcome] += 1;
}

/**
 * A period counts once it has ended (or once its report was submitted early):
 * submitted -> submitted; otherwise pending until the due date, overdue after.
 * An open period without a submitted report is not expected yet.
 */
export function classifyPeriod(
  period: Pick<Period, 'endsAt' | 'dueAt'>,
  submitted: boolean,
  now: Date,
): PeriodOutcome {
  if (submitted) return 'submitted';
  if (now.getTime() < period.endsAt.getTime()) return 'not_due';
  return now.getTime() < period.dueAt.getTime() ? 'pending' : 'overdue';
}

/** `due_day` of the month after the month that starts at `nextMonthIndex`. */
function dueDate(year: number, nextMonthIndex: number, dueDay: number): Date {
  return new Date(Date.UTC(year, nextMonthIndex, dueDay, 23, 0, 0, 0));
}

/** Calendar months inside [start, end] (UTC dates). */
export function monthlyPeriods(
  start: Date,
  end: Date,
  dueDay: number,
): Period[] {
  const periods: Period[] = [];
  for (
    let cursor = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
    );
    cursor.getTime() <= end.getTime();
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  ) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    periods.push({
      year,
      index: month + 1,
      endsAt: new Date(Date.UTC(year, month + 1, 1)),
      dueAt: dueDate(year, month + 1, dueDay),
    });
  }
  return periods;
}

/** Calendar quarters fully inside [start, end] (UTC dates). */
export function quarterlyPeriods(
  start: Date,
  end: Date,
  dueDay: number,
): Period[] {
  return monthlyPeriods(start, end, dueDay)
    .filter((month) => month.index % 3 === 0)
    .filter((lastMonth) => {
      const firstMonthStart = Date.UTC(lastMonth.year, lastMonth.index - 3, 1);
      return firstMonthStart >= start.getTime();
    })
    .map((lastMonth) => ({
      year: lastMonth.year,
      index: lastMonth.index / 3,
      endsAt: lastMonth.endsAt,
      dueAt: lastMonth.dueAt,
    }));
}

/**
 * Read-only compliance of monthly, quarterly and annual reports per club for
 * one ecclesiastical year. Visibility is the SAME as the admin report lists
 * (resolveReportVisibilityScopeForActor): territory for territorial roles,
 * coordinator_assignments for coordinators, the active club section
 * otherwise. Monthly counts use only the sections in that scope; quarterly
 * and annual reports belong to the club, which is in scope when one of its
 * sections is.
 */
@Injectable()
export class ReportsComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
  ) {}

  async getCompliance(
    userId: string,
    filters: ComplianceFilters,
    now: Date = new Date(),
  ) {
    this.validateFilters(filters);

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    const scope = await resolveReportVisibilityScopeForActor(
      resolved,
      {
        divisionId: filters.divisionId,
        unionId: filters.unionId,
        localFieldId: filters.localFieldId,
      },
      () => this.coordinationService.getEffectiveCoordinatorSectionIds(userId),
    );

    const ecclesiasticalYear = await this.resolveEcclesiasticalYear(
      filters.ecclesiasticalYearId,
    );
    const dueDay = await this.resolveDueDay();

    const sectionWhere = buildReportClubSectionWhere(scope, {
      active: true,
      ...(filters.clubTypeId !== undefined && {
        club_type_id: filters.clubTypeId,
      }),
      AND: [{ clubs: { is: { active: true } } }],
    } satisfies Prisma.club_sectionsWhereInput);

    const sections = await this.prisma.club_sections.findMany({
      where: sectionWhere,
      select: {
        club_section_id: true,
        club_type_id: true,
        club_types: { select: { name: true } },
        clubs: {
          select: {
            club_id: true,
            name: true,
            local_field_id: true,
            local_fields: { select: { name: true } },
          },
        },
      },
    });

    const clubs = new Map<
      number,
      {
        club_id: number;
        club_name: string;
        local_field_id: number | null;
        local_field_name: string | null;
        sections: Array<{
          club_section_id: number;
          club_type_id: number;
          club_type_name: string | null;
        }>;
        monthly: ComplianceCounts;
        quarterly: ComplianceCounts;
        annual: ComplianceCounts;
      }
    >();
    const clubIdBySection = new Map<number, number>();

    for (const section of sections) {
      const club = section.clubs;
      if (!club) continue;
      clubIdBySection.set(section.club_section_id, club.club_id);
      const entry = clubs.get(club.club_id) ?? {
        club_id: club.club_id,
        club_name: club.name,
        local_field_id: club.local_field_id ?? null,
        local_field_name: club.local_fields?.name ?? null,
        sections: [],
        monthly: emptyCounts(),
        quarterly: emptyCounts(),
        annual: emptyCounts(),
      };
      entry.sections.push({
        club_section_id: section.club_section_id,
        club_type_id: section.club_type_id,
        club_type_name: section.club_types?.name ?? null,
      });
      clubs.set(club.club_id, entry);
    }

    const clubIds = [...clubs.keys()];
    const sectionIds = [...clubIdBySection.keys()];
    const { start_date: start, end_date: end } = ecclesiasticalYear;

    // ── Monthly (per in-scope section enrollment) ──
    const months = monthlyPeriods(start, end, dueDay).filter(
      (period) =>
        (filters.month === undefined || period.index === filters.month) &&
        (filters.year === undefined || period.year === filters.year),
    );
    const monthlyTotals = emptyCounts();
    const monthlyByPeriod = new Map<string, ComplianceCounts>(
      months.map((period) => [`${period.year}-${period.index}`, emptyCounts()]),
    );

    if (sectionIds.length > 0 && months.length > 0) {
      const enrollments = await this.prisma.club_enrollments.findMany({
        where: {
          ecclesiastical_year_id: ecclesiasticalYear.year_id,
          status: 'active',
          club_section_id: { in: sectionIds },
        },
        select: {
          club_enrollment_id: true,
          club_section_id: true,
          monthly_reports: {
            where: {
              OR: months.map((period) => ({
                year: period.year,
                month: period.index,
              })),
            },
            select: { year: true, month: true, status: true },
          },
        },
      });

      for (const enrollment of enrollments) {
        const clubId = clubIdBySection.get(enrollment.club_section_id);
        const club = clubId !== undefined ? clubs.get(clubId) : undefined;
        if (!club) continue;
        const submitted = new Set(
          enrollment.monthly_reports
            .filter((report) => MONTHLY_SUBMITTED_STATUSES.has(report.status))
            .map((report) => `${report.year}-${report.month}`),
        );
        for (const period of months) {
          const key = `${period.year}-${period.index}`;
          const outcome = classifyPeriod(period, submitted.has(key), now);
          addOutcome(club.monthly, outcome);
          addOutcome(monthlyTotals, outcome);
          addOutcome(monthlyByPeriod.get(key)!, outcome);
        }
      }
    }

    // ── Quarterly (per club) ──
    const quarters = quarterlyPeriods(start, end, dueDay).filter(
      (period) =>
        (filters.quarter === undefined || period.index === filters.quarter) &&
        (filters.year === undefined || period.year === filters.year),
    );
    const quarterlyTotals = emptyCounts();
    const quarterlyByPeriod = new Map<string, ComplianceCounts>(
      quarters.map((period) => [
        `${period.year}-${period.index}`,
        emptyCounts(),
      ]),
    );

    if (clubIds.length > 0 && quarters.length > 0) {
      const rows = await this.prisma.quarterly_reports.findMany({
        where: {
          club_id: { in: clubIds },
          OR: quarters.map((period) => ({
            year: period.year,
            quarter: period.index,
          })),
        },
        select: { club_id: true, year: true, quarter: true, status: true },
      });
      const submitted = new Set(
        rows
          .filter((row) => CLUB_REPORT_SUBMITTED_STATUSES.has(row.status))
          .map((row) => `${row.club_id}:${row.year}-${row.quarter}`),
      );
      for (const club of clubs.values()) {
        for (const period of quarters) {
          const key = `${period.year}-${period.index}`;
          const outcome = classifyPeriod(
            period,
            submitted.has(`${club.club_id}:${key}`),
            now,
          );
          addOutcome(club.quarterly, outcome);
          addOutcome(quarterlyTotals, outcome);
          addOutcome(quarterlyByPeriod.get(key)!, outcome);
        }
      }
    }

    // ── Annual (per club, the whole ecclesiastical year) ──
    const annualTotals = emptyCounts();
    if (clubIds.length > 0) {
      const yearPeriod = {
        // end_date is a DATE: the year closes when that day is over.
        endsAt: new Date(
          Date.UTC(
            end.getUTCFullYear(),
            end.getUTCMonth(),
            end.getUTCDate() + 1,
          ),
        ),
        dueAt: dueDate(end.getUTCFullYear(), end.getUTCMonth() + 1, dueDay),
      };
      const rows = await this.prisma.annual_reports.findMany({
        where: {
          club_id: { in: clubIds },
          ecclesiastical_year_id: ecclesiasticalYear.year_id,
        },
        select: { club_id: true, status: true },
      });
      const submitted = new Set(
        rows
          .filter((row) => CLUB_REPORT_SUBMITTED_STATUSES.has(row.status))
          .map((row) => row.club_id),
      );
      for (const club of clubs.values()) {
        const outcome = classifyPeriod(
          yearPeriod,
          submitted.has(club.club_id),
          now,
        );
        addOutcome(club.annual, outcome);
        addOutcome(annualTotals, outcome);
      }
    }

    const ordered = [...clubs.values()]
      .map((club) => ({
        ...club,
        sections: [...club.sections].sort(
          (a, b) => a.club_section_id - b.club_section_id,
        ),
      }))
      .sort(
        (a, b) =>
          a.club_name.localeCompare(b.club_name, 'es') || a.club_id - b.club_id,
      );
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(
      Math.max(filters.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const skip = (page - 1) * limit;

    return {
      as_of: now.toISOString(),
      due_day: dueDay,
      ecclesiastical_year: {
        year_id: ecclesiasticalYear.year_id,
        start_date: start,
        end_date: end,
      },
      totals: {
        clubs: ordered.length,
        monthly: {
          ...monthlyTotals,
          by_period: months.map((period) => ({
            year: period.year,
            month: period.index,
            due_at: period.dueAt.toISOString(),
            ...monthlyByPeriod.get(`${period.year}-${period.index}`)!,
          })),
        },
        quarterly: {
          ...quarterlyTotals,
          by_period: quarters.map((period) => ({
            year: period.year,
            quarter: period.index,
            due_at: period.dueAt.toISOString(),
            ...quarterlyByPeriod.get(`${period.year}-${period.index}`)!,
          })),
        },
        annual: annualTotals,
      },
      total: ordered.length,
      page,
      limit,
      items: ordered.slice(skip, skip + limit),
    };
  }

  private validateFilters(filters: ComplianceFilters): void {
    if (
      filters.month !== undefined &&
      (filters.month < 1 || filters.month > 12)
    ) {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_MONTH);
    }
    if (
      filters.quarter !== undefined &&
      (filters.quarter < 1 || filters.quarter > 4)
    ) {
      throw new AppBadRequestException(
        ErrorCode.QUARTERLY_REPORT_INVALID_QUARTER,
      );
    }
  }

  private async resolveEcclesiasticalYear(yearId?: number) {
    const select = { year_id: true, start_date: true, end_date: true };
    const year =
      yearId !== undefined
        ? await this.prisma.ecclesiastical_years.findUnique({
            where: { year_id: yearId },
            select,
          })
        : await this.prisma.ecclesiastical_years.findFirst({
            where: { active: true },
            orderBy: { start_date: 'desc' },
            select,
          });

    if (!year) {
      throw new AppNotFoundException(ErrorCode.ANNUAL_REPORT_YEAR_NOT_FOUND);
    }
    return year;
  }

  private async resolveDueDay(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: DUE_DAY_CONFIG_KEY },
      select: { config_value: true },
    });
    const parsed = config ? Number(config.config_value) : DEFAULT_DUE_DAY;
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 28
      ? parsed
      : DEFAULT_DUE_DAY;
  }
}
