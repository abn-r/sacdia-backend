import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FolderScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(
    enrollmentId: string,
    ecclesiasticalYearId: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ earned: bigint; max: bigint }[]>`
      SELECT
        COALESCE(SUM(e.earned_points), 0)::bigint AS earned,
        COALESCE(SUM(e.max_points), 0)::bigint    AS max
      FROM annual_folder_section_evaluations e
      JOIN annual_folders f ON f.annual_folder_id = e.annual_folder_id
      JOIN folder_templates ft ON ft.folder_template_id = f.folder_template_id
      WHERE f.club_enrollment_id = ${enrollmentId}::uuid
        AND ft.ecclesiastical_year_id = ${ecclesiasticalYearId}
        AND e.status = 'VALIDATED'::annual_folder_section_status_enum
    `;
    const earned = Number(rows[0]?.earned ?? 0n);
    const max = Number(rows[0]?.max ?? 0n);
    if (max === 0) return 0;
    return Number(((earned / max) * 100).toFixed(2));
  }
}
