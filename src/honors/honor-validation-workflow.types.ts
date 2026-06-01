export type HonorValidationStatus =
  | 'IN_PROGRESS'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type HonorReviewAction = 'approved' | 'rejected';

export interface HonorValidationResult {
  id: number;
  type: 'honor';
  status: HonorValidationStatus;
}

export interface HonorSubmitEligibility {
  canSubmit: boolean;
  blockers: string[];
}
