import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { award_tier_enum } from '@prisma/client';

export class AwardedCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  icon!: string | null;

  @ApiProperty()
  min_pct!: number;

  @ApiProperty()
  max_pct!: number;

  @ApiPropertyOptional({ enum: award_tier_enum, nullable: true })
  tier!: award_tier_enum | null;
}

export class MemberRankingResponseDto {
  @ApiProperty()
  enrollment_id!: number;

  @ApiProperty()
  user_id!: string;

  @ApiProperty()
  member_name!: string;

  @ApiPropertyOptional({ nullable: true })
  club_section_id!: number | null;

  @ApiPropertyOptional({ nullable: true })
  section_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  class_score_pct!: number | null;

  @ApiPropertyOptional({ nullable: true })
  investiture_score_pct!: number | null;

  @ApiPropertyOptional({ nullable: true })
  camporee_score_pct!: number | null;

  @ApiPropertyOptional({ nullable: true })
  composite_score_pct!: number | null;

  @ApiPropertyOptional({ nullable: true })
  rank_position!: number | null;

  @ApiPropertyOptional({ type: AwardedCategoryDto, nullable: true })
  awarded_category!: AwardedCategoryDto | null;

  @ApiPropertyOptional({ nullable: true })
  composite_calculated_at!: string | null;

  static fromEnrollmentRanking(row: any): MemberRankingResponseDto {
    return {
      enrollment_id: row.enrollment_id,
      user_id: row.user_id,
      member_name: row.user?.name ?? '',
      club_section_id: row.club_section_id ?? null,
      section_name: row.club_section?.name ?? null,
      class_score_pct:
        row.class_score_pct !== null && row.class_score_pct !== undefined
          ? Number(row.class_score_pct)
          : null,
      investiture_score_pct:
        row.investiture_score_pct !== null &&
        row.investiture_score_pct !== undefined
          ? Number(row.investiture_score_pct)
          : null,
      camporee_score_pct:
        row.camporee_score_pct !== null && row.camporee_score_pct !== undefined
          ? Number(row.camporee_score_pct)
          : null,
      composite_score_pct:
        row.composite_score_pct !== null &&
        row.composite_score_pct !== undefined
          ? Number(row.composite_score_pct)
          : null,
      rank_position: row.rank_position ?? null,
      awarded_category: row.awarded_category
        ? {
            id: row.awarded_category.award_category_id,
            name: row.awarded_category.name,
            icon: row.awarded_category.icon ?? null,
            min_pct: Number(row.awarded_category.min_composite_pct),
            max_pct: Number(row.awarded_category.max_composite_pct),
            tier: row.awarded_category.tier ?? null,
          }
        : null,
      composite_calculated_at:
        row.composite_calculated_at?.toISOString() ?? null,
    };
  }
}
