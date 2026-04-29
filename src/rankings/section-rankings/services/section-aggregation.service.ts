import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SectionAggregateResult {
  composite_score_pct: number | null;
  active_enrollment_count: number;
}

@Injectable()
export class SectionAggregationService {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(
    sectionId: number,
    ecclesiasticalYearId: number,
  ): Promise<SectionAggregateResult> {
    const rows = await this.prisma.enrollmentRanking.findMany({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        composite_score_pct: { not: null },
      },
      select: { composite_score_pct: true },
    });

    if (rows.length === 0) {
      return { composite_score_pct: null, active_enrollment_count: 0 };
    }

    const sum = rows.reduce(
      (acc, r) => acc + Number(r.composite_score_pct),
      0,
    );
    const avg = sum / rows.length;
    return {
      composite_score_pct: Math.min(Math.max(avg, 0), 100),
      active_enrollment_count: rows.length,
    };
  }
}
