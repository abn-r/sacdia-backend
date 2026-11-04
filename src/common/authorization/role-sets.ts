import type { GlobalRoleName } from './generated/role-names';
import { GlobalRole } from './roles';

/** Platform administration scope. */
export const ADMIN_SCOPE_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.SUPER_ADMIN,
  GlobalRole.ADMIN,
  GlobalRole.ASSISTANT_ADMIN,
];

export const LOCAL_FIELD_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.DIRECTOR_LF,
  GlobalRole.ASSISTANT_LF,
];

export const UNION_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.DIRECTOR_UNION,
  GlobalRole.ASSISTANT_UNION,
];

export const DIVISION_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.DIRECTOR_DIA,
  GlobalRole.ASSISTANT_DIA,
];

// All field-level admin roles (lf/union/dia, director/assistant) share an
// identical permission set via JOIN-copy from `assistant-lf` in
// prisma/seeds/role-permissions.seed.sql. They are therefore treated as
// mutually equivalent at the guard level.
export const FIELD_ADMIN_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.DIRECTOR_LF,
  GlobalRole.ASSISTANT_LF,
  GlobalRole.DIRECTOR_UNION,
  GlobalRole.ASSISTANT_UNION,
  GlobalRole.DIRECTOR_DIA,
  GlobalRole.ASSISTANT_DIA,
];

export const COORDINATOR_ROLES: readonly GlobalRoleName[] = [
  GlobalRole.COORDINATOR,
  GlobalRole.ZONE_COORDINATOR,
  GlobalRole.GENERAL_COORDINATOR,
];
