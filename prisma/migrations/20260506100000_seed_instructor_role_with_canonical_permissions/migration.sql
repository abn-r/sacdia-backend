-- Migration: 20260506100000_seed_instructor_role_with_canonical_permissions
-- Date: 2026-05-06
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The 'instructor' CLUB role exists in development but is MISSING from
-- staging and production `roles` tables. Users assigned this role would
-- be unauthenticated against any RBAC check.
--
-- Additionally, dev's instructor role had only `member_rankings:read_self`
-- granted (1 perm) instead of the canonical 36 permissions defined in
-- `prisma/seeds/role-permissions.seed.sql`.
--
-- This migration:
--   1. INSERTs the instructor CLUB role into any branch missing it.
--   2. Grants the canonical 36 permissions defined in role-permissions.seed.sql,
--      keeping prod/staging/dev aligned with the seed source of truth.
--
-- Idempotent:
--   - Role insert uses ON CONFLICT (role_name) DO NOTHING.
--   - Permission grants use ON CONFLICT (role_id, permission_id) DO NOTHING.
--
-- Permissions are filtered by `p.active = true` so any deactivated permission
-- is excluded automatically (matches seed behaviour).

INSERT INTO roles (role_name, role_category, description, active)
VALUES ('instructor', 'CLUB', 'Role: instructor', true)
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'instructor'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:submit',
    'user_honors:delete',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities (read + attendance)
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- User progression (view other users' progression)
    'user_certifications:read',
    'user_folders:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
