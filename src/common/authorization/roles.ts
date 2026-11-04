import type { ClubRoleName, GlobalRoleName } from './generated/role-names';

export type { ClubRoleName, GlobalRoleName };

/**
 * Named handles for the global role catalog. Values are the catalog names
 * (generated/role-names.ts); use these instead of string literals.
 */
export const GlobalRole = {
  SUPER_ADMIN: 'super-admin',
  ADMIN: 'admin',
  ASSISTANT_ADMIN: 'assistant-admin',
  COORDINATOR: 'coordinator',
  ZONE_COORDINATOR: 'zone-coordinator',
  GENERAL_COORDINATOR: 'general-coordinator',
  PASTOR: 'pastor',
  USER: 'user',
  DIRECTOR_LF: 'director-lf',
  ASSISTANT_LF: 'assistant-lf',
  DIRECTOR_UNION: 'director-union',
  ASSISTANT_UNION: 'assistant-union',
  DIRECTOR_DIA: 'director-dia',
  ASSISTANT_DIA: 'assistant-dia',
} as const satisfies Record<string, GlobalRoleName>;

/** Named handles for the club role catalog. */
export const ClubRole = {
  DIRECTOR: 'director',
  DEPUTY_DIRECTOR: 'deputy-director',
  SECRETARY: 'secretary',
  TREASURER: 'treasurer',
  SECRETARY_TREASURER: 'secretary-treasurer',
  COUNSELOR: 'counselor',
  INSTRUCTOR: 'instructor',
  MEMBER: 'member',
} as const satisfies Record<string, ClubRoleName>;
