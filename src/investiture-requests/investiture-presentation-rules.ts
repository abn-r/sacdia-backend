import { ErrorCode } from '../common/errors/error-codes';
import { isInstitutionalInvestitureClass } from '../certificate-bulk-imports/institutional-class-codes';
import type { ClassRequirementEligibilityResult } from '../classes/class-requirement-eligibility.service';
import type { PresentationBlockedCode } from './investiture-presentation-context';
import { enrollmentOnLegacyInvestiturePipeline } from './investiture-request-lock';

export const GM_TYPE_NAME = 'Guías Mayores';

/** What the presentation rules read from an enrollment. */
export type PresentationEnrollment = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  investiture_status: string;
  locked_for_validation: boolean;
  record_kind: string;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    min_duration_years: number;
    max_duration_years: number;
    club_type_id: number;
    club_types: { name: string } | null;
    asset_code?: string | null;
  } | null;
  ecclesiastical_year: { start_date: Date } | null;
};

export type PresentationVerdict =
  | { eligible: true; singleSlot: boolean }
  | { eligible: false; code: PresentationBlockedCode };

export type PendingAuthorizationFact = {
  class_id: number;
  single_slot: boolean;
};

/**
 * Everything the presentation rules need to know about the world around an
 * enrollment. `present` feeds it from the database under its locks; the
 * presentation context feeds it from a handful of batched reads. The rules in
 * `evaluatePresentation` are the same either way.
 */
export interface PresentationFacts {
  /** Active member of the section for the year (`sectionMemberAssignmentWhere`). */
  isSectionMember(userId: string): Promise<boolean>;
  /** Active assignment in another section of the club (`crossTypeHomeAssignmentWhere`). */
  hasCrossTypeHomeAssignment(userId: string): Promise<boolean>;
  hasInvestedGuiaMayor(userId: string): Promise<boolean>;
  hasInvestedClass(userId: string, classId: number): Promise<boolean>;
  pendingAuthorizations(userId: string): Promise<PendingAuthorizationFact[]>;
  /** Ecclesiastical years from `from` up to the section's year, both included. */
  elapsedYears(from: Date): Promise<number>;
  eligibility(
    enrollmentId: number,
  ): Promise<ClassRequirementEligibilityResult | null | undefined>;
}

export function blockedPresentation(
  code: PresentationBlockedCode,
): PresentationVerdict {
  return { eligible: false, code };
}

/** A Guía Mayor with an invested class may be presented from a section of another type. */
export async function hasCrossTypeHome(
  facts: PresentationFacts,
  enrollment: Pick<PresentationEnrollment, 'user_id' | 'cross_type_enrollment'>,
): Promise<boolean> {
  if (!enrollment.cross_type_enrollment) {
    return false;
  }
  if (!(await facts.hasCrossTypeHomeAssignment(enrollment.user_id))) {
    return false;
  }
  return facts.hasInvestedGuiaMayor(enrollment.user_id);
}

async function usesSingleSlot(
  facts: PresentationFacts,
  enrollment: PresentationEnrollment,
): Promise<boolean> {
  if (enrollment.classes?.club_types?.name === GM_TYPE_NAME) {
    return false;
  }
  if (!enrollment.cross_type_enrollment) {
    return true;
  }
  return !(await facts.hasInvestedGuiaMayor(enrollment.user_id));
}

/**
 * Decides whether an enrollment may be presented for investiture, returning
 * the first blocking code instead of throwing. It never writes and takes no
 * lock; the check order is the contract `present` has always honoured
 * (IA-04/05/06/08/18/62).
 */
export async function evaluatePresentation(
  facts: PresentationFacts,
  clubTypeId: number,
  enrollment: PresentationEnrollment,
): Promise<PresentationVerdict> {
  if (isInstitutionalInvestitureClass(enrollment.classes?.asset_code)) {
    return blockedPresentation(
      ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
    );
  }
  if (!enrollment.active || enrollment.record_kind !== 'OPERATIONAL') {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL);
  }
  if (enrollment.classes?.club_type_id !== clubTypeId) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION);
  }
  const member = await facts.isSectionMember(enrollment.user_id);
  if (!member && !(await hasCrossTypeHome(facts, enrollment))) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION);
  }
  if (await facts.hasInvestedClass(enrollment.user_id, enrollment.class_id)) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED);
  }
  if (enrollmentOnLegacyInvestiturePipeline(enrollment)) {
    return blockedPresentation(
      ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
    );
  }
  const pending = await facts.pendingAuthorizations(enrollment.user_id);
  const singleSlot = await usesSingleSlot(facts, enrollment);
  const blocked =
    singleSlot || pending.some((row) => row.single_slot)
      ? pending.length > 0
      : pending.some((row) => row.class_id === enrollment.class_id);
  if (blocked) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS);
  }
  const result = await facts.eligibility(enrollment.enrollment_id);
  if (!result?.investiture_eligibility.eligible) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE);
  }
  if (!enrollment.classes || !enrollment.ecclesiastical_year) {
    return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE);
  }
  if (enrollment.investiture_status === 'EXPIRED') {
    return blockedPresentation(ErrorCode.INVESTITURE_DURATION_EXPIRED);
  }
  const elapsed = await facts.elapsedYears(
    enrollment.ecclesiastical_year.start_date,
  );
  if (elapsed < enrollment.classes.min_duration_years) {
    return blockedPresentation(ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET);
  }
  if (elapsed > enrollment.classes.max_duration_years) {
    return blockedPresentation(ErrorCode.INVESTITURE_DURATION_EXPIRED);
  }
  return { eligible: true, singleSlot };
}
