import { ErrorCode } from '../common/errors/error-codes';

/**
 * Codes `evaluateEnrollmentForPresentation` can return when an enrollment may
 * not be presented. The same codes `present` throws, so the board can explain
 * the block before the attempt (IA-04/05/06/08/18/62).
 */
export type PresentationBlockedCode =
  | ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE
  | ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL
  | ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION
  | ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED
  | ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE
  | ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS
  | ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE
  | ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET
  | ErrorCode.INVESTITURE_DURATION_EXPIRED;

export type PresentationCandidate = {
  enrollment_id: number;
  user_id: string;
  user_name: string | null;
  class_id: number;
  class_name: string | null;
  /** Same figure as `ClassRequirementEligibilityService.overall_progress`. */
  overall_progress: number;
  eligible: boolean;
  /** Blocking code when `eligible` is false. */
  blocked_code: PresentationBlockedCode | null;
  /** Set when the person is already PENDING in the section's open request. */
  pending_person_id: string | null;
};

export type PresentationContextView = {
  club_section_id: number;
  ecclesiastical_year_id: number;
  window: {
    start_date: string | null;
    end_date: string | null;
    /** `investitureWindowAllowsOperation` with the Field's local day. */
    open_today: boolean;
  };
  year_open: boolean;
  /** The request holding PENDING people for this section and year, if any. */
  open_request_id: string | null;
  candidates: PresentationCandidate[];
};
