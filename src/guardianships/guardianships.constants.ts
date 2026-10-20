/** A guardian can hold at most this many active dependents (frozen/purged excluded). */
export const MAX_DEPENDENTS_PER_GUARDIAN = 10;

/** A dependent can have at most this many active guardians (ruling A6). */
export const MAX_GUARDIANS_PER_DEPENDENT = 4;

/**
 * What the guardian is to the minor ("yo soy su..."). Matched by catalog NAME,
 * never by id: `relationship_types.relationship_type_id` is a random UUID per
 * environment while `name` is unique and seeded (prisma/seed.ts). The ORDER
 * here is the display order of `GET /guardianships/relationship-types`.
 *
 * prisma/seed.ts seeds the combined 'Abuelo/a' and 'Tío/a'; some databases
 * also hold the split forms. Both are allowed so every environment offers
 * grandparents and uncles/aunts; the endpoint only returns rows that exist.
 */
export const GUARDIAN_RELATIONSHIP_TYPE_NAMES = [
  'Padre',
  'Madre',
  'Tutor Legal',
  'Abuelo',
  'Abuela',
  'Abuelo/a',
  'Tío',
  'Tía',
  'Tío/a',
  'Hermano/a Mayor',
  'Otro',
] as const;

export const SECOND_GUARDIAN_CODE_TTL_MS = 72 * 60 * 60 * 1000;
/** A teen-issued guardian link code lives 72 h (ruling, Phase 3a). */
export const TEEN_LINK_CODE_TTL_MS = 72 * 60 * 60 * 1000;
export const DIRECTOR_CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 10 failed redeems lock the user out; the window opens at the FIRST failure. */
export const LINK_CODE_MAX_FAILURES = 10;
export const LINK_CODE_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Linked devices (Phase 3b). A child can have at most this many active paired phones (ruling R1). */
export const MAX_LINKED_DEVICES_PER_DEPENDENT = 2;
/** The single-use QR pairing token lives 10 minutes. */
export const DEVICE_PAIRING_TOKEN_TTL_MS = 10 * 60 * 1000;
/** A device session can never be extended past this many days from pairing (P3-A13). */
export const DEVICE_ABSOLUTE_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;
/**
 * What a purged child's device rows keep as their label. `label` is free text
 * typed on the phone (personal data) and the column is NOT NULL, so the purge
 * overwrites it with this neutral text instead of nulling it.
 */
export const PURGED_DEVICE_LABEL = 'Dispositivo';
/**
 * What a purged child's EXTERNAL holder row keeps as `external_name`. The name
 * is personal data, but `guardianships_holder_ck` requires every non-custodian
 * row without a `guardian_user_id` to carry an `external_name`, so the purge
 * overwrites it with this neutral text instead of nulling it (same idea as
 * PURGED_DEVICE_LABEL).
 */
export const PURGED_GUARDIAN_NAME = 'Tutor';
/** A revoked device stays listed for the guardians this long (history). */
export const REVOKED_DEVICE_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

/** A frozen dependent is purged this long after the freeze. */
export const FROZEN_PURGE_AFTER_DAYS = 90;

/** Statuses of `club_role_assignments` that count as "has a club membership". */
export const LIVE_ASSIGNMENT_STATUSES = ['active', 'pending'] as const;

export type ConsentStatus = 'pending' | 'verified' | 'revoked';

/**
 * `pending_guardian` (Phase 3a): the dependent HOLDS an account (a teen), so the
 * last guardian leaving never freezes it; it drops back to pending-guardian
 * mode and the guardian-less clock restarts.
 */
export type DependentOutcome =
  'other_guardian' | 'club_custody' | 'frozen' | 'pending_guardian';

export type GuardianshipRevokedReason =
  | 'guardian_left'
  | 'removed_by_primary'
  | 'guardian_account_closed'
  | 'claimed'
  | 'admin'
  | 'released'
  /** A teen revoked a PENDING link they initiated (Phase 3a). */
  | 'removed_by_dependent';

export type LinkCodePurpose =
  'second_guardian' | 'director_claim' | 'teen_guardian_link';

/**
 * Guardian-less teen clock (Phase 3a, ruling R1): reminders to the TEEN at
 * these day marks (level 1, 2, 3), freeze at 90.
 */
export const PENDING_TEEN_REMINDER_DAYS = [7, 30, 83] as const;
export const PENDING_TEEN_FREEZE_DAYS = 90;
