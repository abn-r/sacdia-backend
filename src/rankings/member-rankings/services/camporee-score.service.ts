import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnrollmentClubResolverService } from './enrollment-club-resolver.service';

@Injectable()
export class CamporeeScoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubResolver: EnrollmentClubResolverService,
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

    const club = await this.clubResolver.resolve(enrollmentId, ecclesiasticalYearId);
    if (!club) return null;

    // engram #1850: clubs has no direct union_id; resolve via local_fields
    const clubData = await this.prisma.clubs.findUnique({
      where: { club_id: club.clubId },
      select: {
        local_field_id: true,
        local_fields: { select: { union_id: true } },
      },
    });
    if (!clubData) return null;

    const localFieldId = clubData.local_field_id;
    const resolvedUnionId = clubData.local_fields?.union_id ?? null;

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
    if (unionIds.length > 0) orClauses.push({ union_camporee_id: { in: unionIds } });

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
