-- Permissions that only the seed created, and the seed cleanups again.
--
-- 1. Thirteen active permissions exist only in prisma/seeds/permissions.seed.sql.
--    No migration inserts them, so every grant a migration writes for them is a
--    no-op on a database where the seed never ran (staging, production), and
--    their routes answer 403 to everyone there: user creation, insurance
--    configure and review, certifications, camporee supplies.
-- 2. 20261030140000 re-applied the platform admin wildcards, so assistant-admin
--    holds grants the seed cleanups take away (field payment orders, camporee
--    orders, and on development insurance review, certifications and supplies).
--    Where the legacy folder permissions are still active (staging), the
--    platform admins picked those up too.
--
-- In order: insert the thirteen permissions with their seed rows; retire the
-- legacy permissions as permissions.seed.sql does; re-apply the platform admin
-- wildcards without wiping roles; grant users:create and users:bulk_create to
-- the territorial roles; re-run the role-permissions.seed.sql tail that holds
-- every per-permission cleanup and its grants (from the
-- camporees:register_active_section block to the camporee supplies blocks),
-- copied verbatim.
--
-- Idempotent: upserts, ON CONFLICT and deletes of rows already gone.

INSERT INTO permissions (permission_name, description, active) VALUES
  ('users:create', 'Create new users (manual single creation with email invite)', true),
  ('users:bulk_create', 'Bulk create users from uploaded Excel/CSV file', true),
  ('insurance:review', 'Confirm, reject, or reverse insurance purchases in the effective Local Field', true),
  ('insurance:configure', 'Configure insurance products and cycles for a Local Field', true),
  ('certifications:configure', 'Create/edit certification definitions, versions, eligibility rules and requirement trees (DRAFT only)', true),
  ('certifications:publish', 'Publish or retire a certification version', true),
  ('certifications:review', 'Review submitted certification requirements/closeouts', true),
  ('certifications:certify', 'Approve final certification review and mark member as certified', true),
  ('camporee-supplies:read', 'Read camporee supply catalog, plans and reports within own scope', true),
  ('camporee-supplies:plan', 'Draft, submit and adjust the enrolled section supply plan', true),
  ('camporee-supplies:configure', 'Configure supply cutoff, delivery slots and products for an organized camporee', true),
  ('camporee-supplies:review-pay', 'Mark camporee supply payment documents paid or refunded in the effective Local Field', true),
  ('camporee-supplies:deliver', 'Record partial supply delivery from Local Field to the club section', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- Legacy permissions retired by permissions.seed.sql, and their grants.
UPDATE permissions SET active = false, modified_at = now()
WHERE active = true
  AND permission_name IN (
    'certifications:manage',
    'classes:update',
    'classes:validate',
    'folders:manage',
    'folders:read',
    'qr:issue_self',
    'user_folders:manage',
    'user_folders:read',
    'user_honors:update',
    'users:update'
  );

DELETE FROM role_permissions
USING permissions p
WHERE role_permissions.permission_id = p.permission_id
  AND p.permission_name IN (
    'certifications:manage',
    'classes:update',
    'classes:validate',
    'folders:manage',
    'folders:read',
    'qr:issue_self',
    'user_folders:manage',
    'user_folders:read',
    'user_honors:update',
    'users:update'
  );

-- Platform admin wildcards (seed ADMIN, ASSISTANT-ADMIN and SUPER_ADMIN
-- blocks, without the role wipe). The cleanups below trim them.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name NOT LIKE '%:delete'
  AND p.permission_name <> 'audit:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'assistant-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name NOT LIKE '%:delete'
  AND p.permission_name <> 'audit:read'
  AND p.permission_name <> 'permissions:assign'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- users:create and users:bulk_create: the seed lists them for assistant-lf,
-- and its JOIN copy blocks hand them to director-lf and the union and
-- division roles.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'assistant-lf',
    'director-lf',
    'assistant-union',
    'director-union',
    'assistant-dia',
    'director-dia'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('users:create', 'users:bulk_create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ===== role-permissions.seed.sql tail (verbatim) =====

-- `camporees:register_active_section` is intentionally narrower than the
-- platform-admin wildcards above: only a CLUB director may register their
-- currently active section. Re-seeding also removes any stale or accidental
-- grant to every other role.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporees:register_active_section'
  AND NOT (
    r.role_name = 'director'
    AND r.role_category = 'CLUB'
  );

-- `camporees:register` is reserved for territorial Camporee organizers.
-- This cleanup runs after inheritance and platform-admin wildcard grants so
-- no CLUB, division, admin, or super-admin role retains the capability.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporees:register'
  AND NOT (
    r.role_name IN ('assistant-lf', 'director-lf', 'assistant-union', 'director-union')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf', 'assistant-union', 'director-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporees:register'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Insurance configuration belongs to Local Field leadership and, since
-- 2026-10-30, to the platform admins (admin, super-admin), who configure it
-- for a local field they name. This cleanup runs after all inherited/global
-- role grants so union, DIA, assistant-admin and club roles cannot receive it.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'insurance:configure'
  AND NOT (
    r.role_name IN ('assistant-lf', 'director-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'insurance:configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Purchase review is a separate capability from configuration. It is granted
-- only to Local Field leadership and platform administrators; assistant-admin
-- is intentionally excluded even if broad inherited grants exist.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'insurance:review'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'insurance:review'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Certification configuration/publish are restricted to Local Field
-- leadership. Admin/super-admin already receive these via their broad
-- wildcard grants, so this cleanup only needs to scope out other roles that
-- might have inherited them through global grants.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Certification review/certify follow the same Local Field + platform admin
-- pattern as insurance:review.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- BEGIN family permissions (phase 3c)
-- ============================
-- dependents:create / consent:verify (director-created minors, independent consent verification)
-- ============================
-- Must live here: role blocks DELETE+INSERT wipe grants if they are not re-asserted after every
-- seed run. Same rows as migration 20261022130000_seed_family_permissions; admin, assistant-admin and
-- super-admin get both through their wildcard blocks above.
-- GLOBAL coordinator / zone-coordinator / general-coordinator get consent:verify in their own
-- block below (migration 20261023120000_grant_consent_verify_to_coordinators).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'deputy-director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'dependents:create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'deputy-director', 'secretary', 'secretary-treasurer')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'consent:verify'
ON CONFLICT (role_id, permission_id) DO NOTHING;
-- END family permissions (phase 3c)

-- BEGIN coordinator consent:verify
-- ============================
-- consent:verify for GLOBAL coordinator roles (verify a minor's consent inside their assigned sections)
-- ============================
-- Same rows as migration 20261023120000_grant_consent_verify_to_coordinators. Must stay after the
-- coordinator role blocks: their DELETE+INSERT would wipe it. The guard scopes it to the sections
-- covered by coordinator_assignments, only on routes that opt in with `coordinatorSections`.
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
-- END coordinator consent:verify

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT
  r.role_name,
  r.role_category,
  COUNT(*) AS permission_count
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.role_id
WHERE rp.active = true
GROUP BY r.role_name, r.role_category
ORDER BY permission_count, r.role_name;

-- Ensure Camporee event read access for club operational roles (mobile detail).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'treasurer',
    'counselor'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.permission_name = 'camporee_events:read'
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- Field Payment Orders (órdenes de pago territoriales)
-- ============================================================================
-- read: mirrors insurance:read (club operational roles + territorial readers).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'counselor', 'secretary', 'treasurer', 'secretary-treasurer',
    'deputy-director', 'director'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- create / upload-proof / cancel: mirrors insurance:create (club directive
-- roles that operate money) + LF leadership.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('secretary', 'treasurer', 'secretary-treasurer', 'director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'field-payment-orders:create',
    'field-payment-orders:upload-proof',
    'field-payment-orders:cancel'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'field-payment-orders:create',
    'field-payment-orders:upload-proof',
    'field-payment-orders:cancel'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- review: same Local Field + platform admin pattern as insurance:review.
-- Maker-checker is enforced in the service (proof uploader cannot approve).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'field-payment-orders:review'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:review'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- configure: Local Field payment instructions (bank/cashier), same grantees
-- as review (LF leadership + platform admins).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'field-payment-orders:configure'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- ============================================================================
-- Camporee Orders (pedidos de mercancía por camporee)
-- ============================================================================
-- read: club issuers + territorial readers (LF / union / division / admin).
-- Counselor is intentionally excluded.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'treasurer'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
    'admin',
    'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- create / upload-proof: club issuer roles only (not counselor, not LF caja).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN (
    'camporee-orders:create',
    'camporee-orders:upload-proof'
  )
  AND NOT (
    r.role_name IN (
      'director',
      'deputy-director',
      'secretary',
      'secretary-treasurer',
      'treasurer'
    )
    AND r.role_category = 'CLUB'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'treasurer'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'camporee-orders:create',
    'camporee-orders:upload-proof'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- distribute: only the club director of the issuing section.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporee-orders:distribute'
  AND NOT (
    r.role_name = 'director'
    AND r.role_category = 'CLUB'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'director'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-orders:distribute'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- catalog-manage: territorial library owners (LF / union / division / admin).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporee-orders:catalog-manage'
  AND NOT (
    r.role_name IN (
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'director-dia',
      'assistant-dia',
      'admin',
      'super-admin'
    )
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
    'admin',
    'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-orders:catalog-manage'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- offering-configure: camporee organizers (LF and union) + platform admins.
-- Division-only roles do not own camporees and must not receive this grant.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporee-orders:offering-configure'
  AND NOT (
    r.role_name IN (
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'admin',
      'super-admin'
    )
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'admin',
    'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-orders:offering-configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- review / authorize-without-proof / deliver: Local Field caja + platform admins.
-- Union and division directors never review LF payment.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN (
    'camporee-orders:review',
    'camporee-orders:authorize-without-proof',
    'camporee-orders:deliver'
  )
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'camporee-orders:review',
    'camporee-orders:authorize-without-proof',
    'camporee-orders:deliver'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- ============================================================================
-- Camporee Supplies (insumos diarios; cobra el Campo Local)
-- ============================================================================
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director',
    'secretary',
    'secretary-treasurer'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-supplies:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'director-dia',
    'assistant-dia',
    'admin',
    'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-supplies:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporee-supplies:plan'
  AND NOT (
    r.role_name IN ('director', 'secretary', 'secretary-treasurer')
    AND r.role_category = 'CLUB'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'secretary', 'secretary-treasurer')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-supplies:plan'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporee-supplies:configure'
  AND NOT (
    r.role_name IN (
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'admin',
      'super-admin'
    )
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director-lf',
    'assistant-lf',
    'director-union',
    'assistant-union',
    'admin',
    'super-admin'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporee-supplies:configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN (
    'camporee-supplies:review-pay',
    'camporee-supplies:deliver'
  )
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'camporee-supplies:review-pay',
    'camporee-supplies:deliver'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();
