import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnrollmentClubResolverService } from './enrollment-club-resolver.service';
import { InstitutionalHierarchyService } from '../../../common/services/institutional-hierarchy.service';

@Injectable()
export class CamporeeScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubResolver: EnrollmentClubResolverService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async calculate(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const club = await this.clubResolver.resolve(
      enrollmentId,
      ecclesiasticalYearId,
    );
    if (!club) return null;

    const ecclesiasticalYear =
      await this.prisma.ecclesiastical_years.findUnique({
        where: { year_id: ecclesiasticalYearId },
        select: { start_date: true, end_date: true },
      });
    const asOf =
      ecclesiasticalYear?.end_date ??
      ecclesiasticalYear?.start_date ??
      new Date(`${ecclesiasticalYearId}-12-31T23:59:59.999Z`);
    const hierarchyAsOf = await this.hierarchy
      .resolveAsOf({ type: 'club', id: club.clubId }, asOf)
      .catch(() => null);
    if (!hierarchyAsOf) return null;

    const localFieldId = hierarchyAsOf.local_field_id;
    const resolvedUnionId = hierarchyAsOf.union_id ?? null;

    if (localFieldId == null) return null;

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
           AND lc.ecclesiastical_year = ${ecclesiasticalYearId}
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
           AND ${resolvedUnionId !== null ? true : false} = true
           AND uc.ecclesiastical_year = ${ecclesiasticalYearId}
           AND uc.union_id = ${resolvedUnionId ?? 0}
      )
      SELECT COALESCE(SUM(r.total_awarded_points), 0)::numeric AS awarded_points,
             COALESCE(SUM(se.max_points), 0)::numeric AS max_points
        FROM scoring_events se
        LEFT JOIN camporee_event_section_results r
          ON r.camporee_event_id = se.camporee_event_id
         AND r.club_section_id = ${club.clubSectionId}
         AND r.active = true
    `;

    const awardedPoints = this.toNumber(rows[0]?.awarded_points);
    const maxPoints = this.toNumber(rows[0]?.max_points);
    if (maxPoints <= 0) return null;

    return Math.min((awardedPoints / maxPoints) * 100, 100);
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
