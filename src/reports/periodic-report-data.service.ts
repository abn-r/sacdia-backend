import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceAggregationService } from '../finances/finance-aggregation.service';
import type { FinanceTotals } from '../finances/finance-aggregation.service';
import {
  findPeriodBoard,
  findPeriodMemberIds,
  type PeriodBoardMember,
} from '../common/authorization/periodic-report-people';
import {
  aggregateMonthlyData,
  type PeriodicMonthlyAggregate,
} from './periodic-monthly-data';
import type { ReportPeriod } from './periodic-report-period';

export const FREEZE_GRACE_CONFIG_KEY = 'reports.periodic_freeze_grace_days';
export const DEFAULT_FREEZE_GRACE_DAYS = 15;

/** Parses the grace-days config value; anything but a whole number >= 0 falls back to 15. */
export function parseFreezeGraceDays(raw: string | null | undefined): number {
  const parsed = Number(raw);
  return raw != null &&
    raw.trim() !== '' &&
    Number.isInteger(parsed) &&
    parsed >= 0
    ? parsed
    : DEFAULT_FREEZE_GRACE_DAYS;
}

export interface PeriodicHonorRow {
  user_id: string;
  validate: boolean;
  users: {
    user_id: string;
    name: string | null;
    paternal_last_name: string | null;
  };
}

/** The figures both periodic reports share, computed over one period. */
export interface PeriodicBaseData {
  sectionIds: number[];
  memberCount: number;
  directiva: PeriodBoardMember[];
  honors: PeriodicHonorRow[];
  activitiesTotal: number;
  finance: FinanceTotals;
  monthly: PeriodicMonthlyAggregate;
  /** Distinct camporees the club's sections were registered in. */
  camporeesAttended: number;
}

/**
 * Computes the figures of quarterly and annual reports. One section set (all
 * sections of the club, active or not, as `FinanceAggregationService`) feeds
 * every figure, and every range is half-open.
 */
@Injectable()
export class PeriodicReportDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeAggregation: FinanceAggregationService,
  ) {}

  /** `reports.periodic_freeze_grace_days`, default 15 (invalid values fall back). */
  async getFreezeGraceDays(): Promise<number> {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: FREEZE_GRACE_CONFIG_KEY },
    });
    return parseFreezeGraceDays(config?.config_value);
  }

  getSectionIds(clubId: number): Promise<number[]> {
    return this.financeAggregation.getClubSectionIds(clubId);
  }

  async compute(
    clubId: number,
    period: ReportPeriod,
  ): Promise<PeriodicBaseData> {
    const sectionIds = await this.getSectionIds(clubId);
    const range = {
      startDate: period.startDate,
      endExclusiveDate: period.endExclusiveDate,
    };

    const memberIds = await findPeriodMemberIds(this.prisma, sectionIds, range);
    const [directiva, honors, activitiesTotal, finance, monthly, camporees] =
      await Promise.all([
        findPeriodBoard(this.prisma, sectionIds, range),
        this.getHonors(memberIds, period),
        this.countActivities(sectionIds, period),
        this.financeAggregation.aggregate(sectionIds, {
          from: period.months[0],
          to: period.months[period.months.length - 1],
        }),
        this.getMonthlyData(sectionIds, period),
        this.countCamporees(sectionIds, period),
      ]);

    return {
      sectionIds,
      memberCount: memberIds.length,
      directiva,
      honors,
      activitiesTotal,
      finance,
      monthly,
      camporeesAttended: camporees,
    };
  }

  private async getHonors(
    memberIds: string[],
    period: ReportPeriod,
  ): Promise<PeriodicHonorRow[]> {
    if (memberIds.length === 0) return [];
    return this.prisma.users_honors.findMany({
      where: {
        user_id: { in: memberIds },
        active: true,
        date: { gte: period.startDate, lt: period.endExclusiveDate },
      },
      select: {
        user_id: true,
        validate: true,
        users: {
          select: { user_id: true, name: true, paternal_last_name: true },
        },
      },
    });
  }

  private async countActivities(
    sectionIds: number[],
    period: ReportPeriod,
  ): Promise<number> {
    if (sectionIds.length === 0) return 0;
    return this.prisma.activities.count({
      where: {
        club_section_id: { in: sectionIds },
        created_at: {
          gte: period.startInstant,
          lt: period.endExclusiveInstant,
        },
      },
    });
  }

  /** Submitted monthly reports of the club's sections for the months of the period. */
  private async getMonthlyData(
    sectionIds: number[],
    period: ReportPeriod,
  ): Promise<PeriodicMonthlyAggregate> {
    if (sectionIds.length === 0) return aggregateMonthlyData([]);
    const reports = await this.prisma.monthly_reports.findMany({
      where: {
        status: 'submitted',
        club_enrollment: { club_section_id: { in: sectionIds } },
        OR: period.months.map(({ year, month }) => ({ year, month })),
      },
      select: {
        year: true,
        month: true,
        manual_data: {
          select: {
            planning_meetings: true,
            parent_meetings: true,
            youth_council_attendance: true,
            church_board_attendance: true,
            soul_target: true,
            baptized_this_month: true,
            total_baptized: true,
            club_participation_description: true,
            community_service_description: true,
            certificates_delivered: true,
          },
        },
      },
    });
    return aggregateMonthlyData(reports);
  }

  /**
   * Distinct months of the period with at least one monthly report that is not
   * a draft (generated or submitted) in the club's sections.
   */
  async countReportedMonths(
    sectionIds: number[],
    period: ReportPeriod,
  ): Promise<number> {
    if (sectionIds.length === 0) return 0;
    const reports = await this.prisma.monthly_reports.findMany({
      where: {
        status: { not: 'draft' },
        club_enrollment: { club_section_id: { in: sectionIds } },
        OR: period.months.map(({ year, month }) => ({ year, month })),
      },
      select: { month: true, year: true },
    });
    return new Set(reports.map((r) => `${r.year}-${r.month}`)).size;
  }

  /**
   * Distinct local + union camporees (active) whose start date falls inside
   * the period and in which one of the club's sections holds an active
   * registration (`registered` or `approved`; rejected and cancelled do not
   * count).
   */
  private async countCamporees(
    sectionIds: number[],
    period: ReportPeriod,
  ): Promise<number> {
    if (sectionIds.length === 0) return 0;
    const dates = {
      active: true,
      start_date: { gte: period.startDate, lt: period.endExclusiveDate },
    };
    const rows = await this.prisma.camporee_clubs.findMany({
      where: {
        club_section_id: { in: sectionIds },
        active: true,
        status: { in: ['registered', 'approved'] },
        OR: [
          { local_camporees: { is: dates } },
          { union_camporees: { is: dates } },
        ],
      },
      select: { camporee_id: true, union_camporee_id: true },
    });
    return new Set(
      rows.map((row) =>
        row.camporee_id !== null
          ? `local:${row.camporee_id}`
          : `union:${row.union_camporee_id}`,
      ),
    ).size;
  }
}
