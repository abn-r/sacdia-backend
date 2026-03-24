-- ============================================================================
-- SACDIA Role Slot Limits Seed
-- ============================================================================
-- Idempotent: uses INSERT ... ON CONFLICT DO UPDATE (upsert).
-- Run with: /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -f prisma/seeds/role-slot-limits.seed.sql
--
-- Depends on: role_slot_limits table (Wave 3 migration must run first)
--             seed.ts roles (roles must exist first)
--
-- Roles WITHOUT a row here have NO limit (counselor, instructor, member).
-- ============================================================================

BEGIN;

-- director: max 1 per section
INSERT INTO role_slot_limits (role_slot_limit_id, role_id, max_per_section)
SELECT gen_random_uuid(), role_id, 1
FROM roles WHERE role_name = 'director'
ON CONFLICT (role_id) DO UPDATE SET max_per_section = EXCLUDED.max_per_section;

-- deputy_director: max 2 per section
INSERT INTO role_slot_limits (role_slot_limit_id, role_id, max_per_section)
SELECT gen_random_uuid(), role_id, 2
FROM roles WHERE role_name = 'deputy-director'
ON CONFLICT (role_id) DO UPDATE SET max_per_section = EXCLUDED.max_per_section;

-- secretary: max 1 per section
INSERT INTO role_slot_limits (role_slot_limit_id, role_id, max_per_section)
SELECT gen_random_uuid(), role_id, 1
FROM roles WHERE role_name = 'secretary'
ON CONFLICT (role_id) DO UPDATE SET max_per_section = EXCLUDED.max_per_section;

-- treasurer: max 1 per section
INSERT INTO role_slot_limits (role_slot_limit_id, role_id, max_per_section)
SELECT gen_random_uuid(), role_id, 1
FROM roles WHERE role_name = 'treasurer'
ON CONFLICT (role_id) DO UPDATE SET max_per_section = EXCLUDED.max_per_section;

-- secretary-treasurer: max 1 per section (combined role)
INSERT INTO role_slot_limits (role_slot_limit_id, role_id, max_per_section)
SELECT gen_random_uuid(), role_id, 1
FROM roles WHERE role_name = 'secretary-treasurer'
ON CONFLICT (role_id) DO UPDATE SET max_per_section = EXCLUDED.max_per_section;

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT
  rsl.role_slot_limit_id,
  r.role_name,
  r.role_category,
  rsl.max_per_section
FROM role_slot_limits rsl
JOIN roles r ON r.role_id = rsl.role_id
ORDER BY rsl.max_per_section, r.role_name;
