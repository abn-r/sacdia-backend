import { ClubRole } from '../common/authorization/roles';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Service roles of a section (everything but `director` and `member`), in the
 * order the candidate slots are listed. They are the only roles a Guia Mayor
 * can receive in an Aventureros / Conquistadores section.
 */
export const SERVICE_ROLE_NAMES = [
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
  ClubRole.COUNSELOR,
] as const;

export type ServiceRoleName = (typeof SERVICE_ROLE_NAMES)[number];

export function isServiceRoleName(
  roleName: string,
): roleName is ServiceRoleName {
  return (SERVICE_ROLE_NAMES as readonly string[]).includes(roleName);
}

/**
 * Canonical slots per section and year. Used when `role_slot_limits` has no row
 * for the role, so the invariant holds even if the seed was not applied.
 * `counselor` is unlimited (no entry).
 */
export const CANONICAL_ROLE_SLOT_LIMITS_BY_NAME: Record<string, number> = {
  director: 1,
  [ClubRole.DEPUTY_DIRECTOR]: 2,
  [ClubRole.SECRETARY]: 1,
  [ClubRole.TREASURER]: 1,
  [ClubRole.SECRETARY_TREASURER]: 1,
};

export function effectiveMaxPerSection(
  roleName: string,
  configuredMax: number | null | undefined,
): number | null {
  return configuredMax ?? CANONICAL_ROLE_SLOT_LIMITS_BY_NAME[roleName] ?? null;
}

/** Roles that cannot coexist in a section with the given one. */
export const EXCLUSIVE_WITH: Record<string, readonly string[]> = {
  [ClubRole.SECRETARY]: [ClubRole.SECRETARY_TREASURER],
  [ClubRole.TREASURER]: [ClubRole.SECRETARY_TREASURER],
  [ClubRole.SECRETARY_TREASURER]: [ClubRole.SECRETARY, ClubRole.TREASURER],
};

export type CandidateBlockedReason =
  | typeof ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED
  | typeof ErrorCode.MR_CONSENT_NOT_VERIFIED
  | typeof ErrorCode.CLUB_ROLE_ALREADY_HELD
  | typeof ErrorCode.CLUB_ROLE_SELF_ASSIGNMENT;

export type ServiceRoleAllowanceInput = {
  /** The candidate is the caller (nobody assigns a role to himself). */
  isSelf: boolean;
  /** Active or pending `member` row in the club's GM section this year (D1). */
  hasGmMembership: boolean;
  /** Holds an active service role in the TARGET section this year (D4). */
  holdsRoleInTargetSection: boolean;
  /** A minor without verified guardian consent. */
  consentBlocked: boolean;
  /** Active holders per role in the target section this year. */
  occupiedByRole: ReadonlyMap<string, number>;
  /** Effective max per role (`null` = unlimited). */
  maxByRole: ReadonlyMap<string, number | null>;
};

export type ServiceRoleAllowance = {
  allowedRoles: ServiceRoleName[];
  blockedReason: CandidateBlockedReason | null;
};

/**
 * Whether a role has a free slot in the section: under its max and without an
 * occupied exclusive counterpart (secretary / treasurer vs secretary-treasurer).
 */
export function hasFreeSlot(
  roleName: string,
  occupiedByRole: ReadonlyMap<string, number>,
  maxByRole: ReadonlyMap<string, number | null>,
): boolean {
  const max = maxByRole.get(roleName) ?? null;
  if (max !== null && (occupiedByRole.get(roleName) ?? 0) >= max) return false;
  return !(EXCLUSIVE_WITH[roleName] ?? []).some(
    (other) => (occupiedByRole.get(other) ?? 0) > 0,
  );
}

/**
 * The ONE decision behind the candidate list: which service roles a Guia Mayor
 * may receive in an Aventureros / Conquistadores section. The assignment POST
 * enforces the same predicates (`assertServiceRoleAssignable` + slot
 * validation), so the list never offers a role the POST rejects.
 */
export function evaluateServiceRoleAllowance(
  input: ServiceRoleAllowanceInput,
): ServiceRoleAllowance {
  let blockedReason: CandidateBlockedReason | null = null;
  if (input.isSelf) {
    blockedReason = ErrorCode.CLUB_ROLE_SELF_ASSIGNMENT;
  } else if (!input.hasGmMembership) {
    blockedReason = ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED;
  } else if (input.holdsRoleInTargetSection) {
    blockedReason = ErrorCode.CLUB_ROLE_ALREADY_HELD;
  } else if (input.consentBlocked) {
    blockedReason = ErrorCode.MR_CONSENT_NOT_VERIFIED;
  }
  if (blockedReason !== null) return { allowedRoles: [], blockedReason };

  return {
    allowedRoles: SERVICE_ROLE_NAMES.filter((role) =>
      hasFreeSlot(role, input.occupiedByRole, input.maxByRole),
    ),
    blockedReason: null,
  };
}
