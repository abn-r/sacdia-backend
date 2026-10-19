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
export const DIRECTOR_CLAIM_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 10 failed redeems lock the user out; the window opens at the FIRST failure. */
export const LINK_CODE_MAX_FAILURES = 10;
export const LINK_CODE_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A frozen dependent is purged this long after the freeze. */
export const FROZEN_PURGE_AFTER_DAYS = 90;

/** Statuses of `club_role_assignments` that count as "has a club membership". */
export const LIVE_ASSIGNMENT_STATUSES = ['active', 'pending'] as const;

export type ConsentStatus = 'pending' | 'verified' | 'revoked';

export type DependentOutcome = 'other_guardian' | 'club_custody' | 'frozen';

export type GuardianshipRevokedReason =
  | 'guardian_left'
  | 'removed_by_primary'
  | 'guardian_account_closed'
  | 'claimed'
  | 'admin'
  | 'released';

export type LinkCodePurpose = 'second_guardian' | 'director_claim';
