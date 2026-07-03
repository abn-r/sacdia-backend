import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Computes a 0-100 score from official camporee event results for one club
 * section in an ecclesiastical year.
 *
 * Denominator: sum of max_points for active, scoring-enabled camporee_events
 * in active local/union camporees inside the section's institutional scope.
 * Missing section results count as zero because denominator includes every
 * scoring-enabled event even when no result exists.
 *
 * Numerator: sum of active camporee_event_section_results.total_awarded_points
 * for the target club_section_id.
 *
 * Attendance/registration rows (camporee_clubs/camporee_members) are NOT used
 * for annual scoring anymore; they remain operational/historical records.
 */
@Injectable()
export class CamporeeScoreService {
  private readonly logger = new Logger(CamporeeScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * @param clubSectionId - club_sections.club_section_id (integer)
   * @param localFieldId  - section club's local field id (integer)
   * @param unionId       - local_fields.union_id (integer | null)
   * @param year          - ecclesiastical_years.year_id (integer)
   */
  async calc(
    clubSectionId: number,
    localFieldId: number,
    unionId: number | null,
    year: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { awarded_points: unknown; max_points: unknown }[]
    >`
      WITH scoring_events AS (
        SELECT e.camporee_event_id,
               e.max_points::numeric AS max_points
          FROM camporee_events e
          JOIN local_camporees lc
            ON lc.local_camporee_id = e.local_camporee_id
         WHERE e.active = true
           AND e.scoring_enabled = true
           AND lc.active = true
           AND lc.ecclesiastical_year = ${year}
           AND lc.local_field_id = ${localFieldId}
        UNION ALL
        SELECT e.camporee_event_id,
               e.max_points::numeric AS max_points
          FROM camporee_events e
          JOIN union_camporees uc
            ON uc.union_camporee_id = e.union_camporee_id
         WHERE e.active = true
           AND e.scoring_enabled = true
           AND uc.active = true
           AND ${unionId !== null ? true : false} = true
           AND uc.ecclesiastical_year = ${year}
           AND uc.union_id = ${unionId ?? 0}
      )
      SELECT COALESCE(SUM(r.total_awarded_points), 0)::numeric AS awarded_points,
             COALESCE(SUM(se.max_points), 0)::numeric AS max_points
        FROM scoring_events se
        LEFT JOIN camporee_event_section_results r
          ON r.camporee_event_id = se.camporee_event_id
         AND r.club_section_id = ${clubSectionId}
         AND r.active = true
    `;

    const awardedPoints = this.toNumber(rows[0]?.awarded_points);
    const maxPoints = this.toNumber(rows[0]?.max_points);
    if (maxPoints <= 0) return 0;

    return Number(((awardedPoints / maxPoints) * 100).toFixed(2));
  }

  private toNumber(value: unknown): number {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') return Number(value);
    if (typeof (value as { toNumber?: () => number }).toNumber === 'function') {
      return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
  }
}
