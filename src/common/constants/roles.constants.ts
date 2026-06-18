/**
 * Canonical role name constants — single source of truth.
 *
 * These must match the role_name values in the `roles` table exactly.
 * Do NOT use raw strings for role comparisons; import from here instead.
 *
 * Global roles (role_category = 'GLOBAL'):
 *   super-admin, admin, assistant-admin, coordinator, zone-coordinator,
 *   general-coordinator, pastor, user
 *
 * Club roles (role_category = 'CLUB'):
 *   director, deputy-director, secretary, treasurer, counselor, instructor, member
 */

export const GLOBAL_ROLE = {
  SUPER_ADMIN: 'super-admin',
  ADMIN: 'admin',
  ASSISTANT_ADMIN: 'assistant-admin',
  COORDINATOR: 'coordinator',
  ZONE_COORDINATOR: 'zone-coordinator',
  GENERAL_COORDINATOR: 'general-coordinator',
  PASTOR: 'pastor',
  USER: 'user',
} as const;

export type GlobalRoleName = (typeof GLOBAL_ROLE)[keyof typeof GLOBAL_ROLE];

export const CLUB_ROLE = {
  DIRECTOR: 'director',
  DEPUTY_DIRECTOR: 'deputy-director',
  SECRETARY: 'secretary',
  TREASURER: 'treasurer',
  COUNSELOR: 'counselor',
  INSTRUCTOR: 'instructor',
  MEMBER: 'member',
} as const;

export type ClubRoleName = (typeof CLUB_ROLE)[keyof typeof CLUB_ROLE];
