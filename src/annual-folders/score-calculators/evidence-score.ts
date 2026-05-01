import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EvidenceScoreService {
  constructor(private readonly prisma: PrismaService) {}

  async calc(clubId: number, ecclesiasticalYearId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      { validated: bigint; rejected: bigint }[]
    >`
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'VALIDATED'::evidence_validation_enum)::bigint AS validated,
        COUNT(*) FILTER (WHERE r.status = 'REJECTED'::evidence_validation_enum)::bigint  AS rejected
      FROM folders_section_records r
      JOIN folders f ON f.folder_id = r.folder_id
      JOIN club_sections cs ON cs.club_section_id = r.club_section_id
      WHERE cs.main_club_id = ${clubId}
        AND f.ecclesiastical_year_id = ${ecclesiasticalYearId}
    `;

    const validated = Number(rows[0]?.validated ?? 0n);
    const rejected = Number(rows[0]?.rejected ?? 0n);
    const denom = validated + rejected;
    if (denom === 0) return 0;
    const score = (validated / denom) * 100;
    return Number(score.toFixed(2));
  }
}
