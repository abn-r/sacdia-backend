# Release Runbook — Permission Scope Cleanup Phase 3

**Change**: `permission-scope-cleanup-phase-3`
**Type**: Cleanup / RBAC migration tail
**Predecessor**: `permission-scope-separation` (archive #1562, W2)
**Window**: Single release, no feature flag
**Soft-delete only**: Hard-delete of `permissions` rows is forbidden (audit FK preservation)

## Summary

Retires three legacy permission strings now superseded by scope-separated equivalents:

| Legacy (retire) | Replacement(s) |
|---|---|
| `users:update` | `users:update_profile` |
| `classes:update` | `classes:submit_progress`, `classes:validate` |
| `user_honors:update` | `user_honors:submit`, `user_honors:validate` |

The `permissions` rows stay in DB with `active = false` so historical audit references resolve. The new `user_honors:submit` is granted to `user` and `member` roles as part of this release to prevent a write-access regression after the legacy row is deactivated.

## Pre-flight

1. Confirm `permissions.active` column exists in target environment (added in Phase 2).
2. Confirm new permission rows exist and are granted to the correct roles in seeds (review `prisma/seeds/role-permissions.seed.sql`).
3. Snapshot current grant counts for the three legacy strings:
   ```sql
   SELECT p.permission_name, COUNT(rp.*) AS grants, p.active
   FROM permissions p
   LEFT JOIN role_permissions rp ON rp.permission_id = p.permission_id
   WHERE p.permission_name IN ('users:update','classes:update','user_honors:update')
   GROUP BY p.permission_name, p.active;
   ```
4. CI green on `feat/permission-scope-cleanup-phase-3` branch — including:
   - `pnpm test src/common/guards/permissions-metadata.spec.ts`
   - `pnpm test src/common/guards/permissions.guard.spec.ts`
   - `pnpm test src/common/seeds/__tests__/permissions-cleanup.spec.ts`

## Deploy Order (strict)

The order avoids a window where a client still calls a legacy permission while the role grant has been removed.

### Step 1 — Backend (sacdia-backend)

Deploy NestJS API with the decorator swaps:
- `UserFoldersController` enroll/updateSection/delete → `users:update_profile`
- `UserCertificationsController` enroll/updateProgress/delete → `users:update_profile`
- `getSensitiveUserSubresourceFallbackPermission` update mode → `users:update_profile`

Smoke (after deploy, against staging):
```bash
# Owner self-update (200) — still works via owner-bypass + new permission
curl -H "Authorization: Bearer $OWNER_JWT" -X PATCH \
  $API/users/$USER_ID/folders/$FOLDER_ID/sections/$SECTION_ID

# Admin update (200) — admin retains users:update_profile via Phase 2 seeds
curl -H "Authorization: Bearer $ADMIN_JWT" -X PATCH \
  $API/users/$USER_ID/folders/$FOLDER_ID/sections/$SECTION_ID

# Limited role without users:update_profile (403)
curl -H "Authorization: Bearer $LIMITED_JWT" -X PATCH \
  $API/users/$USER_ID/folders/$FOLDER_ID/sections/$SECTION_ID
```

Repeat the matrix on `/users/:userId/certifications/:certId` (POST enroll, PATCH progress, DELETE).

### Step 2 — Admin (sacdia-admin)

Deploy Next.js panel with `permission-utils.ts` swap:
- `SENSITIVE_USER_UPDATE_KEYS` entries (health, emergency_contacts, legal_representative, post_registration) now reference `USERS_UPDATE_PROFILE`.

Smoke: load a user detail page and confirm the four sensitive cards still render edit affordances for an admin session and remain hidden for a non-privileged session.

### Step 3 — App (sacdia-app)

Deploy Flutter build with `authorization_utils.dart` change:
- `_sensitiveFamilyUpdatePermissions` no longer references `users:update`.

Smoke: log in as admin in the staging build, open user detail, confirm sensitive sections (health, emergency contact, legal rep, post-registration) are editable.

### Step 4 — Role-permissions seed

Apply the role-permission cleanup against the target DB:

```bash
psql "$DATABASE_URL" -f sacdia-backend/prisma/seeds/role-permissions.seed.sql
```

Effect:
- Idempotent `DELETE FROM role_permissions USING permissions p WHERE ... IN (...)` removes all grants for the three legacy strings.
- Re-INSERT of role grants no longer references the legacy strings (they were stripped from every IN-array).
- `user` and `member` roles now receive `user_honors:submit`.

Verify post-apply:
```sql
SELECT COUNT(*) FROM role_permissions rp
JOIN permissions p ON p.permission_id = rp.permission_id
WHERE p.permission_name IN ('users:update','classes:update','user_honors:update');
-- expect 0

SELECT r.role_name, p.permission_name
FROM role_permissions rp
JOIN roles r ON r.role_id = rp.role_id
JOIN permissions p ON p.permission_id = rp.permission_id
WHERE r.role_name IN ('user','member')
  AND p.permission_name = 'user_honors:submit';
-- expect 2 rows
```

### Step 5 — Permissions soft-delete

Apply the `permissions` seed to flip `active = false` on the three legacy rows:

```bash
psql "$DATABASE_URL" -f sacdia-backend/prisma/seeds/permissions.seed.sql
```

The relevant statement is idempotent (`AND active = true` guard prevents `modified_at` churn on re-runs):

```sql
UPDATE permissions
SET active = false, modified_at = now()
WHERE permission_name IN ('users:update','classes:update','user_honors:update')
  AND active = true;
```

Verify:
```sql
SELECT permission_name, active FROM permissions
WHERE permission_name IN ('users:update','classes:update','user_honors:update');
-- expect all three rows with active = false
```

## Post-deploy smoke matrix (staging, after Step 5)

Run against the six endpoints touched in Step 1:

| Endpoint | Method | Expected for admin | Expected for owner | Expected for stranger |
|---|---|---|---|---|
| `/users/:id/folders` | POST enroll | 201 | 201 | 403 |
| `/users/:id/folders/.../sections/...` | PATCH | 200 | 200 | 403 |
| `/users/:id/folders/...` | DELETE | 200 | 200 | 403 |
| `/users/:id/certifications` | POST enroll | 201 | 201 | 403 |
| `/users/:id/certifications/:cid` | PATCH | 200 | 200 | 403 |
| `/users/:id/certifications/:cid` | DELETE | 200 | 200 | 403 |

Also confirm the `class_section_progress` and `user_honors` write paths still authorize correctly under `classes:submit_progress` / `classes:validate` and `user_honors:submit` / `user_honors:validate` (unchanged in Phase 3 but coupled via the legacy retirement).

## Rollback

If a regression is detected after Step 5:

```sql
BEGIN;

-- Reactivate legacy rows
UPDATE permissions
SET active = true, modified_at = now()
WHERE permission_name IN ('users:update','classes:update','user_honors:update')
  AND active = false;

-- Restore role grants from a pre-deploy snapshot. There is no automatic
-- reverse of the IN-array stripping — restore from the prior commit of
-- role-permissions.seed.sql, e.g.:
--   git show <prior-commit>:prisma/seeds/role-permissions.seed.sql | psql "$DATABASE_URL"

COMMIT;
```

Then redeploy the previous backend/admin/app builds (Steps 1-3 in reverse).

Note: Rolling back does NOT restore `user_honors:submit` to `user`/`member` — that grant is additive and remains beneficial. Only revert it manually if the new permission itself is found defective.

## Acceptance

Release is considered complete when:
- All three legacy `permissions` rows have `active = false`.
- Zero `role_permissions` rows reference the three legacy strings.
- Smoke matrix above passes 18/18.
- No `403`/`5xx` spike on the six touched endpoints in the first hour post-deploy.
