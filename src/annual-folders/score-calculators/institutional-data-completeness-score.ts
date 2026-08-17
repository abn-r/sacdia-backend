import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InstitutionalDataCompletenessScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(clubEnrollmentId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { completed: number; total: number }[]
    >`
      SELECT
        (
          CASE WHEN COALESCE(NULLIF(BTRIM(ce.address), ''), NULLIF(BTRIM(cs.address), '')) IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN ce.meeting_days IS NOT NULL
                  OR ce.meeting_schedule IS NOT NULL
                  OR array_length(cs.meeting_day, 1) IS NOT NULL
                  OR array_length(cs.meeting_time, 1) IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN ce.director_id IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN ce.secretary_id IS NOT NULL OR ce.secretary_treasurer_id IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN ce.treasurer_id IS NOT NULL OR ce.secretary_treasurer_id IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN NULLIF(BTRIM(cs.phone), '') IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN NULLIF(BTRIM(cs.email), '') IS NOT NULL THEN 1 ELSE 0 END +
          CASE WHEN (ce.latitude IS NOT NULL AND ce.longitude IS NOT NULL)
                  OR (cs.lat IS NOT NULL AND cs.long IS NOT NULL) THEN 1 ELSE 0 END +
          CASE WHEN COALESCE(ce.souls_target, cs.souls_target, 0) > 0 THEN 1 ELSE 0 END
        )::int AS completed,
        9::int AS total
      FROM club_enrollments ce
      JOIN club_sections cs ON cs.club_section_id = ce.club_section_id
      WHERE ce.club_enrollment_id = ${clubEnrollmentId}::uuid
      LIMIT 1
    `;

    const completed = Number(rows[0]?.completed ?? 0);
    const total = Number(rows[0]?.total ?? 0);
    if (total <= 0) return 0;

    return this.normalizePercentage((completed / total) * 100);
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
