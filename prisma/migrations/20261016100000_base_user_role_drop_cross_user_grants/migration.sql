-- Migration: 20261016100000_base_user_role_drop_cross_user_grants
-- Security fix (broken object-level authorization). The GLOBAL base role `user`
-- is held by every signed-up account. On owner-aware routes
-- (`@AuthorizationResource({ type: 'user' })` / `@SensitiveUserSubresource`)
-- the owner already passes through the PermissionsGuard owner bypass without
-- any permission, so these grants were only ever consulted for a NON-owner and
-- let any signed-in user read/write another user's profile, health data,
-- emergency contacts, legal representative, post-registration status and
-- honors. `users:update_profile` is also the legacy fallback for every
-- sensitive `update` route.
--
-- Data only: deletes exactly these grants of the base role. Touches no other
-- role, no direct user grant (users_permissions) and no permission row.
-- Kept on purpose: classes:read, validation:read, requests:read, clubs:read,
-- club_sections:read, catalogs:read, certifications:read, users:read,
-- dashboard:read, achievements:read, resources:read, resource_categories:read
-- (needed by global/club-scoped routes or by app UI gating).
--
-- Render runs `prisma migrate deploy` at the END OF THE BUILD. Re-runnable: on a
-- clean database the DELETE affects 0 rows. Rollback (manual, per Neon branch):
-- re-run prisma/seeds/role-permissions.seed.sql from the previous commit.
DELETE FROM role_permissions
USING roles r, permissions p
WHERE role_permissions.role_id = r.role_id
  AND role_permissions.permission_id = p.permission_id
  AND r.role_name = 'user'
  AND r.role_category = 'GLOBAL'
  AND p.permission_name IN (
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',
    'post_registration:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:submit',
    'user_honors:delete'
  );
