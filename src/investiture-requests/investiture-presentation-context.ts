import type { Prisma } from '@prisma/client';
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
    /**
     * The Field's stored time zone is invalid: `open_today` is false and
     * `present` answers INVESTITURE_REQUEST_TIME_ZONE_INVALID until fixed.
     */
    time_zone_invalid: boolean;
  };
  year_open: boolean;
  /** The request holding PENDING people for this section and year, if any. */
  open_request_id: string | null;
  candidates: PresentationCandidate[];
};

export type PresentationScope = {
  clubSectionId: number;
  clubTypeId: number;
  mainClubId: number;
  yearId: number;
};

/**
 * R4. The one definition of "member of the section for the year". `present`
 * (through `evaluateEnrollmentForPresentation`) and the candidate lists of the
 * presentation context both build their queries from it, so they cannot drift.
 */
export function sectionMemberAssignmentWhere(
  scope: Pick<PresentationScope, 'clubSectionId' | 'yearId'>,
): Prisma.club_role_assignmentsWhereInput {
  return {
    club_section_id: scope.clubSectionId,
    ecclesiastical_year_id: scope.yearId,
    active: true,
    status: 'active',
  };
}

/**
 * R4. A Guía Mayor's home: an active assignment of the same club in another
 * section of a different club type. Shared by `present` and the context.
 */
export function crossTypeHomeAssignmentWhere(
  scope: PresentationScope,
): Prisma.club_role_assignmentsWhereInput {
  return {
    ecclesiastical_year_id: scope.yearId,
    active: true,
    status: 'active',
    club_sections: {
      main_club_id: scope.mainClubId,
      club_section_id: { not: scope.clubSectionId },
      club_type_id: { not: scope.clubTypeId },
    },
  };
}
