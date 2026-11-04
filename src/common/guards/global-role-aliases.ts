/**
 * Pure data: global role alias expansion. Kept free of Nest imports so the
 * authz catalog generator (scripts/authz) can import it. Re-exported by
 * global-roles.guard.ts.
 */
import type { GlobalRoleType } from '../decorators/global-roles.decorator';

// All field-level admin roles (lf/union/dia, director/assistant) share an
// identical permission set via JOIN-copy from `assistant-lf` in
// prisma/seeds/role-permissions.seed.sql. They are therefore treated as
// mutually equivalent at the guard level — consistent with the existing
// admin/assistant-admin symmetric pairing.
export const FIELD_ADMIN_ROLES: GlobalRoleType[] = [
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'director-dia',
  'assistant-dia',
];

export const GLOBAL_ROLE_ALIASES: Record<GlobalRoleType, GlobalRoleType[]> = {
  'super-admin': ['super-admin'],
  admin: ['admin', 'assistant-admin'],
  'assistant-admin': ['assistant-admin', 'admin'],
  // Local-field directors do what coordinators do (product 2026-09-15).
  // One-level expansion: listing `coordinator` admits LF without union/dia.
  coordinator: [
    'coordinator',
    'zone-coordinator',
    'general-coordinator',
    'director-lf',
    'assistant-lf',
  ],
  'zone-coordinator': ['zone-coordinator', 'general-coordinator'],
  'general-coordinator': ['general-coordinator'],
  pastor: ['pastor'],
  user: ['user'],
  'director-lf': FIELD_ADMIN_ROLES,
  'assistant-lf': FIELD_ADMIN_ROLES,
  'director-union': FIELD_ADMIN_ROLES,
  'assistant-union': FIELD_ADMIN_ROLES,
  'director-dia': FIELD_ADMIN_ROLES,
  'assistant-dia': FIELD_ADMIN_ROLES,
};
