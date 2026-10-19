/**
 * Principal attached to `request.user` by `JwtStrategy.validate`.
 *
 * A guardian acting for a dependent is a SUBSTITUTED principal: `sub` /
 * `userId` / `user_id` are the dependent (so every `me`-style read follows the
 * dependent with no controller change) while `actor_sub` keeps the real
 * person (guardian) for audit, throttling and notifications.
 */
export type PrincipalKind = 'user' | 'guardian_acting' | 'linked_device'; // linked_device = Phase 3, never produced in Phase 2

/** Capability vocabulary. A route is reachable while acting only if it declares one of these. */
export const ACTING_FOR_SCOPES = [
  'self:read',
  'profile:write',
  'registration:write',
  'classes:write',
  'honors:write',
  'evidence:upload',
  'legal:accept',
] as const;

export type ActingForScope = (typeof ACTING_FOR_SCOPES)[number];

/**
 * `pending` consent: what is needed to finish registration (read, profile,
 * post-registration steps 1-3 which create the club request, legal acceptance).
 */
export const GUARDIAN_PENDING_SCOPES = [
  'self:read',
  'profile:write',
  'registration:write',
  'legal:accept',
] as const satisfies readonly ActingForScope[];

/** `verified` consent adds classes, honors and evidence (only useful after club approval). */
export const GUARDIAN_VERIFIED_SCOPES: readonly ActingForScope[] =
  ACTING_FOR_SCOPES;

/**
 * Phase 3 (declared, NOT wired): an under-13 child's paired phone can read its
 * own data and upload class-progress evidence, nothing else. Declared now so
 * the vocabulary does not change when the linked device principal lands.
 */
export const LINKED_DEVICE_SCOPES = [
  'self:read',
  'evidence:upload',
] as const satisfies readonly ActingForScope[];

export interface AuthPrincipal {
  /** Subject (= the dependent while acting). */
  sub: string;
  userId: string;
  user_id: string;
  /** Null for dependents (no account email) and while acting. */
  email: string | null;
  mfa_pending: boolean;
  sid: string | null;
  kind: PrincipalKind;
  /** The real actor; equals `sub` for kind 'user'. */
  actor_sub: string;
  acting_for: boolean;
  /** Null = unrestricted (kind 'user'). */
  scopes: readonly ActingForScope[] | null;
  guardianship_id?: string;
  /** Consent state of the acted guardianship (only while acting). */
  consent_status?: 'pending' | 'verified';
}

/** Request property that memoizes the resolved grant across guard re-runs. */
export const ACTING_GRANT_MEMO = Symbol('sacdia.acting_grant_memo');
