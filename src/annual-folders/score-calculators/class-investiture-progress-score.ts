import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassInvestitureProgressScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    clubEnrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { completed: bigint; total: bigint }[]
    >`
      WITH enrollment_scope AS (
        SELECT ce.club_section_id
        FROM club_enrollments ce
        WHERE ce.club_enrollment_id = ${clubEnrollmentId}::uuid
          AND ce.ecclesiastical_year_id = ${ecclesiasticalYearId}
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
      SELECT
        COUNT(*) FILTER (
          WHERE e.investiture_status::text IN ('APPROVED', 'INVESTIDO')
        )::bigint AS completed,
        COUNT(*)::bigint AS total
      FROM active_members am
      JOIN enrollments e
        ON e.user_id = am.user_id
       AND e.active = true
       AND e.ecclesiastical_year_id = ${ecclesiasticalYearId}
    `;

    const completed = Number(rows[0]?.completed ?? 0n);
    const total = Number(rows[0]?.total ?? 0n);
    if (total <= 0) return 0;

    return this.normalizePercentage((completed / total) * 100);
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
