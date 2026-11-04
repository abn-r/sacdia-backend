import type { ClubRoleName } from './generated/role-names';
import { ClubRole } from './roles';

type RoleGrant = { role_name: string };

/** True when the grant is the section (club) director role. Case-insensitive. */
export function isSectionDirector(
  grant: RoleGrant | null | undefined,
): boolean {
  return grant?.role_name?.toLowerCase() === ClubRole.DIRECTOR;
}

/** True when the grant carries any of the given club roles. Case-insensitive. */
export function hasClubRole(
  grant: RoleGrant | null | undefined,
  ...roles: ClubRoleName[]
): boolean {
  const name = grant?.role_name?.toLowerCase();
  return name !== undefined && (roles as string[]).includes(name);
}

/** True when `roles` contains at least one of `names` (exact match). */
export function rolesInclude(
  roles: Iterable<string>,
  ...names: string[]
): boolean {
  for (const role of roles) {
    if (names.includes(role)) return true;
  }
  return false;
}
