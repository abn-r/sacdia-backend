export interface AnnualRankingProgressTierDto {
  name: string;
  slug: string;
  from_points: number;
  to_points: number;
  color?: string | null;
  icon?: string | null;
  points_to_reach?: number | null;
}

export interface AnnualRankingProgressComponentDto {
  key: string;
  label: string;
  earned_points: number;
  max_points: number;
  progress_percentage: number;
}

export interface AnnualRankingProgressPendingItemDto {
  type: string;
  title: string;
  status: string;
  due_date: string | null;
  action_label: string;
}

export interface AnnualRankingProgressResponseDto {
  section_id: number;
  club_id: number;
  club_name: string;
  club_type: {
    club_type_id: number;
    name: string | null;
  };
  year: {
    ecclesiastical_year_id: number;
  };
  current_points: number;
  max_points: number;
  progress_percentage: number;
  current_tier: AnnualRankingProgressTierDto | null;
  next_tier: AnnualRankingProgressTierDto | null;
  components: AnnualRankingProgressComponentDto[];
  pending_items: AnnualRankingProgressPendingItemDto[];
}
