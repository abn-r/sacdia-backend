import type {
  AnnualRankingProgressComponentDto,
  AnnualRankingProgressTierDto,
} from './annual-ranking-progress-response.dto';

export interface AnnualRankingLeaderboardRowDto {
  rank_position: number;
  club_enrollment_id: string;
  club_id: number;
  club_name: string;
  club_type_id: number;
  ecclesiastical_year_id: number;
  local_field_id: number | null;
  current_points: number;
  max_points: number;
  progress_percentage: number;
  current_tier: AnnualRankingProgressTierDto | null;
  next_tier: AnnualRankingProgressTierDto | null;
  components: AnnualRankingProgressComponentDto[];
}

export interface AnnualRankingLeaderboardResponseDto {
  data: AnnualRankingLeaderboardRowDto[];
  total: number;
}
