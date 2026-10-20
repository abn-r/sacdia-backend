/**
 * Principal attached to `request.user` by `JwtStrategy.validate`.
 *
 * A guardian acting for a dependent is a SUBSTITUTED principal: `sub` /
 * `userId` / `user_id` are the dependent (so every `me`-style read follows the
 * dependent with no controller change) while `actor_sub` keeps the real
 * person (guardian) for audit, throttling and notifications.
 *
 * Every kind other than `user` is default-deny: it only reaches routes that
 * declare an `@ActingScope(scope)` the principal holds.
 *  - `user`: adults, unknown age (NULL birthday) and anonymous.
 *  - `guardian_acting`: Phase 2, a verified-or-pending guardian acting for a dependent.
 *  - `supervised_user` (Phase 3a): an account holder under the age of majority,
 *    resolved SERVER-SIDE (never from a token claim).
 *  - `linked_device` (Phase 3b): a paired phone of an under-13 dependent.
 */
export type PrincipalKind =
  'user' | 'guardian_acting' | 'supervised_user' | 'linked_device';

/** Capability vocabulary. A route is reachable by a non-`user` kind only if it declares one of these. */
export const ACTING_FOR_SCOPES = [
  'self:read',
  'health:read',
  'profile:write',
  'registration:write',
  'classes:write',
  'evidence:submit',
  'honors:write',
  'evidence:upload',
  'legal:accept',
  'consent:evidence',
  // Phase 3
  'member:read',
  'member:write',
  'agenda:read',
  'push:register',
  'self:password',
  'self:preferences',
  'guardian_link:issue',
] as const;

export type ActingForScope = (typeof ACTING_FOR_SCOPES)[number];

/**
 * `pending` consent: what is needed to finish registration (read, profile,
 * post-registration steps 1-3 which create the club request, legal acceptance)
 * plus the signed-form upload while acting.
 */
export const GUARDIAN_PENDING_SCOPES = [
  'self:read',
  'health:read',
  'profile:write',
  'registration:write',
  'legal:accept',
  'consent:evidence',
] as const satisfies readonly ActingForScope[];

/**
 * `verified` consent adds classes, honors and evidence (only useful after club
 * approval). It is NO LONGER an alias of the whole vocabulary: the Phase 3 teen
 * and device scopes (member:*, agenda:read, push:register, self:password,
 * self:preferences, guardian_link:issue) must never reach a guardian.
 */
export const GUARDIAN_VERIFIED_SCOPES = [
  'self:read',
  'health:read',
  'profile:write',
  'registration:write',
  'classes:write',
  'evidence:submit',
  'honors:write',
  'evidence:upload',
  'legal:accept',
  'consent:evidence',
] as const satisfies readonly ActingForScope[];

/**
 * A teen with NO verified non-custodian guardian (pending-guardian mode): finish
 * registration, issue a guardian link code, change the own password, receive
 * the reminder pushes. No club data at all.
 */
export const TEEN_PENDING_SCOPES = [
  'self:read',
  'health:read',
  'profile:write',
  'registration:write',
  'legal:accept',
  'guardian_link:issue',
  'self:password',
  'self:preferences',
  'push:register',
] as const satisfies readonly ActingForScope[];

/** A teen with a verified guardian: the full member app minus sensitive routes. */
export const TEEN_SCOPES = [
  'self:read',
  'health:read',
  'profile:write',
  'registration:write',
  'classes:write',
  'evidence:submit',
  'honors:write',
  'evidence:upload',
  'legal:accept',
  'member:read',
  'member:write',
  'agenda:read',
  'push:register',
  'self:password',
  'self:preferences',
] as const satisfies readonly ActingForScope[];

/**
 * Phase 3b: an under-13 child's paired phone. Replaces the Phase 2
 * LINKED_DEVICE_SCOPES. `health:read` and `classes:write` are deliberately absent
 * (the device submits through the narrower `evidence:submit`).
 */
export const DEVICE_SCOPES = [
  'self:read',
  'evidence:upload',
  'evidence:submit',
  'push:register',
  'agenda:read',
] as const satisfies readonly ActingForScope[];

/** Supervision state of a `supervised_user` principal. */
export type SupervisionStatus = 'pending_guardian' | 'active';

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
  /** Only for kind 'supervised_user'. */
  supervision?: SupervisionStatus;
  /** Only for kind 'linked_device' (3b). */
  linked_device_id?: string;
}

/** Request property that memoizes the resolved grant across guard re-runs. */
export const ACTING_GRANT_MEMO = Symbol('sacdia.acting_grant_memo');

/** Request property that memoizes the resolved supervised state across guard re-runs. */
export const SUPERVISED_STATE_MEMO = Symbol('sacdia.supervised_state_memo');
