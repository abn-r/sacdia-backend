-- Grant consent:verify to the GLOBAL coordinator roles (DML only; precedent 20261022130000_seed_family_permissions).
--   consent:verify  verify a minor's signed consent form WITHOUT approving the membership
--                   GLOBAL coordinator, zone-coordinator, general-coordinator
-- 20261022130000 left them out (B11): PermissionsGuard could not resolve a coordinator's territory.
-- It now does, on the routes that opt in with `coordinatorSections` (verify-consent, the
-- membership-requests list and the consent-evidence form): the coordinator ROLE must carry the
-- permission and coordinator_assignments (GENERAL / ZONE / SECTION) must cover the section.
-- Approving the membership still needs club_members:approve, which coordinators do not hold.
-- consent:verify itself was created by 20261022130000; this migration only adds role rows.
-- Idempotent: ON CONFLICT DO NOTHING, so applying it twice changes nothing. Inactive roles or an
-- inactive permission are skipped. The same rows live in prisma/seeds/role-permissions.seed.sql.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('coordinator', 'zone-coordinator', 'general-coordinator')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'consent:verify'
ON CONFLICT (role_id, permission_id) DO NOTHING;
