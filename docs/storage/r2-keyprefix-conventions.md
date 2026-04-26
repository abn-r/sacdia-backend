# R2 Storage — Key-Prefix and Public URL Conventions

Last updated: **2026-04-23**

This document describes the naming conventions for Cloudflare R2 bucket environment
variables, the two URL construction patterns that currently coexist in the codebase,
the runtime detection logic that bridges them, and the recommended migration path to a
consistent bare-domain form.

---

## 1. Bucket Inventory

The service layer resolves bucket configuration through three env-var groups per bucket:

| Alias | `R2_BUCKET_*` env var | `R2_PUBLIC_URL_*` env var | `R2_KEY_PREFIX_*` env var | keyPrefix (dev) | publicBaseUrl path tail (dev) | Public? | URL pattern |
|---|---|---|---|---|---|---|---|
| `USER_PROFILES` | `R2_BUCKET_USER_PROFILES` | `R2_PUBLIC_URL_USER_PROFILES` | `R2_KEY_PREFIX_USER_PROFILES` | `user-profiles` | (root — bare domain) | Yes | **bare** |
| `HONORS_IMAGES` | `R2_BUCKET_HONORS_IMAGES` | `R2_PUBLIC_URL_HONORS_IMAGES` | `R2_KEY_PREFIX_HONORS_IMAGES` | `honors` | `/honors` | Yes | **embedded** |
| `HONORS_PDF` | `R2_BUCKET_HONORS_PDF` | `R2_PUBLIC_URL_HONORS_PDF` | `R2_KEY_PREFIX_HONORS_PDF` | `honors_pdf` | `/honors_pdf` | Yes | **embedded** |
| `CLASSES_DOCUMENTS` | `R2_BUCKET_CLASSES_DOCUMENTS` | `R2_PUBLIC_URL_CLASSES_DOCUMENTS` | `R2_KEY_PREFIX_CLASSES_DOCUMENTS` | `classes` | `/classes` | Yes | **embedded** |
| `ACTIVITIES_IMAGES` | `R2_BUCKET_ACTIVITIES_IMAGES` | `R2_PUBLIC_URL_ACTIVITIES_IMAGES` | `R2_KEY_PREFIX_ACTIVITIES_IMAGES` | `activities` | `/secure-documents/activities` | No | **embedded** |
| `USERS_HONORS` | `R2_BUCKET_USERS_HONORS` | `R2_PUBLIC_URL_USERS_HONORS` | `R2_KEY_PREFIX_USERS_HONORS` | `users_honors` | `/secure-documents/users_honors` | No | **embedded** |
| `USERS_HONORS_CERT` | `R2_BUCKET_USERS_HONORS_CERT` | `R2_PUBLIC_URL_USERS_HONORS_CERT` | `R2_KEY_PREFIX_USERS_HONORS_CERT` | `users_honors_cert` | `/secure-documents/users_honors_cert` | No | **embedded** |
| `ACHIEVEMENTS_BADGES` | `R2_BUCKET_ACHIEVEMENTS_BADGES` | `R2_PUBLIC_URL_ACHIEVEMENTS_BADGES` | `R2_KEY_PREFIX_ACHIEVEMENTS_BADGES` (default `achievements/badges`) | (unset in dev — falls back to default `achievements/badges`) | (unset — no public URL configured) | Yes | **bare** (no path in URL) |
| `EVIDENCE_FILES` | `R2_BUCKET_EVIDENCE_FILES` | `R2_PUBLIC_URL_EVIDENCE_FILES` | `R2_KEY_PREFIX_EVIDENCE_FILES` | (none — empty) | `/secure-documents` | No | **embedded-only-path** (no keyPrefix to embed; URL path acts as namespace) |
| `INSURANCE_EVIDENCE` | `R2_BUCKET_INSURANCE_EVIDENCE` | `R2_PUBLIC_URL_INSURANCE_EVIDENCE` | `R2_KEY_PREFIX_INSURANCE_EVIDENCE` | `public-files` | `/static-assets` | No | **mismatched** (keyPrefix != urlPath — see anomalies) |
| `CLASS_EVIDENCE` | (shares `R2_BUCKET_EVIDENCE_FILES`) | (shares `R2_PUBLIC_URL_EVIDENCE_FILES`) | `R2_KEY_PREFIX_CLASS_EVIDENCE` (default `class-evidence`) | `class-evidence` | (unset — no public URL configured) | No | **signed-URL-only** (no publicBaseUrl) |
| `RESOURCES_FILES` | `R2_BUCKET_RESOURCES_FILES` | `R2_PUBLIC_URL_RESOURCES_FILES` | `R2_KEY_PREFIX_RESOURCES_FILES` (default `resources`) | (none — empty) | (root — bare domain, no path) | No | **bare** (no prefix, no path) |
| `DATA_EXPORTS` | `R2_BUCKET_DATA_EXPORTS` | `R2_PUBLIC_URL_DATA_EXPORTS` | `R2_KEY_PREFIX_DATA_EXPORTS` (default `data-exports`) | (none — empty) | (unset — no public URL configured) | No | **signed-URL-only** (no publicBaseUrl) |

**Pattern legend**

- **bare** — `R2_PUBLIC_URL_*` is a plain domain with no path (`https://pub-xxx.r2.dev`). The prefix (from keyPrefix or objectKey) is appended by the service.
- **embedded** — `R2_PUBLIC_URL_*` already contains the key prefix as a trailing path segment (`https://pub-xxx.r2.dev/honors`). The service strips the prefix from `objectKey` before appending to avoid doubling.
- **embedded-only-path** — `R2_PUBLIC_URL_*` contains a path segment but the bucket has no keyPrefix. The URL path acts as a namespace; `objectKey` (bare filename) is appended directly.
- **mismatched** — keyPrefix and the URL path segment are different strings. `isKeyPrefixInPublicBaseUrl` returns `false`, so the service appends the full `objectKey` (which includes keyPrefix) after the URL path. This produces `…/urlPath/keyPrefix/filename` — see anomalies.
- **signed-URL-only** — No `R2_PUBLIC_URL_*` set (or set to empty). Objects are always accessed via presigned S3 URLs. The URL construction path in `buildPublicUrl` is never reached for normal access.

> Note: `CLASS_EVIDENCE` shares the physical R2 bucket with `EVIDENCE_FILES` but uses a
> distinct key prefix (`class-evidence`) to namespace objects within that bucket. Because
> neither `CLASS_EVIDENCE` nor `DATA_EXPORTS` have a `R2_PUBLIC_URL_*` set in dev, all
> access to those buckets goes through presigned URLs. Same applies to any future aliases
> that co-locate on an existing bucket.

---

## 1b. Known Anomalies (verified 2026-04-23)

These entries require explicit attention before adding public-access flows or running the
bare-domain migration on the affected buckets.

### INSURANCE_EVIDENCE — mismatched keyPrefix and URL path segment

**What the env shows (dev):**
```
R2_KEY_PREFIX_INSURANCE_EVIDENCE = public-files
R2_PUBLIC_URL_INSURANCE_EVIDENCE = https://<host>/static-assets
```

**What the runtime does:**

`isKeyPrefixInPublicBaseUrl("https://<host>/static-assets", "public-files")` returns
`false` because the URL path tail (`static-assets`) is not equal to, does not end with,
and does not start with the keyPrefix (`public-files`).

Since the check returns `false`, `buildPublicUrl` falls through to the bare-domain branch
and appends `objectKey` (which already carries the `public-files/` prefix) directly after
the base URL path. The constructed CDN URL becomes:

```
https://<host>/static-assets/public-files/<filename>
```

**Risk:** If the actual R2 key for objects in this bucket is `public-files/<filename>`,
the CDN URL segment `/static-assets/public-files/<filename>` will only resolve correctly
if the Cloudflare R2 public bucket is configured to serve from `/static-assets` with the
key path starting at `public-files/` — i.e. the R2 public domain root maps to a URL
prefix of `/static-assets`. This is non-standard and likely a misconfiguration.

**Action required:** Verify the intended R2 public domain setup for INSURANCE_EVIDENCE.
Either:
- Change `R2_PUBLIC_URL_INSURANCE_EVIDENCE` to the bare domain and let `keyPrefix =
  public-files` drive the path (bare pattern), OR
- Change `R2_KEY_PREFIX_INSURANCE_EVIDENCE` to `static-assets` so keyPrefix matches the
  URL path segment (embedded pattern).

Note: `INSURANCE_EVIDENCE` is `isPublic: false` in `getBucketConfig`, so CDN URL
construction is only reached if `isPublic` is later flipped to `true`. For now, signed
URLs are used and the mismatch has no runtime impact — but it should be resolved before
making this bucket public.

### CLASS_EVIDENCE — no publicBaseUrl set (signed-URL-only)

**What the env shows (dev):**
```
R2_KEY_PREFIX_CLASS_EVIDENCE = class-evidence   (env override; code default also class-evidence)
R2_PUBLIC_URL_EVIDENCE_FILES = (unset)
```

`CLASS_EVIDENCE` shares the physical bucket of `EVIDENCE_FILES` and inherits its
`R2_PUBLIC_URL_EVIDENCE_FILES` value. In dev that value is unset, which means
`getRequiredEnv('R2_PUBLIC_URL_EVIDENCE_FILES')` will throw at runtime if ever called for
a CDN-URL-building path. In practice this is safe today because `isPublic: false` ensures
the signed-URL path is always taken.

**Action required:** Confirm the intent is signed-URL-only access. Document this
explicitly per environment. If a public URL is ever needed, a dedicated
`R2_PUBLIC_URL_CLASS_EVIDENCE` env var should be introduced rather than repurposing the
shared `EVIDENCE_FILES` URL.

### DATA_EXPORTS — no publicBaseUrl set (signed-URL-only)

**What the env shows (dev):**
```
R2_KEY_PREFIX_DATA_EXPORTS = (none in dev — falls back to code default data-exports)
R2_PUBLIC_URL_DATA_EXPORTS = (unset)
```

Same situation as `CLASS_EVIDENCE`: `isPublic: false` and no public URL configured. All
access is via presigned S3 URLs. Data exports are internal admin artifacts and should
never be publicly accessible — the current configuration is correct by design.

### RESOURCES_FILES — empty keyPrefix with bare URL root

**What the env shows (dev):**
```
R2_KEY_PREFIX_RESOURCES_FILES = (none — empty, overrides code default of resources)
R2_PUBLIC_URL_RESOURCES_FILES = https://<host>   (bare domain, no path)
```

With no keyPrefix and a bare domain URL, all objects land at the bucket root with URLs of
the form `https://<host>/<filename>`. There is no namespace separation. If this bucket
ever co-locates multiple resource categories, name collisions become a risk.

**Action required:** Decide whether a keyPrefix should be enforced. If not, document the
flat-namespace decision explicitly. Note: `RESOURCES_FILES` is `isPublic: false` in the
service, so CDN URLs are currently unreachable — but the env var setup implies a public
URL was configured (possibly for future use).

---

## 2. URL Construction Patterns

Both patterns produce an identical final URL. They differ only in what the env var
encodes and therefore what logic must be applied at runtime.

### 2a. Bare-domain pattern (target state)

```
R2_PUBLIC_URL_USER_PROFILES = https://pub-abc123.r2.dev
R2_KEY_PREFIX_USER_PROFILES = user-profiles
```

Object key stored in DB: `user-profiles/photo-uuid.jpeg`

URL constructed: `https://pub-abc123.r2.dev/user-profiles/photo-uuid.jpeg`

The service appends `objectKey` directly after the base URL. Because `objectKey` already
carries the prefix, the result is correct with no special handling.

### 2b. Embedded-prefix pattern (current state for most buckets)

```
R2_PUBLIC_URL_HONORS_IMAGES = https://pub-def456.r2.dev/honors
R2_KEY_PREFIX_HONORS_IMAGES = honors
```

Object key stored in DB: `honors/badge-uuid.png`

URL constructed: `https://pub-def456.r2.dev/honors/badge-uuid.png`

Here the base URL already contains `/honors`. If the service prepended the prefix from
`objectKey`, the result would be `…/honors/honors/badge-uuid.png` (double-prefix). The
service must strip the prefix segment from `objectKey` before appending it.

Both patterns produce `https://pub-def456.r2.dev/honors/badge-uuid.png`. The difference
is invisible to clients but requires branching logic on the server.

### 2c. Mismatched prefix/URL pattern (anomaly — INSURANCE_EVIDENCE)

```
R2_PUBLIC_URL_INSURANCE_EVIDENCE = https://pub-xyz.r2.dev/static-assets
R2_KEY_PREFIX_INSURANCE_EVIDENCE = public-files
```

Object key stored in DB: `public-files/doc-uuid.pdf`

`isKeyPrefixInPublicBaseUrl` returns `false` (path tail `static-assets` != `public-files`).
The service falls through to the bare-domain branch and appends `objectKey` unchanged:

URL constructed: `https://pub-xyz.r2.dev/static-assets/public-files/doc-uuid.pdf`

This URL is only valid if the R2 public domain is configured such that `/static-assets`
maps to the bucket root and the actual key `public-files/doc-uuid.pdf` is accessible under
that path. This is an unusual configuration and is flagged as a potential misconfiguration
in section 1b. As of 2026-04-23, INSURANCE_EVIDENCE is `isPublic: false`, so this code
path is not exercised in production.

---

## 3. Runtime Detection Logic

### History

Two bugs were introduced and then fixed during the USER_PROFILES public-flip migration:

- **Bug 1 (commit `fcf04c7`)**: `buildPublicUrl` was stripping the `keyPrefix` from
  `objectKey` before appending — effectively treating all buckets as embedded-prefix.
  For `USER_PROFILES` (bare-domain pattern), this produced URLs without the prefix path
  segment, resulting in 404 responses.
- **Bug 2 (commit `506e2e8`)**: The first fix blindly prepended `keyPrefix` for all
  buckets. This broke embedded-prefix buckets by doubling the path segment:
  `…/honors/honors/badge.png`.

### Current implementation

The final fix in commit `506e2e8` introduced `isKeyPrefixInPublicBaseUrl`, a private
helper in `R2FileStorageService`, to detect the pattern at runtime:

```
src/common/services/r2-file-storage.service.ts
```

The helper inspects the path component of the configured `publicBaseUrl`:

```
isKeyPrefixInPublicBaseUrl("https://pub.r2.dev/honors", "honors")              → true
isKeyPrefixInPublicBaseUrl("https://pub.r2.dev/secure-docs/activities", "activities") → true
isKeyPrefixInPublicBaseUrl("https://pub-xxx.r2.dev", "user-profiles")          → false
isKeyPrefixInPublicBaseUrl("https://pub.r2.dev", "")                           → false
isKeyPrefixInPublicBaseUrl("https://pub.r2.dev/static-assets", "public-files") → false (INSURANCE_EVIDENCE mismatch)
```

`buildPublicUrl` uses this result to decide whether to strip the prefix from `objectKey`
(embedded case) or pass it through unchanged (bare case).

The same pattern-detection logic was independently implemented in
`scripts/migrate-storage-urls-to-r2.ts` via `getConfiguredBasePath` + an inline
`prefixAlreadyInBase` check, since scripts cannot use the NestJS service class.

---

## 4. Recommended Target State

Standardize all `R2_PUBLIC_URL_*` variables to the **bare-domain** form. This eliminates
the ambiguity, removes the detection branch, and makes the URL contract obvious from the
env var alone.

**Target form for every bucket:**

```
R2_PUBLIC_URL_HONORS_IMAGES   = https://pub-def456.r2.dev
R2_KEY_PREFIX_HONORS_IMAGES   = honors
```

Once all buckets are on the bare-domain form, `buildPublicUrl` simplifies to a single
code path: always append `objectKey` directly after the base URL.

### Migration plan

Execute one bucket at a time. Deploying between steps prevents a window where an
in-flight request uses a partially migrated configuration.

1. **Audit current env values** across all environments (development, staging,
   production). For each bucket, record whether `R2_PUBLIC_URL_*` embeds the prefix path
   or not.

2. **Pick the first embedded-prefix bucket** (e.g. `HONORS_IMAGES`). Update its
   `R2_PUBLIC_URL_*` to the bare domain in all environments simultaneously.

3. **Deploy** the updated env. The existing `isKeyPrefixInPublicBaseUrl` logic will now
   return `false` for this bucket and construct URLs correctly using the bare-domain path.
   No code change is required for this step.

4. **Verify** with a smoke test: upload a new object and confirm the returned URL resolves
   with HTTP 200. Run `scripts/migrate-storage-urls-to-r2.ts` in dry-run mode to
   confirm no existing DB URLs are flagged for change.

5. **Repeat** steps 2-4 for each remaining embedded-prefix bucket.

6. **Once all buckets are bare-domain**, remove `isKeyPrefixInPublicBaseUrl` from
   `R2FileStorageService` and simplify `buildPublicUrl` to:

   ```typescript
   private buildPublicUrl(publicBaseUrl: string, objectKey: string): string {
     const normalizedBase = this.normalizeBaseUrl(publicBaseUrl);
     const normalizedKey = this.normalizeKey(objectKey)
       .split('/')
       .map((segment) => encodeURIComponent(segment))
       .join('/');
     return `${normalizedBase}/${normalizedKey}`;
   }
   ```

   Remove the equivalent `prefixAlreadyInBase` branch from
   `scripts/migrate-storage-urls-to-r2.ts`.

7. **Update `.env.example`** to reflect the bare-domain convention with an inline
   comment:

   ```
   # Public CDN base URL — bare domain only (no trailing slash, no path segments).
   # The key prefix (R2_KEY_PREFIX_*) is appended by the service.
   # Example: https://pub-abc123.r2.dev
   R2_PUBLIC_URL_USER_PROFILES=
   R2_PUBLIC_URL_HONORS_IMAGES=
   R2_PUBLIC_URL_HONORS_PDF=
   # ... (all buckets)
   ```

---

## 5. Operational Scripts

All one-shot maintenance scripts in `scripts/` follow a shared bootstrap and safety
convention described below.

### 5a. Bootstrap pattern

Scripts use raw Prisma + `pg.Pool` + `PrismaPg` adapter instead of `NestFactory`. This
avoids booting the full NestJS DI container, which would require mocking every provider,
loading all modules, and waiting for lifecycle hooks. The raw approach starts in under
a second and has zero framework overhead:

```typescript
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ... script logic ...

await prisma.$disconnect();
await pool.end();
```

### 5b. Dry-run default and `--apply` flag

Every script is safe to run without arguments. All mutations are gated behind `--apply`:

```
npx tsx scripts/<name>.ts            # dry-run — reads only, prints what would change
npx tsx scripts/<name>.ts --apply    # writes to DB
```

Scripts print a summary table at exit regardless of mode so the operator can verify
scope before committing to a write.

### 5c. Audit log JSON output

Scripts that perform bulk classification (e.g. orphan detection) write a full audit log
to the project root on every run, including dry-run:

```
orphan-cleanup-<ISO-timestamp>.json
```

The file contains the run mode, environment, totals, and per-row classification. These
files are listed in `.gitignore` and must never be committed. They are the primary input
for recovery scripts.

### 5d. Environment guards

| Guard | Purpose |
|---|---|
| `ALLOW_ORPHAN_CLEANUP_PROD=true` | Required for cleanup-style scripts (`cleanup-orphan-user-images.ts`) to execute against a production `DATABASE_URL`. Without it the script exits immediately. |
| `NODE_ENV=development` | Required for recovery scripts (`restore-orphan-cleanup-dev-seed.ts`). These scripts reconstruct and restore previously nulled rows and must never run in staging or production. |

### 5e. Concurrency

Scripts that perform external I/O per row (e.g. HEAD requests to the CDN) use an inline
`createLimiter` function instead of a third-party library like `p-limit`. This keeps
scripts dependency-free and co-locates the concurrency logic with the caller:

```typescript
function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => { active--; const fn = queue.shift(); if (fn) fn(); };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(v => { resolve(v); next(); }, e => { reject(e); next(); });
      };
      if (active < concurrency) run(); else queue.push(run);
    });
}
```

Typical concurrency values: 10-20 for CDN HEAD requests, 1 (serial) for DB writes when
ordering matters.

### 5f. Current scripts

| Script | Purpose |
|---|---|
| `scripts/migrate-storage-urls-to-r2.ts` | Rewrites legacy Supabase and old R2 storage URLs in the DB to current `R2_PUBLIC_URL_*` + `R2_KEY_PREFIX_*` form. Supports `--only table1,table2` and `--limit N`. |
| `scripts/cleanup-orphan-user-images.ts` | HEAD-checks all `users.user_image` URLs and nulls out rows that return 404. Requires `ALLOW_ORPHAN_CLEANUP_PROD=true` in production. Writes audit log. |
| `scripts/restore-orphan-cleanup-dev-seed.ts` | Recovery for dev seed rows incorrectly nulled by the orphan cleanup (2026-04-23 incident). Reconstructs corrected URLs, HEAD-verifies each, and restores restorable rows. Restricted to `NODE_ENV=development`. |
| `scripts/verify-fcm-migration.ts` | Validates FCM token migration state. Not storage-related but follows the same bootstrap pattern. |

---

## 6. Reference Commits

| Commit | Description |
|---|---|
| `78f9e41` | `feat(r2): flip USER_PROFILES bucket to public` — made USER_PROFILES publicly accessible; exposed the key-prefix URL bug. |
| `fcf04c7` | `fix(r2): include keyPrefix in public URLs for prefixed buckets` — first fix attempt; blindly prepended prefix for all buckets, breaking embedded-prefix buckets with double-prefix paths. |
| `506e2e8` | `fix(r2): handle inconsistent publicBaseUrl env patterns across buckets` — final fix; introduced `isKeyPrefixInPublicBaseUrl` to detect bare vs embedded pattern at runtime. |
| `f0d5984` | `chore(scripts): add orphan user images cleanup one-shot` — added `cleanup-orphan-user-images.ts`. |
| `680578b` | `chore(scripts): add dev seed avatar recovery one-shot` — added `restore-orphan-cleanup-dev-seed.ts` to recover rows incorrectly nulled during the 2026-04-23 cleanup run. |
| `bdc6c59` | `fix(scripts): stop migrate from stripping user-profiles prefix` — fixed `migrate-storage-urls-to-r2.ts` to treat `user-profiles` as an active prefix, not a legacy prefix to be stripped. |
