import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AwardedCategoryDto } from '../../member-rankings/dto/member-ranking-response.dto';

export class SectionRankingResponseDto {
  @ApiProperty({ description: 'Club section ID (integer)' })
  club_section_id!: number;

  @ApiProperty({ description: 'Section name' })
  section_name!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Composite score percentage (avg of member composites)',
  })
  composite_score_pct!: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Section rank position within its club (ASC, NULLs last)',
  })
  rank_position!: number | null;

  @ApiProperty({
    description: 'Number of active enrollments in this section for the year',
  })
  active_enrollment_count!: number;

  @ApiPropertyOptional({
    type: AwardedCategoryDto,
    nullable: true,
    description:
      'Award category assigned to this section (null = not yet wired at section level)',
  })
  awarded_category!: AwardedCategoryDto | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'ISO timestamp of last composite recalculation',
  })
  composite_calculated_at!: string | null;

  static fromSectionRanking(row: any): SectionRankingResponseDto {
    const dto = new SectionRankingResponseDto();
    dto.club_section_id = row.club_section_id;
    dto.section_name = row.club_section?.club_types?.name ?? 'Unknown';
    dto.composite_score_pct =
      row.composite_score_pct !== null && row.composite_score_pct !== undefined
        ? Number(row.composite_score_pct)
        : null;
    dto.rank_position = row.rank_position ?? null;
    dto.active_enrollment_count = row.active_enrollment_count ?? 0;
    // Section-level award categories not yet wired (future roadmap item).
    dto.awarded_category = null;
    dto.composite_calculated_at =
      row.composite_calculated_at?.toISOString?.() ?? null;
    return dto;
  }
}
