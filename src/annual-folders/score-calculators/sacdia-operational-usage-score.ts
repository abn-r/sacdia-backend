import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SacdiaOperationalUsageScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    clubEnrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { active_operational_users: bigint; active_section_users: bigint }[]
    >`
      WITH enrollment_scope AS (
        SELECT ce.club_section_id
        FROM club_enrollments ce
        WHERE ce.club_enrollment_id = ${clubEnrollmentId}::uuid
          AND ce.ecclesiastical_year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      year_scope AS (
        SELECT start_date, end_date,
          EXTRACT(YEAR FROM start_date)::int AS start_year,
          EXTRACT(YEAR FROM end_date)::int AS end_year
        FROM ecclesiastical_years
        WHERE year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      active_section_users AS (
        SELECT DISTINCT um.user_id
        FROM enrollment_scope es
        JOIN units u
          ON u.club_section_id = es.club_section_id
         AND u.active = true
        JOIN unit_members um
          ON um.unit_id = u.unit_id
         AND um.active = true
        JOIN users usr
          ON usr.user_id = um.user_id
         AND usr.active = true
        UNION
        SELECT DISTINCT cra.user_id
        FROM enrollment_scope es
        JOIN club_role_assignments cra
          ON cra.club_section_id = es.club_section_id
         AND cra.active = true
         AND COALESCE(cra.status, 'active') = 'active'
         AND cra.ecclesiastical_year_id = ${ecclesiasticalYearId}
        JOIN users usr
          ON usr.user_id = cra.user_id
         AND usr.active = true
      ),
      useful_operational_users AS (
        SELECT DISTINCT wr.user_id
        FROM active_section_users au
        CROSS JOIN year_scope ys
        JOIN weekly_records wr
          ON wr.user_id = au.user_id
         AND wr.active = true
         AND wr.year BETWEEN ys.start_year AND ys.end_year
        UNION
        SELECT DISTINCT e.user_id
        FROM active_section_users au
        JOIN enrollments e
          ON e.user_id = au.user_id
         AND e.active = true
         AND e.ecclesiastical_year_id = ${ecclesiasticalYearId}
        UNION
        SELECT DISTINCT csp.user_id
        FROM active_section_users au
        JOIN class_section_progress csp
          ON csp.user_id = au.user_id
         AND csp.active = true
        JOIN year_scope ys ON TRUE
        WHERE csp.created_at >= ys.start_date
          AND csp.created_at <= ys.end_date
        UNION
        SELECT DISTINCT mr.submitted_by AS user_id
        FROM active_section_users au
        JOIN monthly_reports mr
          ON mr.submitted_by = au.user_id
         AND mr.club_enrollment_id = ${clubEnrollmentId}::uuid
         AND mr.status = 'submitted'
        JOIN year_scope ys ON TRUE
        WHERE mr.submitted_at >= ys.start_date
          AND mr.submitted_at <= ys.end_date
        UNION
        SELECT DISTINCT a.created_by AS user_id
        FROM active_section_users au
        JOIN enrollment_scope es ON TRUE
        JOIN activity_instances ai
          ON ai.club_section_id = es.club_section_id
         AND ai.active = true
        JOIN activities a
          ON a.activity_id = ai.activity_id
         AND a.created_by = au.user_id
         AND a.active = true
        JOIN year_scope ys ON TRUE
        WHERE a.activity_date IS NOT NULL
          AND a.activity_date <= ys.end_date
          AND COALESCE(a.activity_end_date, a.activity_date) >= ys.start_date
      )
      SELECT
        COUNT(DISTINCT uou.user_id)::bigint AS active_operational_users,
        COUNT(DISTINCT asu.user_id)::bigint AS active_section_users
      FROM active_section_users asu
      LEFT JOIN useful_operational_users uou ON uou.user_id = asu.user_id
    `;

    const activeOperationalUsers = Number(
      rows[0]?.active_operational_users ?? 0n,
    );
    const activeSectionUsers = Number(rows[0]?.active_section_users ?? 0n);
    if (activeSectionUsers <= 0) return 0;

    return this.normalizePercentage(
      (activeOperationalUsers / activeSectionUsers) * 100,
    );
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
