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
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { user_id: true },
    });
    if (!enrollment) return null;

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

    const [localCamporees, unionCamporees] = await Promise.all([
      this.prisma.local_camporees.findMany({
        where: {
          ecclesiastical_year: ecclesiasticalYearId,
          active: true,
          local_field_id: localFieldId,
        },
        select: { local_camporee_id: true },
      }),
      resolvedUnionId === null
        ? Promise.resolve([])
        : this.prisma.union_camporees.findMany({
            where: {
              ecclesiastical_year: ecclesiasticalYearId,
              active: true,
              union_id: resolvedUnionId,
              union_camporee_local_fields: {
                some: { local_field_id: localFieldId },
              },
            },
            select: { union_camporee_id: true },
          }),
    ]);

    const localIds = localCamporees.map((c) => c.local_camporee_id);
    const unionIds = unionCamporees.map((c) => c.union_camporee_id);
    const totalCamporees = localIds.length + unionIds.length;
    if (totalCamporees === 0) return null;

    // CRITICAL: scope numerator to in-range camporee IDs only.
    // Without this filter the count includes lifetime global attendance,
    // inflating scores (caught in stage 2 review of v1 plan).
    const orClauses: Array<Record<string, unknown>> = [];
    if (localIds.length > 0) orClauses.push({ camporee_id: { in: localIds } });
    if (unionIds.length > 0)
      orClauses.push({ union_camporee_id: { in: unionIds } });

    const participatedCount = await this.prisma.camporee_members.count({
      where: {
        user_id: enrollment.user_id,
        status: 'approved',
        OR: orClauses,
      },
    });

    return Math.min((participatedCount / totalCamporees) * 100, 100);
  }
}
