import { ErrorCode } from '../common/errors/error-codes';

/**
 * Four-eyes rules of the consent verification (family-profiles, verify 2c W2 and
 * ruling A14), as PURE functions. `verify-consent` enforces them with the facts
 * it reads inside its transaction; the `consent` block of the membership
 * request list evaluates them for the viewer with batched facts. Both call the
 * same predicate, so the UI verdict and the server's 403 can never disagree.
 */

/** Revoked reasons that mean "this guardian handed the child over to the club". */
export const CUSTODY_TRIGGER_REASONS = [
  'guardian_left',
  'guardian_account_closed',
] as const;

/**
 * Why a viewer may not verify a consent (the user ids behind it are never
 * exposed):
 *  - `self_guardian`: the viewer is a live guardian of the child (any row);
 *  - `self_custodian`: club custody, and the viewer uploaded the current form,
 *    created the dependent or is the guardian who handed the child over.
 */
export type ViewerVerifyBlock = 'self_guardian' | 'self_custodian';

/** The user ids that may not verify a CUSTODY consent (empty ones dropped). */
export function custodyBarredUserIds(input: {
  evidenceUploaderId: string | null | undefined;
  creatorId: string | null | undefined;
  handedOverGuardianId: string | null | undefined;
}): string[] {
  return [
    input.evidenceUploaderId,
    input.creatorId,
    input.handedOverGuardianId,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * The four-eyes rule itself. Order matters (same as verify-consent): a live
 * guardian is `self_guardian` whatever the row; the custody list only applies
 * to a custody row.
 */
export function findVerifierBlock(input: {
  viewerId: string;
  viewerIsLiveGuardian: boolean;
  custody: boolean;
  custodyBarredUserIds: readonly string[];
}): ViewerVerifyBlock | null {
  if (input.viewerIsLiveGuardian) return 'self_guardian';
  if (input.custody && input.custodyBarredUserIds.includes(input.viewerId)) {
    return 'self_custodian';
  }
  return null;
}

/** The error verify-consent throws for a block. */
export function verifierBlockErrorCode(block: ViewerVerifyBlock): ErrorCode {
  return block === 'self_guardian'
    ? ErrorCode.GUARDIANSHIP_GUARDIAN_SELF_VERIFY
    : ErrorCode.GUARDIANSHIP_CUSTODIAN_SELF_VERIFY;
}

export interface ConsentVerifierVerdict {
  viewer_can_verify: boolean;
  viewer_verify_block: ViewerVerifyBlock | null;
}

/**
 * Is there a consent for a reviewer to verify right now (whoever the reviewer
 * is): an active primary row that is still `pending` AND a current signed form.
 * The "something to verify" half of {@link evaluateConsentVerifier}; adults,
 * verified or revoked consents and minors without a form yet have none.
 */
export function consentHasVerifyWork(input: {
  hasPrimary: boolean;
  consentStatus: 'pending' | 'verified' | 'revoked' | string;
  evidenceUploaded: boolean;
}): boolean {
  return (
    input.hasPrimary &&
    input.consentStatus === 'pending' &&
    input.evidenceUploaded
  );
}

/**
 * {@link consentHasVerifyWork} read back from a verdict: when there is work the
 * viewer either can verify or is barred (a block), so a verdict with neither
 * means "nothing to verify". Barred viewers COUNT: the work exists, they see it
 * with the block that says why they cannot act on it.
 */
export function verdictHasVerifyWork(verdict: ConsentVerifierVerdict): boolean {
  return verdict.viewer_can_verify || verdict.viewer_verify_block !== null;
}

/**
 * The verdict for the consent block: may THIS viewer verify the consent right
 * now. When there is nothing to verify (no active primary row, already
 * verified, no current signed form) it is `false` with no block: verify-consent
 * would answer 404/409/no-op there, not a four-eyes 403.
 */
export function evaluateConsentVerifier(input: {
  viewerId: string;
  hasPrimary: boolean;
  consentStatus: 'pending' | 'verified' | 'revoked' | string;
  evidenceUploaded: boolean;
  viewerIsLiveGuardian: boolean;
  custody: boolean;
  custodyBarredUserIds: readonly string[];
}): ConsentVerifierVerdict {
  if (!consentHasVerifyWork(input)) {
    return { viewer_can_verify: false, viewer_verify_block: null };
  }
  const block = findVerifierBlock(input);
  return { viewer_can_verify: block === null, viewer_verify_block: block };
}
