import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class CamporeeScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calculate(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<number | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
    });
    if (!enrollment) return null;

    // engram #1850: clubs has no union_id; resolve via local_fields
    const club = await this.prisma.clubs.findUnique({
      where: { club_id: enrollment.club_id },
      select: {
        local_field_id: true,
        local_fields: { select: { union_id: true } },
      },
    });
    const resolvedUnionId = club?.local_fields?.union_id ?? null;

    const localFieldId = club?.local_field_id;
    if (!localFieldId) return null;

    const [participatedCount, localCamporees, unionCamporees] = await Promise.all([
      this.prisma.camporee_members.count({
        where: { user_id: enrollment.user_id, status: 'approved' },
      }),
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

    const totalCamporees = localCamporees.length + unionCamporees.length;
    if (totalCamporees === 0) return null;
    return Math.min((participatedCount / totalCamporees) * 100, 100);
  }
}
