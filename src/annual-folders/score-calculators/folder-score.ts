import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface FolderScorePointSummary {
  score_pct: number;
  earned_points: number;
  max_points: number;
}

@Injectable()
export class FolderScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    enrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    return (await this.getPointSummary(enrollmentId, ecclesiasticalYearId))
      .score_pct;
  }

  async getPointSummary(
    enrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<FolderScorePointSummary> {
    const folder = await this.prisma.annual_folders.findFirst({
      where: {
        club_enrollment_id: enrollmentId,
        folder_template: { ecclesiastical_year_id: ecclesiasticalYearId },
      },
      select: {
        total_earned_points: true,
        total_max_points: true,
        progress_percentage: true,
      },
    });

    if (folder) {
      return {
        score_pct: this.normalizePercentage(Number(folder.progress_percentage)),
        earned_points: folder.total_earned_points,
        max_points: folder.total_max_points,
      };
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
    return {
      score_pct: max === 0 ? 0 : this.normalizePercentage((earned / max) * 100),
      earned_points: earned,
      max_points: max,
    };
  }

  private normalizePercentage(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Number(value.toFixed(2))));
  }
}
