import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ActivitiesMetricRow,
  AdministrativeMetricRow,
  ClassMetricRow,
  DashboardChildNode,
  EcclesiasticalYearRecord,
  HonorsMetricRow,
  MonthlyReportsMetricRow,
  OperationsDashboardRawSnapshot,
  OperationsMetricRow,
  PeopleMetricRow,
  QueuesMetricRow,
  ReportingMonth,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

type LoadSnapshotInput = {
  scope: ResolvedOperationsDashboardScope;
  ecclesiasticalYear: EcclesiasticalYearRecord;
  reportingMonth: ReportingMonth | null;
  includeHonors: boolean;
};

const YEAR_SELECT = {
  year_id: true,
  start_date: true,
  end_date: true,
  active: true,
} as const;

@Injectable()
export class OperationsDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveEcclesiasticalYear(): Promise<EcclesiasticalYearRecord | null> {
    return this.prisma.ecclesiastical_years.findFirst({
      where: { active: true },
      orderBy: { start_date: 'desc' },
      select: YEAR_SELECT,
    });
  }

  findEcclesiasticalYearById(
    yearId: number,
  ): Promise<EcclesiasticalYearRecord | null> {
    return this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
      select: YEAR_SELECT,
    });
  }

  async loadSnapshot({
    scope,
    ecclesiasticalYear,
    reportingMonth,
    includeHonors,
  }: LoadSnapshotInput): Promise<OperationsDashboardRawSnapshot> {
    const bucket = this.bucketExpression(scope);
    const scopePredicate = this.scopePredicate(scope);
    const enrollmentStatusPredicate =
      this.enrollmentStatusPredicate(ecclesiasticalYear);

    const honorsPromise = includeHonors
      ? this.loadHonors(bucket, scopePredicate, ecclesiasticalYear.year_id)
      : Promise.resolve([] as HonorsMetricRow[]);
    const monthlyReportsPromise = reportingMonth
      ? this.loadMonthlyReports(
          bucket,
          scopePredicate,
          ecclesiasticalYear.year_id,
          reportingMonth,
          enrollmentStatusPredicate,
        )
      : Promise.resolve([] as MonthlyReportsMetricRow[]);

    const [
      children,
      administrative,
      operations,
      people,
      classes,
      monthlyReports,
      honors,
      activities,
      queues,
    ] = await Promise.all([
      this.loadChildren(scope),
      this.loadAdministrativeClubs(bucket, scopePredicate),
      this.loadOperations(
        bucket,
        scopePredicate,
        ecclesiasticalYear.year_id,
        enrollmentStatusPredicate,
      ),
      this.loadPeople(bucket, scopePredicate, ecclesiasticalYear.year_id),
      this.loadClasses(bucket, scopePredicate, ecclesiasticalYear.year_id),
      monthlyReportsPromise,
      honorsPromise,
      this.loadActivities(
        bucket,
        scopePredicate,
        ecclesiasticalYear,
        enrollmentStatusPredicate,
      ),
      this.loadQueues(
        bucket,
        scopePredicate,
        ecclesiasticalYear,
        includeHonors,
        enrollmentStatusPredicate,
      ),
    ]);

    return {
      children,
      administrative,
      operations,
      people,
      classes,
      monthlyReports,
      honors,
      activities,
      queues,
    };
  }

  private loadChildren(
    scope: ResolvedOperationsDashboardScope,
  ): Promise<DashboardChildNode[]> {
    switch (scope.level) {
      case 'all':
        return this.prisma.$queryRaw<DashboardChildNode[]>(Prisma.sql`
          SELECT d.division_id AS id, d.name
          FROM divisions d
          ORDER BY d.name ASC, d.division_id ASC
        `);
      case 'division':
        return this.prisma.$queryRaw<DashboardChildNode[]>(Prisma.sql`
          SELECT u.union_id AS id, u.name
          FROM unions u
          WHERE u.division_id = ${scope.id}
          ORDER BY u.name ASC, u.union_id ASC
        `);
      case 'union':
        return this.prisma.$queryRaw<DashboardChildNode[]>(Prisma.sql`
          SELECT lf.local_field_id AS id, lf.name
          FROM local_fields lf
          WHERE lf.union_id = ${scope.id}
          ORDER BY lf.name ASC, lf.local_field_id ASC
        `);
      case 'local_field':
        return this.prisma.$queryRaw<DashboardChildNode[]>(Prisma.sql`
          SELECT c.club_id AS id, c.name
          FROM clubs c
          WHERE c.local_field_id = ${scope.id}
          ORDER BY c.name ASC, c.club_id ASC
        `);
    }
  }

  private loadAdministrativeClubs(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
  ): Promise<AdministrativeMetricRow[]> {
    return this.prisma.$queryRaw<AdministrativeMetricRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket_id,
        COUNT(DISTINCT c.club_id)::int AS total,
        COUNT(DISTINCT c.club_id) FILTER (WHERE c.active = true)::int AS active,
        COUNT(DISTINCT c.club_id) FILTER (WHERE c.active = false)::int AS inactive
      FROM clubs c
      INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      INNER JOIN unions u ON u.union_id = lf.union_id
      INNER JOIN divisions d ON d.division_id = u.division_id
      WHERE ${scopePredicate}
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY ${bucket} NULLS FIRST
    `);
  }

  private loadOperations(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    yearId: number,
    enrollmentStatusPredicate: Prisma.Sql,
  ): Promise<OperationsMetricRow[]> {
    return this.prisma.$queryRaw<OperationsMetricRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket_id,
        COUNT(DISTINCT c.club_id)::int AS operational_clubs,
        COUNT(DISTINCT cs.club_section_id)::int AS operational_sections
      FROM club_enrollments ce
      INNER JOIN club_sections cs ON cs.club_section_id = ce.club_section_id
      INNER JOIN clubs c ON c.club_id = cs.main_club_id
      INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      INNER JOIN unions u ON u.union_id = lf.union_id
      INNER JOIN divisions d ON d.division_id = u.division_id
      WHERE ce.ecclesiastical_year_id = ${yearId}
        AND ${enrollmentStatusPredicate}
        AND ${scopePredicate}
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY ${bucket} NULLS FIRST
    `);
  }

  private loadPeople(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    yearId: number,
  ): Promise<PeopleMetricRow[]> {
    return this.prisma.$queryRaw<PeopleMetricRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket_id,
        COUNT(DISTINCT cra.user_id)::int AS institutionally_active,
        COUNT(DISTINCT cra.user_id) FILTER (WHERE usr.active = true)::int AS platform_active,
        COUNT(DISTINCT cra.user_id) FILTER (WHERE usr.active = false)::int AS platform_inactive
      FROM club_role_assignments cra
      INNER JOIN users usr ON usr.user_id = cra.user_id
      INNER JOIN club_sections cs ON cs.club_section_id = cra.club_section_id
      INNER JOIN clubs c ON c.club_id = cs.main_club_id
      INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      INNER JOIN unions u ON u.union_id = lf.union_id
      INNER JOIN divisions d ON d.division_id = u.division_id
      WHERE cra.ecclesiastical_year_id = ${yearId}
        AND cra.active = true
        AND cra.status = 'active'
        AND ${scopePredicate}
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY ${bucket} NULLS FIRST
    `);
  }

  private loadClasses(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    yearId: number,
  ): Promise<ClassMetricRow[]> {
    return this.prisma.$queryRaw<ClassMetricRow[]>(Prisma.sql`
      WITH scoped_enrollments AS (
        SELECT DISTINCT
          e.enrollment_id,
          e.user_id,
          cl.class_id,
          cl.name AS class_name,
          cl.club_type_id,
          ct.name AS club_type_name,
          cl.display_order,
          ${bucket} AS bucket_id
        FROM enrollments e
        INNER JOIN classes cl ON cl.class_id = e.class_id
        INNER JOIN club_types ct ON ct.club_type_id = cl.club_type_id
        INNER JOIN club_role_assignments cra
          ON cra.user_id = e.user_id
          AND cra.ecclesiastical_year_id = e.ecclesiastical_year_id
          AND cra.active = true
          AND cra.status = 'active'
        INNER JOIN club_sections cs
          ON cs.club_section_id = cra.club_section_id
          AND cs.club_type_id = cl.club_type_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE e.ecclesiastical_year_id = ${yearId}
          AND e.active = true
          AND ${scopePredicate}
      )
      SELECT
        bucket_id,
        class_id,
        class_name,
        club_type_id,
        club_type_name,
        display_order,
        COUNT(DISTINCT enrollment_id)::int AS enrollment_count,
        COUNT(DISTINCT user_id)::int AS distinct_people
      FROM scoped_enrollments
      GROUP BY GROUPING SETS (
        (),
        (bucket_id),
        (class_id, class_name, club_type_id, club_type_name, display_order),
        (bucket_id, class_id, class_name, club_type_id, club_type_name, display_order)
      )
      ORDER BY bucket_id NULLS FIRST, club_type_id NULLS FIRST,
        display_order NULLS FIRST, class_name NULLS FIRST, class_id NULLS FIRST
    `);
  }

  private loadMonthlyReports(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    yearId: number,
    reportingMonth: ReportingMonth,
    enrollmentStatusPredicate: Prisma.Sql,
  ): Promise<MonthlyReportsMetricRow[]> {
    return this.prisma.$queryRaw<MonthlyReportsMetricRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket_id,
        COUNT(DISTINCT ce.club_enrollment_id)::int AS expected_sections,
        COUNT(DISTINCT ce.club_enrollment_id)
          FILTER (WHERE mr.status = 'submitted')::int AS submitted_sections,
        COUNT(DISTINCT ce.club_enrollment_id)
          FILTER (WHERE mr.status = 'draft')::int AS draft_sections,
        COUNT(DISTINCT ce.club_enrollment_id)
          FILTER (WHERE mr.status = 'generated')::int AS generated_sections,
        COUNT(DISTINCT ce.club_enrollment_id)
          FILTER (WHERE mr.monthly_report_id IS NULL)::int AS missing_sections
      FROM club_enrollments ce
      INNER JOIN club_sections cs ON cs.club_section_id = ce.club_section_id
      INNER JOIN clubs c ON c.club_id = cs.main_club_id
      INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      INNER JOIN unions u ON u.union_id = lf.union_id
      INNER JOIN divisions d ON d.division_id = u.division_id
      LEFT JOIN monthly_reports mr
        ON mr.club_enrollment_id = ce.club_enrollment_id
        AND mr.year = ${reportingMonth.year}
        AND mr.month = ${reportingMonth.month}
      WHERE ce.ecclesiastical_year_id = ${yearId}
        AND ${enrollmentStatusPredicate}
        AND ${scopePredicate}
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY ${bucket} NULLS FIRST
    `);
  }

  private loadHonors(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    yearId: number,
  ): Promise<HonorsMetricRow[]> {
    return this.prisma.$queryRaw<HonorsMetricRow[]>(Prisma.sql`
      WITH scoped_people AS (
        SELECT DISTINCT cra.user_id, ${bucket} AS bucket_id
        FROM club_role_assignments cra
        INNER JOIN club_sections cs ON cs.club_section_id = cra.club_section_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE cra.ecclesiastical_year_id = ${yearId}
          AND cra.active = true
          AND cra.status = 'active'
          AND ${scopePredicate}
      )
      SELECT
        sp.bucket_id,
        COUNT(DISTINCT uh.user_honor_id)
          FILTER (WHERE uh.validation_status = 'IN_PROGRESS')::int AS in_progress,
        COUNT(DISTINCT uh.user_honor_id)
          FILTER (WHERE uh.validation_status = 'PENDING_REVIEW')::int AS pending_review,
        COUNT(DISTINCT uh.user_honor_id)
          FILTER (WHERE uh.validation_status = 'APPROVED')::int AS approved
      FROM scoped_people sp
      INNER JOIN users_honors uh ON uh.user_id = sp.user_id AND uh.active = true
      GROUP BY GROUPING SETS ((sp.bucket_id), ())
      ORDER BY sp.bucket_id NULLS FIRST
    `);
  }

  private loadActivities(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    year: EcclesiasticalYearRecord,
    enrollmentStatusPredicate: Prisma.Sql,
  ): Promise<ActivitiesMetricRow[]> {
    return this.prisma.$queryRaw<ActivitiesMetricRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket_id,
        COUNT(DISTINCT a.activity_id)::int AS registered,
        COUNT(DISTINCT a.activity_id)
          FILTER (WHERE a.is_joint = true)::int AS joint_registered,
        COUNT(DISTINCT ai.club_section_id)::int AS distinct_participating_sections
      FROM activities a
      INNER JOIN activity_instances ai
        ON ai.activity_id = a.activity_id
        AND ai.active = true
      INNER JOIN club_sections cs ON cs.club_section_id = ai.club_section_id
      INNER JOIN club_enrollments ce
        ON ce.club_section_id = cs.club_section_id
        AND ce.ecclesiastical_year_id = ${year.year_id}
        AND ${enrollmentStatusPredicate}
      INNER JOIN clubs c ON c.club_id = cs.main_club_id
      INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
      INNER JOIN unions u ON u.union_id = lf.union_id
      INNER JOIN divisions d ON d.division_id = u.division_id
      WHERE a.active = true
        AND a.activity_date >= ${year.start_date}
        AND a.activity_date <= ${year.end_date}
        AND ${scopePredicate}
      GROUP BY GROUPING SETS ((${bucket}), ())
      ORDER BY ${bucket} NULLS FIRST
    `);
  }

  private loadQueues(
    bucket: Prisma.Sql,
    scopePredicate: Prisma.Sql,
    year: EcclesiasticalYearRecord,
    includeHonors: boolean,
    enrollmentStatusPredicate: Prisma.Sql,
  ): Promise<QueuesMetricRow[]> {
    const honorsQueue = includeHonors
      ? Prisma.sql`
        UNION ALL

        SELECT DISTINCT
          'honors_review_pending'::text AS metric,
          uh.user_honor_id::text AS item_id,
          ${bucket} AS bucket_id
        FROM users_honors uh
        INNER JOIN club_role_assignments cra
          ON cra.user_id = uh.user_id
          AND cra.ecclesiastical_year_id = ${year.year_id}
          AND cra.active = true
          AND cra.status = 'active'
        INNER JOIN club_sections cs ON cs.club_section_id = cra.club_section_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE uh.validation_status = 'PENDING_REVIEW'
          AND uh.active = true
          AND uh.submitted_at IS NOT NULL
          AND ${scopePredicate}
      `
      : Prisma.empty;

    return this.prisma.$queryRaw<QueuesMetricRow[]>(Prisma.sql`
      WITH queue_items AS (
        SELECT DISTINCT
          'role_assignments_pending'::text AS metric,
          rar.request_id::text AS item_id,
          ${bucket} AS bucket_id
        FROM role_assignment_requests rar
        INNER JOIN club_sections cs ON cs.club_section_id = rar.club_section_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE rar.status = 'pending' AND ${scopePredicate}

        UNION ALL

        SELECT DISTINCT
          'transfers_pending'::text AS metric,
          ctr.transfer_request_id::text AS item_id,
          ${bucket} AS bucket_id
        FROM club_transfer_requests ctr
        INNER JOIN club_sections cs ON cs.club_section_id = ctr.to_section_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE ctr.status = 'pending' AND ${scopePredicate}

        UNION ALL

        SELECT DISTINCT
          'class_validations_pending'::text AS metric,
          csp.section_progress_id::text AS item_id,
          ${bucket} AS bucket_id
        FROM class_section_progress csp
        INNER JOIN enrollments e
          ON e.enrollment_id = csp.enrollment_id
          AND e.user_id = csp.user_id
          AND e.class_id = csp.class_id
          AND e.ecclesiastical_year_id = ${year.year_id}
          AND e.active = true
        INNER JOIN classes cl ON cl.class_id = e.class_id
        INNER JOIN club_role_assignments cra
          ON cra.user_id = e.user_id
          AND cra.ecclesiastical_year_id = ${year.year_id}
          AND cra.active = true
          AND cra.status = 'active'
        INNER JOIN club_sections cs
          ON cs.club_section_id = cra.club_section_id
          AND cs.club_type_id = cl.club_type_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE csp.status = 'SUBMITTED'
          AND csp.active = true
          AND csp.submitted_at IS NOT NULL
          AND ${scopePredicate}

        ${honorsQueue}

        UNION ALL

        SELECT DISTINCT
          'annual_folders_pending_union'::text AS metric,
          af.annual_folder_id::text AS item_id,
          ${bucket} AS bucket_id
        FROM annual_folder_section_evaluations afse
        INNER JOIN annual_folders af
          ON af.annual_folder_id = afse.annual_folder_id
          AND af.requires_union_confirmation = true
          INNER JOIN club_enrollments ce
            ON ce.club_enrollment_id = af.club_enrollment_id
            AND ce.ecclesiastical_year_id = ${year.year_id}
            AND ${enrollmentStatusPredicate}
        INNER JOIN club_sections cs ON cs.club_section_id = ce.club_section_id
        INNER JOIN clubs c ON c.club_id = cs.main_club_id
        INNER JOIN local_fields lf ON lf.local_field_id = c.local_field_id
        INNER JOIN unions u ON u.union_id = lf.union_id
        INNER JOIN divisions d ON d.division_id = u.division_id
        WHERE afse.status = 'PREAPPROVED_LF' AND ${scopePredicate}
      )
      SELECT
        bucket_id,
        COUNT(DISTINCT item_id)
          FILTER (WHERE metric = 'role_assignments_pending')::int AS role_assignments_pending,
        COUNT(DISTINCT item_id)
          FILTER (WHERE metric = 'transfers_pending')::int AS transfers_pending,
        COUNT(DISTINCT item_id)
          FILTER (WHERE metric = 'class_validations_pending')::int AS class_validations_pending,
        COUNT(DISTINCT item_id)
          FILTER (WHERE metric = 'honors_review_pending')::int AS honors_review_pending,
        COUNT(DISTINCT item_id)
          FILTER (WHERE metric = 'annual_folders_pending_union')::int AS annual_folders_pending_union
      FROM queue_items
      GROUP BY GROUPING SETS ((bucket_id), ())
      ORDER BY bucket_id NULLS FIRST
    `);
  }

  private bucketExpression(
    scope: ResolvedOperationsDashboardScope,
  ): Prisma.Sql {
    switch (scope.level) {
      case 'all':
        return Prisma.sql`d.division_id`;
      case 'division':
        return Prisma.sql`u.union_id`;
      case 'union':
        return Prisma.sql`lf.local_field_id`;
      case 'local_field':
        return Prisma.sql`c.club_id`;
    }
  }

  private scopePredicate(scope: ResolvedOperationsDashboardScope): Prisma.Sql {
    switch (scope.level) {
      case 'all':
        return Prisma.sql`TRUE`;
      case 'division':
        return Prisma.sql`d.division_id = ${scope.id}`;
      case 'union':
        return Prisma.sql`u.union_id = ${scope.id}`;
      case 'local_field':
        return Prisma.sql`lf.local_field_id = ${scope.id}`;
    }
  }

  private enrollmentStatusPredicate(
    year: EcclesiasticalYearRecord,
  ): Prisma.Sql {
    return year.active
      ? Prisma.sql`ce.status = 'active'`
      : Prisma.sql`ce.status IN ('active', 'closed')`;
  }
}
