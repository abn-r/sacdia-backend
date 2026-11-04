/**
 * Pure data: global role alias expansion. Kept free of Nest imports so the
 * authz catalog generator (scripts/authz) can import it. Re-exported by
 * global-roles.guard.ts.
 */
import type { GlobalRoleType } from '../decorators/global-roles.decorator';
import { FIELD_ADMIN_ROLES } from '../authorization/role-sets';
import { GlobalRole } from '../authorization/roles';

export { FIELD_ADMIN_ROLES };

export const GLOBAL_ROLE_ALIASES: Record<GlobalRoleType, GlobalRoleType[]> = {
  [GlobalRole.SUPER_ADMIN]: [GlobalRole.SUPER_ADMIN],
  [GlobalRole.ADMIN]: [GlobalRole.ADMIN, GlobalRole.ASSISTANT_ADMIN],
  [GlobalRole.ASSISTANT_ADMIN]: [GlobalRole.ASSISTANT_ADMIN, GlobalRole.ADMIN],
  // Local-field directors do what coordinators do (product 2026-09-15).
  // One-level expansion: listing `coordinator` admits LF without union/dia.
  [GlobalRole.COORDINATOR]: [
    GlobalRole.COORDINATOR,
    GlobalRole.ZONE_COORDINATOR,
    GlobalRole.GENERAL_COORDINATOR,
    GlobalRole.DIRECTOR_LF,
    GlobalRole.ASSISTANT_LF,
  ],
  [GlobalRole.ZONE_COORDINATOR]: [
    GlobalRole.ZONE_COORDINATOR,
    GlobalRole.GENERAL_COORDINATOR,
  ],
  [GlobalRole.GENERAL_COORDINATOR]: [GlobalRole.GENERAL_COORDINATOR],
  [GlobalRole.PASTOR]: [GlobalRole.PASTOR],
  [GlobalRole.USER]: [GlobalRole.USER],
  [GlobalRole.DIRECTOR_LF]: [...FIELD_ADMIN_ROLES],
  [GlobalRole.ASSISTANT_LF]: [...FIELD_ADMIN_ROLES],
  [GlobalRole.DIRECTOR_UNION]: [...FIELD_ADMIN_ROLES],
  [GlobalRole.ASSISTANT_UNION]: [...FIELD_ADMIN_ROLES],
  [GlobalRole.DIRECTOR_DIA]: [...FIELD_ADMIN_ROLES],
  [GlobalRole.ASSISTANT_DIA]: [...FIELD_ADMIN_ROLES],
};
