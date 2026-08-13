import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  buildReportClubSectionWhere,
  needsCoordinatorReportSections,
  resolveReportVisibilityScope,
} from '../reports/report-visibility-scope';
import type {
  ActivityWindowCountsDto,
  ClassMemberCountDto,
  ClubTypeHonorCountsDto,
  ClubTypeMemberBreakdownDto,
  LocalFieldDashboardDto,
  TimeWindowCountsDto,
} from './dto/local-field-dashboard.dto';

const TARGET_CLUB_TYPE_IDS = [1, 2, 3] as const;

type CacheEntry<T> = { data: T; expiresAt: number };

@Injectable()
export class LocalFieldDashboardService {
  private readonly cache = new Map<
    string,
    CacheEntry<LocalFieldDashboardDto>
  >();
  private readonly CACHE_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
  ) {}

  async getDashboard(
    userId: string,
    requestedLocalFieldId?: number,
  ): Promise<LocalFieldDashboardDto> {
    const localFieldId = await this.resolveLocalFieldId(
      userId,
      requestedLocalFieldId,
    );

    const cacheKey = `lf-dashboard:${localFieldId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { ...cached.data, cached: true };
    }

    const data = await this.computeDashboard(localFieldId);
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + this.CACHE_TTL_MS,
    });

    return { ...data, cached: false };
  }

  private async resolveLocalFieldId(
    userId: string,
    requestedLocalFieldId?: number,
  ): Promise<number> {
    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);

    if (needsCoordinatorReportSections(resolved)) {
      const coordinatorScope =
        await this.coordinationService.resolveCoordinatorScope(userId);
      const generalFieldIds = [
        ...new Set(
          coordinatorScope.assignments
            .filter((assignment) => assignment.assignment_type === 'GENERAL')
            .map((assignment) => assignment.local_field_id),
        ),
      ];

      if (
        requestedLocalFieldId !== undefined &&
        generalFieldIds.includes(requestedLocalFieldId)
      ) {
        return requestedLocalFieldId;
      }

      if (requestedLocalFieldId === undefined && generalFieldIds.length === 1) {
        return generalFieldIds[0];
      }

      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const scope = resolveReportVisibilityScope(resolved, {
      localFieldId: requestedLocalFieldId,
    });

    if (scope.access === 'local_field') {
      return scope.localFieldId;
    }

    if (scope.access === 'all' && requestedLocalFieldId !== undefined) {
      return requestedLocalFieldId;
    }

    if (scope.access === 'union' && requestedLocalFieldId !== undefined) {
      const field = await this.prisma.local_fields.findFirst({
        where: {
          local_field_id: requestedLocalFieldId,
          union_id: scope.unionId,
        },
        select: { local_field_id: true },
      });

      if (!field) {
        throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
      }

      return requestedLocalFieldId;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  private async computeDashboard(
    localFieldId: number,
  ): Promise<LocalFieldDashboardDto> {
    const now = new Date();
    const reportYear = now.getFullYear();
    const reportMonth = now.getMonth() + 1;

    const [localField, activeYear, clubTypes] = await Promise.all([
      this.prisma.local_fields.findUnique({
        where: { local_field_id: localFieldId },
        select: { local_field_id: true, name: true },
      }),
      this.prisma.ecclesiastical_years.findFirst({
        where: { active: true },
        orderBy: { start_date: 'desc' },
        select: { year_id: true, start_date: true, end_date: true },
      }),
      this.prisma.club_types.findMany({
        where: { club_type_id: { in: [...TARGET_CLUB_TYPE_IDS] } },
        select: { club_type_id: true, name: true },
        orderBy: { club_type_id: 'asc' },
      }),
    ]);

    if (!localField) {
      throw new AppForbiddenException(ErrorCode.ADMIN_LOCAL_FIELD_NOT_FOUND);
    }

    const yearId = activeYear?.year_id ?? 0;
    const yearLabel = activeYear
      ? `${activeYear.start_date.getUTCFullYear()}-${activeYear.end_date.getUTCFullYear()}`
      : null;

    const sectionScope = buildReportClubSectionWhere({
      access: 'local_field',
      localFieldId,
    });

    const [
      activeMembers,
      activeClubs,
      enrollmentStats,
      reportStats,
      classRows,
      honorRows,
      activityRows,
    ] = await Promise.all([
      this.countActiveMembers(localFieldId),
      this.prisma.clubs.count({
        where: { local_field_id: localFieldId, active: true },
      }),
      this.countEnrollmentsThisYear(sectionScope, yearId),
      this.countMonthlyReportCoverage(
        sectionScope,
        yearId,
        reportYear,
        reportMonth,
      ),
      yearId > 0
        ? this.countMembersByClass(localFieldId, yearId)
        : Promise.resolve([]),
      this.countHonorsCompleted(localFieldId),
      this.countActivities(localFieldId),
    ]);

    const clubTypeNameById = new Map(
      clubTypes.map((type) => [type.club_type_id, type.name]),
    );

    const membersByClubType = this.buildMembersByClubType(
      classRows,
      clubTypeNameById,
    );
    const honorsCompletedByClubType = this.buildHonorsByClubType(
      honorRows,
      clubTypeNameById,
    );

    return {
      local_field_id: localField.local_field_id,
      local_field_name: localField.name,
      ecclesiastical_year_id: yearId,
      ecclesiastical_year_label: yearLabel,
      report_year: reportYear,
      report_month: reportMonth,
      active_members: activeMembers,
      active_clubs: activeClubs,
      enrolled_clubs_this_year: enrollmentStats.clubs,
      enrolled_sections_this_year: enrollmentStats.sections,
      clubs_with_monthly_report: reportStats.withReport,
      clubs_without_monthly_report: reportStats.withoutReport,
      members_by_club_type: membersByClubType,
      honors_completed_by_club_type: honorsCompletedByClubType,
      honors_completed_total: this.sumHonorWindows(honorRows),
      activities: activityRows,
      cached: false,
    };
  }

  private async countActiveMembers(localFieldId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(DISTINCT um.user_id)::bigint AS count
      FROM unit_members um
      INNER JOIN units u ON u.unit_id = um.unit_id AND u.active = true
      INNER JOIN club_sections cs ON cs.club_section_id = u.club_section_id AND cs.active = true
      INNER JOIN clubs c ON c.club_id = cs.main_club_id AND c.active = true
      WHERE um.active = true
        AND c.local_field_id = ${localFieldId}
    `;

    return Number(rows[0]?.count ?? 0);
  }

  private async countEnrollmentsThisYear(
    sectionScope: Prisma.club_sectionsWhereInput,
    yearId: number,
  ): Promise<{ clubs: number; sections: number }> {
    if (yearId <= 0) {
      return { clubs: 0, sections: 0 };
    }

    const enrollments = await this.prisma.club_enrollments.findMany({
      where: {
        ecclesiastical_year_id: yearId,
        status: 'active',
        club_section: sectionScope,
      },
      select: {
        club_section: {
          select: { main_club_id: true },
        },
      },
    });

    const clubIds = new Set<number>();
    for (const enrollment of enrollments) {
      const clubId = enrollment.club_section?.main_club_id;
      if (typeof clubId === 'number') clubIds.add(clubId);
    }

    return { clubs: clubIds.size, sections: enrollments.length };
  }

  private async countMonthlyReportCoverage(
    sectionScope: Prisma.club_sectionsWhereInput,
    yearId: number,
    reportYear: number,
    reportMonth: number,
  ): Promise<{ withReport: number; withoutReport: number }> {
    if (yearId <= 0) {
      return { withReport: 0, withoutReport: 0 };
    }

    const enrollments = await this.prisma.club_enrollments.findMany({
      where: {
        ecclesiastical_year_id: yearId,
        status: 'active',
        club_section: sectionScope,
      },
      select: {
        club_enrollment_id: true,
        club_section: { select: { main_club_id: true } },
        monthly_reports: {
          where: {
            year: reportYear,
            month: reportMonth,
            status: { in: ['generated', 'submitted'] },
          },
          select: { monthly_report_id: true },
          take: 1,
        },
      },
    });

    const clubsWithReport = new Set<number>();
    const clubsWithoutReport = new Set<number>();

    for (const enrollment of enrollments) {
      const clubId = enrollment.club_section?.main_club_id;
      if (typeof clubId !== 'number') continue;

      if (enrollment.monthly_reports.length > 0) {
        clubsWithReport.add(clubId);
        clubsWithoutReport.delete(clubId);
      } else if (!clubsWithReport.has(clubId)) {
        clubsWithoutReport.add(clubId);
      }
    }

    return {
      withReport: clubsWithReport.size,
      withoutReport: clubsWithoutReport.size,
    };
  }

  private async countMembersByClass(
    localFieldId: number,
    yearId: number,
  ): Promise<
    Array<{
      club_type_id: number;
      class_id: number;
      class_name: string;
      display_order: number;
      member_count: number;
    }>
  > {
    return this.prisma.$queryRaw`
      SELECT
        cl.club_type_id,
        cl.class_id,
        cl.name AS class_name,
        cl.display_order,
        COUNT(*)::int AS member_count
      FROM enrollments e
      INNER JOIN classes cl ON cl.class_id = e.class_id
      WHERE e.active = true
        AND e.ecclesiastical_year_id = ${yearId}
        AND cl.club_type_id IN (1, 2, 3)
        AND EXISTS (
          SELECT 1
          FROM unit_members um
          INNER JOIN units u ON u.unit_id = um.unit_id AND u.active = true
          INNER JOIN club_sections cs ON cs.club_section_id = u.club_section_id AND cs.active = true
          INNER JOIN clubs c ON c.club_id = cs.main_club_id AND c.active = true
          WHERE um.user_id = e.user_id
            AND um.active = true
            AND c.local_field_id = ${localFieldId}
            AND cs.club_type_id = cl.club_type_id
        )
      GROUP BY cl.club_type_id, cl.class_id, cl.name, cl.display_order
      ORDER BY cl.club_type_id ASC, cl.display_order ASC, cl.name ASC
    `;
  }

  private async countHonorsCompleted(localFieldId: number): Promise<
    Array<{
      club_type_id: number;
      last_7_days: number;
      last_30_days: number;
      last_90_days: number;
    }>
  > {
    return this.prisma.$queryRaw`
      SELECT
        h.club_type_id,
        COUNT(*) FILTER (
          WHERE uh.validated_at >= NOW() - INTERVAL '7 days'
        )::int AS last_7_days,
        COUNT(*) FILTER (
          WHERE uh.validated_at >= NOW() - INTERVAL '30 days'
        )::int AS last_30_days,
        COUNT(*) FILTER (
          WHERE uh.validated_at >= NOW() - INTERVAL '90 days'
        )::int AS last_90_days
      FROM users_honors uh
      INNER JOIN honors h ON h.honor_id = uh.honor_id
      WHERE uh.active = true
        AND uh.validation_status = 'APPROVED'::honor_validation_status_enum
        AND uh.validated_at IS NOT NULL
        AND h.club_type_id IN (1, 2, 3)
        AND EXISTS (
          SELECT 1
          FROM unit_members um
          INNER JOIN units u ON u.unit_id = um.unit_id AND u.active = true
          INNER JOIN club_sections cs ON cs.club_section_id = u.club_section_id AND cs.active = true
          INNER JOIN clubs c ON c.club_id = cs.main_club_id AND c.active = true
          WHERE um.user_id = uh.user_id
            AND um.active = true
            AND c.local_field_id = ${localFieldId}
            AND cs.club_type_id = h.club_type_id
        )
      GROUP BY h.club_type_id
      ORDER BY h.club_type_id ASC
    `;
  }

  private async countActivities(
    localFieldId: number,
  ): Promise<ActivityWindowCountsDto> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        last_7_days: number;
        last_30_days: number;
        last_365_days: number;
      }>
    >`
      SELECT
        COUNT(*) FILTER (
          WHERE a.activity_date >= CURRENT_DATE - INTERVAL '7 days'
        )::int AS last_7_days,
        COUNT(*) FILTER (
          WHERE a.activity_date >= CURRENT_DATE - INTERVAL '30 days'
        )::int AS last_30_days,
        COUNT(*) FILTER (
          WHERE a.activity_date >= CURRENT_DATE - INTERVAL '365 days'
        )::int AS last_365_days
      FROM activities a
      INNER JOIN club_sections cs ON cs.club_section_id = a.club_section_id
      INNER JOIN clubs c ON c.club_id = cs.main_club_id
      WHERE a.active = true
        AND a.activity_date IS NOT NULL
        AND c.local_field_id = ${localFieldId}
    `;

    const row = rows[0];
    return {
      last_7_days: row?.last_7_days ?? 0,
      last_30_days: row?.last_30_days ?? 0,
      last_365_days: row?.last_365_days ?? 0,
    };
  }

  private buildMembersByClubType(
    rows: Array<{
      club_type_id: number;
      class_id: number;
      class_name: string;
      display_order: number;
      member_count: number;
    }>,
    clubTypeNameById: Map<number, string>,
  ): ClubTypeMemberBreakdownDto[] {
    const grouped = new Map<number, ClassMemberCountDto[]>();

    for (const row of rows) {
      const classes = grouped.get(row.club_type_id) ?? [];
      classes.push({
        class_id: row.class_id,
        class_name: row.class_name,
        display_order: row.display_order,
        member_count: row.member_count,
      });
      grouped.set(row.club_type_id, classes);
    }

    return TARGET_CLUB_TYPE_IDS.map((clubTypeId) => ({
      club_type_id: clubTypeId,
      club_type_name:
        clubTypeNameById.get(clubTypeId) ?? `Club type ${clubTypeId}`,
      classes: grouped.get(clubTypeId) ?? [],
    }));
  }

  private buildHonorsByClubType(
    rows: Array<{
      club_type_id: number;
      last_7_days: number;
      last_30_days: number;
      last_90_days: number;
    }>,
    clubTypeNameById: Map<number, string>,
  ): ClubTypeHonorCountsDto[] {
    const byType = new Map(rows.map((row) => [row.club_type_id, row]));

    return TARGET_CLUB_TYPE_IDS.map((clubTypeId) => {
      const row = byType.get(clubTypeId);
      return {
        club_type_id: clubTypeId,
        club_type_name:
          clubTypeNameById.get(clubTypeId) ?? `Club type ${clubTypeId}`,
        completed: {
          last_7_days: row?.last_7_days ?? 0,
          last_30_days: row?.last_30_days ?? 0,
          last_90_days: row?.last_90_days ?? 0,
        },
      };
    });
  }

  private sumHonorWindows(
    rows: Array<{
      last_7_days: number;
      last_30_days: number;
      last_90_days: number;
    }>,
  ): TimeWindowCountsDto {
    return rows.reduce(
      (acc, row) => ({
        last_7_days: acc.last_7_days + row.last_7_days,
        last_30_days: acc.last_30_days + row.last_30_days,
        last_90_days: acc.last_90_days + row.last_90_days,
      }),
      { last_7_days: 0, last_30_days: 0, last_90_days: 0 },
    );
  }
}
