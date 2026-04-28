/**
 * Response shape for GET /annual-folders/rankings/:enrollmentId/breakdown
 *
 * Plain interfaces (not class-validator) — this is a response DTO, not an input.
 */

export interface FolderComponent {
  score_pct: number;
  earned_points: number;
  max_points: number;
  sections_evaluated: number;
}

export interface FinanceComponent {
  score_pct: number;
  months_closed_on_time: number;
  months_total: number; // always 12
  deadline_day: number;
  missed_months: number[]; // months 1..12 that were NOT closed on time
}

export interface CamporeeEvent {
  id: string; // stringified integer id
  name: string;
  status: 'approved' | null;
}

export interface CamporeeComponent {
  score_pct: number;
  attended: number;
  available_in_scope: number;
  events: CamporeeEvent[];
}

export interface EvidenceComponent {
  score_pct: number;
  validated: number;
  rejected: number;
  pending_excluded: number;
}

export interface WeightsApplied {
  folder: number;
  finance: number;
  camporee: number;
  evidence: number;
  source: 'default' | 'club_type_override';
}

export interface RankingBreakdownDto {
  enrollment_id: string;
  year_id: number;
  composite_score_pct: number;
  weights_applied: WeightsApplied;
  components: {
    folder: FolderComponent;
    finance: FinanceComponent;
    camporee: CamporeeComponent;
    evidence: EvidenceComponent;
  };
}
