-- Family profiles Phase 4 (4c-1): rename the sensitive family permissions
--   legal_representative:read   -> guardianship:read
--   legal_representative:update -> guardianship:update
-- The legal_representatives feature is gone; the permissions now gate the
-- guardianship-based family card (users.guardianships block).
--
-- Idempotent DO block, covers every state of each pair:
--   old only => UPDATE the permissions row in place (permission_id preserved, so
--               role_permissions / users_permissions keep working untouched);
--   both     => merge role_permissions and users_permissions onto the new row
--               (ON CONFLICT DO NOTHING), then delete the old rows
--               (seed ran first, or this migration re-ran);
--   neither  => insert the new permission row (fresh database).
-- authz:rename legal_representative:read -> guardianship:read
-- authz:rename legal_representative:update -> guardianship:update
-- (marker lines read by scripts/authz/catalog-source.ts: the old keys leave the
-- generated permission catalog of the three repos.)
--
-- The `users:*` legacy fallback is NOT touched (sunset 2027-03-31).
--
-- Rollback = the inverse DML (swap the names below).

DO $$
DECLARE
  pair RECORD;
  old_id uuid;
  new_id uuid;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('legal_representative:read',   'guardianship:read',   'Read user guardianship (family) info'),
      ('legal_representative:update', 'guardianship:update', 'Update user guardianship (family) access')
    ) AS t(old_name, new_name, new_description)
  LOOP
    SELECT permission_id INTO old_id FROM permissions WHERE permission_name = pair.old_name;
    SELECT permission_id INTO new_id FROM permissions WHERE permission_name = pair.new_name;

    IF old_id IS NOT NULL AND new_id IS NULL THEN
      UPDATE permissions
         SET permission_name = pair.new_name,
             description = pair.new_description,
             modified_at = now()
       WHERE permission_id = old_id;

    ELSIF old_id IS NOT NULL AND new_id IS NOT NULL THEN
      INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
      SELECT gen_random_uuid(), rp.role_id, new_id, rp.active
        FROM role_permissions rp
       WHERE rp.permission_id = old_id
      ON CONFLICT (role_id, permission_id) DO NOTHING;

      INSERT INTO users_permissions (user_permission_id, user_id, permission_id, active)
      SELECT gen_random_uuid(), up.user_id, new_id, up.active
        FROM users_permissions up
       WHERE up.permission_id = old_id
      ON CONFLICT (user_id, permission_id) DO NOTHING;

      DELETE FROM role_permissions WHERE permission_id = old_id;
      DELETE FROM users_permissions WHERE permission_id = old_id;
      DELETE FROM permissions WHERE permission_id = old_id;

    ELSIF old_id IS NULL AND new_id IS NULL THEN
      INSERT INTO permissions (permission_id, permission_name, description, active)
      VALUES (gen_random_uuid(), pair.new_name, pair.new_description, true);
    END IF;
    -- new only: nothing to do.
  END LOOP;
END
$$;
