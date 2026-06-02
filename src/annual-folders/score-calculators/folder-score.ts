import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FolderScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    enrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const folder = await this.prisma.annual_folders.findFirst({
      where: {
        club_enrollment_id: enrollmentId,
        folder_template: { ecclesiastical_year_id: ecclesiasticalYearId },
      },
      select: { progress_percentage: true },
    });

    if (folder) {
      return this.normalizePercentage(Number(folder.progress_percentage));
    }

    const rows = await this.prisma.$queryRaw<{ earned: bigint; max: bigint }[]>`
      SELECT
        COALESCE(f.total_earned_points, 0)::bigint AS earned,
        COALESCE(f.total_max_points, 0)::bigint    AS max
      FROM annual_folders f
      JOIN folder_templates ft ON ft.folder_template_id = f.folder_template_id
      WHERE f.club_enrollment_id = ${enrollmentId}::uuid
        AND ft.ecclesiastical_year_id = ${ecclesiasticalYearId}
      LIMIT 1
    `;
    const earned = Number(rows[0]?.earned ?? 0n);
    const max = Number(rows[0]?.max ?? 0n);
    if (max === 0) return 0;
    return this.normalizePercentage((earned / max) * 100);
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
