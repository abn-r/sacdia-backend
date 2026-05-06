-- 20260505000000_grant_member_rankings_read_self_to_club_staff
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Migration 20260429000002_enrollment_rankings_seeds introduced the
-- member_rankings RBAC permission matrix (spec §4.7). That migration granted
-- member_rankings:read_self only to the 'member' role (CLUB category) and to
-- 'admin'/'super_admin'.
--
-- However, CLUB staff roles (director, deputy-director, counselor, secretary,
-- treasurer, secretary-treasurer, instructor) are ALL enrolled club members —
-- they carry an active membership record alongside their staff appointment.
-- Without this grant they see a 403 on GET /v1/rankings/me even though they
-- are, by definition, members with ranking data.
--
-- This is a UX gap: a director who opens the Rankings tab in the mobile app
-- cannot see their own ranking card, despite having the club-wide read
-- permissions (member_rankings:read_section, member_rankings:read_club).
--
-- FIX: grant member_rankings:read_self to all 7 CLUB staff roles.
-- Idempotent: ON CONFLICT DO NOTHING, safe to re-run.

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_name IN (
  'director',
  'deputy-director',
  'counselor',
  'secretary',
  'treasurer',
  'secretary-treasurer',
  'instructor'
)
  AND r.role_category = 'CLUB'
  AND p.permission_name = 'member_rankings:read_self'
ON CONFLICT DO NOTHING;
