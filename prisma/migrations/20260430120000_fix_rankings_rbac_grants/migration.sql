-- 20260430120000_fix_rankings_rbac_grants
-- Migration 20260429000002 queried role_name = 'director-club' / 'assistant-club',
-- which do not exist in the canonical seed. Real CLUB role_names per
-- prisma/seeds/role-permissions.seed.sql are:
--   'director'          (line 868)
--   'deputy-director'   (line 739)
--   'counselor'         (line 206)
--   'secretary'         (line 318)
--   'treasurer'         (line 463)
--   'secretary-treasurer' (line 593)
--   'member'            (line 115)
--
-- Spec §4.7 (2026-04-29-clasificacion-seccion-miembro-design.md) mandates:
--
--   Permission                    | dir-club | asst-club | counselor
--   ------------------------------|:--------:|:---------:|:---------:
--   member_rankings:read_section  |    ✓     |     ✓     |
--   member_rankings:read_club     |    ✓     |     ✓     |
--   section_rankings:read_club    |    ✓     |     ✓     |
--
-- In canonical role_names:
--   'dir-club'  → 'director'        (role_category = 'CLUB')
--   'asst-club' → 'deputy-director' (role_category = 'CLUB')
--
-- The spec does NOT grant read_section/read_club/section_rankings:read_club
-- to 'counselor'. The conservative default (director + deputy-director only)
-- is consistent with spec §4.7.
--
-- This corrective migration grants the intended 8.4-A ranking permissions to
-- canonical role names. Idempotent (ON CONFLICT DO NOTHING).

-- director (CLUB) — full club-level read
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'director'
    AND r.role_category = 'CLUB'
    AND p.permission_name IN (
      'member_rankings:read_section',
      'member_rankings:read_club',
      'section_rankings:read_club'
    )
ON CONFLICT DO NOTHING;

-- deputy-director (CLUB) — same club-level read as director
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'deputy-director'
    AND r.role_category = 'CLUB'
    AND p.permission_name IN (
      'member_rankings:read_section',
      'member_rankings:read_club',
      'section_rankings:read_club'
    )
ON CONFLICT DO NOTHING;
