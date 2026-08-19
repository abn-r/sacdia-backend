import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AttendanceParticipationScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    clubEnrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ score_pct: number | null }[]>`
      WITH enrollment_scope AS (
        SELECT ce.club_section_id
        FROM club_enrollments ce
        WHERE ce.club_enrollment_id = ${clubEnrollmentId}::uuid
          AND ce.ecclesiastical_year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      year_scope AS (
        SELECT
          EXTRACT(YEAR FROM start_date)::int AS start_year,
          EXTRACT(YEAR FROM end_date)::int AS end_year
        FROM ecclesiastical_years
        WHERE year_id = ${ecclesiasticalYearId}
        LIMIT 1
      ),
      active_members AS (
        SELECT DISTINCT um.user_id
        FROM enrollment_scope es
        JOIN units u
          ON u.club_section_id = es.club_section_id
         AND u.active = true
        JOIN unit_members um
          ON um.unit_id = u.unit_id
         AND um.active = true
      )
      SELECT AVG(wr.attendance)::float AS score_pct
      FROM active_members am
      CROSS JOIN year_scope ys
      JOIN weekly_records wr
        ON wr.user_id = am.user_id
       AND wr.active = true
       AND wr.year BETWEEN ys.start_year AND ys.end_year
    `;

    return this.normalizePercentage(Number(rows[0]?.score_pct ?? 0));
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
