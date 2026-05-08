-- Migration: 20260506000000_rename_roles_to_hyphen_convention
-- Date: 2026-05-06
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Standardize all role names to hyphen-separated form.
-- Pre-existing drift had a few roles using underscores (super_admin,
-- assistant_admin, deputy_director) while every other role used hyphens.
-- Backend code, Flutter app, and admin panel all expect a single canonical
-- form. The product owner chose hyphens.
--
-- This rename is safe because:
--   - 0 users have any of these underscored roles assigned in prod (audited).
--   - users_roles foreign keys point to role_id, not role_name, so existing
--     assignments survive the rename.
--   - The UPDATE is idempotent (no-op when role_name already has no underscore).

UPDATE roles SET role_name = REPLACE(role_name, '_', '-') WHERE role_name LIKE '%\_%' ESCAPE '\';
