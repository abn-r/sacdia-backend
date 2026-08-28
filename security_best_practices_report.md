# SACDIA Backend — Security Best Practices Report

**Fecha**: 2026-08-23  
**Repo**: `/Users/abner/Documents/development/sacdia/sacdia-backend`  
**Branch**: `fix/qr-card-identity-section` @ `e7e9d11`  
**Scope**: runtime NestJS (`src/`), bootstrap, auth, RBAC, uploads, CI/deploy  
**Out of scope**: `sacdia-admin`, `sacdia-app`, Render/Neon/R2 dashboards, secrets in `.env`  
**Skills**: `api-security-best-practices`, `security-best-practices` (Express/Node spec; no Nest-specific reference file)  
**Prior report**: `security_best_practices_report.md` (2026-03-30) — findings SEC-001..006 of that revision are re-verified below

## Executive summary

The API has a solid deny-by-default perimeter (`GlobalJwtAuthGuard` + fail-closed `PermissionsGuard`), Redis-backed rate limits in production, Helmet, CORS allowlist, upload size + magic-byte checks, parameterized Prisma SQL, and Swagger forced off in production.

The highest-impact gap is **token audience confusion**: QR member tokens are HS256 JWTs signed with `BETTER_AUTH_SECRET` and `JwtStrategy` does not check `aud`/`iss`. A photographed or intercepted QR payload is a **24-hour full API session** for that member, including owner-bypass health/PII routes and GDPR export. That is worse than stealing an 8h access token, because the QR is designed to be shown to other people.

Second theme: **`GET /clubs` and `GET /clubs/:clubId/sections` skip RBAC and do not apply the territorial crop documented in `docs/api/SECURITY-GUIDE.md`**. Any authenticated user can enumerate the org directory via sequential numeric IDs.

Follow-up from dedicated auth / upload / bootstrap passes (see also threat model TM-013..017): `resolveRoleId` accepts any `role_id` without `CLUB` category check; password-reset **confirm** is not implemented; OAuth has no auth-grade throttle; several uploads still MIME-only (incl. 500 MB presign).

Previous March 2026 highs (open OAuth redirect, unbounded Multer) are **closed** in current code.

---

## Critical

### SEC-001 — QR member JWT accepted as API Bearer token

**Impact**: Anyone who can read a member QR (scanner, screenshot, printed PDF, shoulder-surf) can impersonate that member on the full API for 24 hours.

- **Rule IDs**: EXPRESS-AUTH (token confusion), OWASP API2 Broken Authentication, JWT RFC 8725 (validate `aud`)
- **Location**:
  - `src/qr/qr.service.ts:146-164` (`generateMemberToken`)
  - `src/qr/qr.module.ts:15-31` (same `BETTER_AUTH_SECRET`, `expiresIn: '24h'`)
  - `src/auth/strategies/jwt.strategy.ts:37-43` (verify HS256 only; no `audience`/`issuer`)
  - `src/auth/strategies/jwt.strategy.ts:78-85` (`validate` copies `sub` and ignores `aud`)
  - `src/better-auth/better-auth.service.ts:960-975` (API JWT payload `{ sub, email, sid?, mfa_pending? }`)
- **Evidence**: QR signs `{ sub, aud: 'sacdia:qr-member', ver: 1 }`. Scan path correctly rejects wrong `aud` (`qr.service.ts:403-405`). Passport JWT used for every protected route does **not**. Same signing key as API tokens.
- **Who can exploit**: any party that obtains the QR string (club staff scanning attendance, another member, a photo of the virtual card / PDF).
- **Fix**:
  1. In `JwtStrategy`, reject tokens with `aud === 'sacdia:qr-member'` (or require an explicit API audience, e.g. `sacdia-api`).
  2. Prefer a **separate QR signing secret** so a QR token can never verify as an API token.
  3. Add a regression test: QR token against a protected route → 401.
  4. Shorten QR TTL and bind scans to `jti` if replay of the visual token must stay limited to attendance.
- **Mitigation if full fix slips**: treat QR display as equivalent to handing over the account; do not print QR PDFs; rotate `BETTER_AUTH_SECRET` after a suspected leak (revokes API + QR together today).
- **False positive notes**: none for “same key + no aud check”. Residual: attacker still needs the QR string (not a remote unauth RCE).

---

## High

### SEC-002 — Authenticated org-directory listing without territorial crop

**Impact**: Any valid JWT can list all clubs and, by walking sequential `clubId`, all section types — including territories the actor must not see. Conflicts with the documented role-first crop.

- **Rule IDs**: OWASP API1 BOLA / API5 BFLA, EXPRESS-INPUT-001
- **Location**:
  - `src/clubs/clubs.controller.ts:61-108` (`GET /clubs`, `@SkipPermissions`, no actor passed)
  - `src/clubs/clubs.service.ts:80-126` (`findAll` filters only query params)
  - `src/clubs/clubs.controller.ts:171-191` (`GET /clubs/:clubId/sections`, `@SkipPermissions`)
  - Contrast: `docs/api/SECURITY-GUIDE.md` (GET `/clubs` must crop for `director-lf` / union / DIA; out-of-scope filters → `403 GUARD_PERMISSION_DENIED`)
- **Evidence**: `findAll` never reads JWT `sub` or `AuthorizationContextService`. Response includes church, district, local-field names and section type ids.
- **Fix**:
  - Keep a **narrow public picker** (id + name + type) if post-registration needs it.
  - Apply the documented territorial crop for actors with LF/union/DIA roles.
  - Require `clubs:read` + club scope for `GET /:clubId/sections`, or return only the caller’s eligible sections.
- **Mitigation**: pagination `limit` max 100 already exists; does not stop enumeration.
- **False positive notes**: if product now wants a worldwide picker for every authenticated user, this is accepted risk — then **update SECURITY-GUIDE** so the crop claim is not a false control.

### SEC-003 — API JWTs have no `iss` / `aud` (enables SEC-001 and future token reuse)

**Impact**: any HS256 blob signed with `BETTER_AUTH_SECRET` is treated as an access token.

- **Location**: `src/better-auth/better-auth.service.ts:960-975`, `src/auth/auth.module.ts:24-32`, `src/auth/strategies/jwt.strategy.ts:37-43`
- **Evidence**: payload is `{ sub, email, sid?, mfa_pending? }`. QR already uses `aud`. MFA pre-auth tokens on other branches would collide the same way.
- **Fix**: set `iss` + `aud` on `signJwt`; verify both in `JwtStrategy`. Keep QR on a different `aud` **and** key.
- **Tied to**: SEC-001

---

### SEC-013 — `assignRole` accepts any `role_id` (no `CLUB` category check)

**Impact**: An actor with `club_roles:assign` can attach a GLOBAL role UUID (`admin`, `super-admin`, …) to `club_role_assignments`. `buildClubGrant` copies that role’s permissions into the active club grant. `PermissionsGuard` then applies them on **club-scoped** resources (not `global`/`user`).

- **Location**:
  - `src/clubs/clubs.service.ts:1640-1644` (`if (dto.role_id) return dto.role_id`)
  - Contrast by-name path: `:1656-1660` requires `role_category: 'CLUB'`
  - `src/common/services/authorization-context.service.ts:676-681`
  - FK `club_role_assignments.role_id` → `roles` with no category constraint (`prisma/schema.prisma:812`)
- **Fix**: Resolve `role_id` with `role_category: 'CLUB' AND active`; reject otherwise. Optionally add a DB check.
- **False positive notes**: Does **not** add a row to `users_roles`, so `@GlobalRoles('admin')` still fails. Escalation is permission-bit elevation on club-scoped endpoints.

### SEC-014 — Password reset confirm endpoint missing

**Impact**: `resetPasswordForEmail` persists a 1h token and emails `sacdia://reset-password?token=…`. No `POST /auth/password/reset` (or equivalent) consumes it. Reset is incomplete; tokens sit in `verification` unused by this API.

- **Location**: `src/auth/auth.controller.ts` (only `password/reset-request`); comment at `better-auth.service.ts:537`
- **Canon**: `docs/api/ENDPOINTS-LIVE-REFERENCE.md` also lists only reset-request
- **Fix**: Add a public, throttled confirm endpoint (token + new password); hash/compare token; invalidate after use; rotate sessions.
- **False positive notes**: Functional gap first. Security risk if a future hidden BA HTTP handler consumes the same table without the same controls.

---

## Medium

### SEC-004 — `PermissionsGuard` fail-open on unknown resource types

- **Rule ID**: OWASP API5
- **Location**: `src/common/guards/permissions.guard.ts:176-295` (`default: return true`)
- **Evidence**: after permission bits match, an unhandled `resource.type` skips club/territory checks.
- **Impact**: a new `@AuthorizationResource({ type: '...' })` that is not added to the switch authorizes on permission name alone (cross-tenant if the permission is held globally or via active assignment).
- **Fix**: `default` → throw `GUARD_RBAC_MISCONFIGURATION` (same as missing metadata).
- **False positive notes**: only triggers when someone ships a new resource type without updating the guard.

### SEC-005 — `trust proxy = 1` assumed; rate-limit key can be wrong or spoofed

- **Rule ID**: EXPRESS-PROXY-001, EXPRESS-AUTH-001
- **Location**: `src/main.ts:142`, `src/config/user-aware-throttler.guard.ts:124-135`
- **Evidence**: comment assumes one hop (Vercel/nginx). Deploy is **Render** (`render.yaml`). Unauthenticated routes key by `req.ip`. Extra hops or missing overwrite of `X-Forwarded-For` → shared bucket or client-spoofed IP.
- **Fix**: confirm Render hop count; set `trust proxy` to that hop count or the Render CIDR. Do not use `true`.
- **False positive notes**: authenticated routes key by `user:{id}` after JWT parse — login/register still IP-keyed.

### SEC-006 — QR card and `/qr/me` expose PHI + full authorization grants

- **Location**: `src/qr/qr.service.ts:166-176`, `577-636`, `1026-1066`; `src/qr/qr.controller.ts:74-91`
- **Evidence**: card extras load `blood` and primary emergency contact; `/qr/me` returns `resolved.authorization` (grants + scope). Combined with SEC-001 this is full account + medical dump.
- **Fix**: after SEC-001, still minimize card fields; do not return the full authz graph on a QR read; keep blood/emergency on a staff-only validate response if required for first aid.
- **False positive notes**: product may require blood type on the printed card — document as accepted residual.

### SEC-015 — OAuth initiate/callback lack auth-grade `@Throttle`

- **Location**: `src/auth/oauth.controller.ts:57-110` — no `@Throttle`; login/register use 5/min
- **Impact**: Token stuffing / BA session exchange limited only by global 3/s + 100/min
- **Fix**: Same 5/min named throttle as login on `google`, `apple`, `callback`

### SEC-016 — Presigned resource PUT 500 MB without content verification

- **Location**: `src/resources/dto/generate-upload-url.dto.ts:19`; `resources.service.ts:256+` (`createFromUploaded` HEAD size + declared MIME only)
- **Impact**: Actor with `resources:create` can store arbitrary bytes under a safe MIME
- **Fix**: After PUT, sample magic bytes (or require server-side copy/verify) before persisting the row

### SEC-017 — MIME-only uploads (camporee voucher, achievement badge)

- **Location**: `src/camporees/camporees.controller.ts` upload + `camporees.service.ts` MIME/size; `src/achievements/admin/admin-achievements.service.ts` badge (public CDN bucket)
- **Fix**: Reuse `FileValidationPipe` / proof-file magic bytes. Badges especially — public `Content-Type`

### SEC-018 — Certificate bulk-import `file_url` is an unconstrained string (latent SSRF)

- **Location**: `src/certificate-bulk-imports/dto/create-certificate-bulk-import.dto.ts:19-27`; service passes `fileUrl` to `CertificateOcrProvider`
- **Evidence**: Current noop OCR does not fetch. A future provider that `fetch(fileUrl)` without host allowlist is SSRF
- **Fix**: `@IsUrl` + R2/CDN host allowlist **before** any OCR fetch; prefer server keys over client URLs

### SEC-007 — Validation error filter always uses `detailedErrors: true`

- **Rule ID**: EXPRESS-ERROR-001
- **Location**: `src/main.ts:278-280`
- **Evidence**: `I18nValidationExceptionFilter({ detailedErrors: true })` is not gated on `NODE_ENV`.
- **Impact**: production 400s may echo constraint/shape details useful for probing DTOs. Domain 5xx are already masked.
- **Fix**: `detailedErrors: process.env.NODE_ENV !== 'production'`.

---

## Low

### SEC-008 — Password policy is 8 characters

- **Location**: `src/auth/dto/register.dto.ts:39-48`
- **Evidence**: min 8 + upper/lower/digit/special. Skill baseline is 12 + strength library.
- **Fix**: raise minimum if product allows; keep complexity.

### SEC-009 — Global JSON body limit 10 MB

- **Rule ID**: EXPRESS-BODY-001
- **Status**: **Fixed** — default JSON/urlencoded **512kb** (`src/config/request-body-limits.ts`); `/api/v1/admin/catalogs/*` may use **10mb**; multipart stays on Multer (10 MB).

### SEC-010 — Sequential numeric public IDs

- **Guidance**: avoid incrementing IDs for internet-exposed resources
- **Evidence**: `club_id`, `activity_id`, `finance_id`, etc. Most mutations are scoped by `PermissionsGuard`. SEC-002 is the place this bites.
- **Fix**: not a wholesale UUID migration; close listing/section leaks first.

### SEC-011 — Better Auth `trustedOrigins` not set

- **Location**: `src/better-auth/better-auth.config.ts:46-85`
- **Evidence**: OAuth `callbackURL` is passed through after `OAuthService.validateRedirectUrl` (`oauth.service.ts:76-87`, allowlist from `ALLOWED_OAUTH_REDIRECT_URLS`).
- **Fix**: set BA `trustedOrigins` to the same allowlist (defense in depth). Keep exact-URL allowlist (not origin-only).

### SEC-019 — Register enumerates existing emails

- **Location**: `better-auth.service.ts` → `AUTH_EMAIL_ALREADY_IN_USE` on duplicate
- **Fix**: Same generic message as login, or constant-time dummy work; product/UX tradeoff

### SEC-020 — Refresh does not blacklist the previous access JWT

- **Location**: Comment in `better-auth.service.ts` (~430); 8h residual window
- **Fix**: Blacklist presented access token on refresh if the client sends it; keep 8h as residual for stolen tokens not presented

### SEC-021 — Audit IP prefers raw `X-Forwarded-For`

- **Location**: `src/audit-logs/http-audit.interceptor.ts:221-227`
- **Impact**: Spoofable IPs in audit (throttler correctly uses `req.ip`)
- **Fix**: Use `request.ip` after `trust proxy`

### SEC-012 — `pnpm audit` not a CI gate

- **Status**: **Fixed** — job `dependency_audit` runs `pnpm run audit:security:test` + `audit:security` (allowlist in `scripts/audit-security.allowlist.json`).

---

## Closed since 2026-03-30

| Old ID | Status | Evidence |
| --- | --- | --- |
| SEC-001 OAuth open redirect | **Mitigated** | `oauth.service.ts:52-87` exact allowlist; `.env.example` `ALLOWED_OAUTH_REDIRECT_URLS` |
| SEC-002 Multer unbounded | **Fixed** | All `FileInterceptor` calls pass `DEFAULT_UPLOAD_OPTIONS` or an explicit `fileSize` |
| SEC-003 Resources MIME-only | **Fixed** | `resource-file-validation.pipe.ts` magic bytes |
| SEC-004 Dev body logs | **Fixed** | `http-exception.filter.ts:195-223` key-based redaction; prod omits `requestBody` |
| SEC-005 Email token logged | **Fixed** | `auth.service.ts:741-747` — raw token never logged |
| SEC-006 Dependency audit snapshot | **Stale** | Re-run `pnpm audit --audit-level=high` when ready to upgrade |
| SEC-009 JSON 10 MB global | **Fixed** | `request-body-limits.ts` + tiered parser in `main.ts` |
| SEC-012 audit CI gate | **Fixed** | `.github/workflows/ci.yml` → `dependency_audit` |

---

## Controls that meet the baseline (not findings)

| Control | Evidence |
| --- | --- |
| Deny-by-default JWT | `app.module.ts:275-277`, `global-jwt-auth.guard.ts` |
| Fail-closed permissions | `permissions.guard.ts:116-119`; e2e passthrough only if `NODE_ENV !== 'production'` |
| Helmet + CSP (prod) | `main.ts:149-177` |
| CORS allowlist; prod requires `ALLOWED_ORIGINS` | `main.ts:211-254`, `env.validation.ts:84-95` |
| Swagger forbidden in production | `env.validation.ts:99-106`, `render.yaml:24-25` |
| Throttler Redis fail-fast in prod | `throttler.config.ts:66-97`; auth routes `@Throttle` 5/min |
| Cache Redis fail-fast in prod | `cache.config.ts:54-90` |
| JWT blacklist + user-wide revoke | `jwt.strategy.ts:48-76` |
| MFA `aal1` blocked on protected routes | `jwt-auth.guard.ts:49-51` |
| Bootstrap admin timing-safe secret | `rbac.controller.ts:396-404`, min 32 chars |
| Password reset enumeration-safe | `better-auth.service.ts:500-520` |
| Login generic `AUTH_INVALID_CREDENTIALS` | `auth.service.ts:205` |
| DTO whitelist + `forbidNonWhitelisted` | `main.ts:264-267` |
| XSS strip on body/query/param | `sanitize.pipe.ts` |
| Prisma `$queryRaw` uses `Prisma.sql` parameters | analytics, camporees, catalogs |
| No runtime `child_process` / `res.redirect` | searched `src/` |
| Health ping is liveness-only | `health.controller.ts:26-42`; details = admin |
| Owner geography fields rejected | `users.service.ts:123-132` |
| Helmet default hides `X-Powered-By` | helmet 8.x |

**CSRF**: API consumers use `Authorization: Bearer`. Classic browser CSRF does not apply unless a client starts sending the access token as a cookie. Admin cookie session described in SECURITY-GUIDE is **not on this branch**.

**TLS**: terminated at Render; not flagged (out of app process).

---

## OWASP API Top 10 (this repo)

| # | Status | Notes |
| --- | --- | --- |
| 1 BOLA | Partial | Strong resource guards; clubs list/sections skip them |
| 2 Auth | Gap | SEC-001/003 |
| 3 Property-level | OK-ish | whitelist DTOs; `findOne` still returns `blood`, `access_panel` to owners / `users:read_detail` |
| 4 Resource consumption | Partial | Redis throttle + 30s timeout; JSON default 512kb (Multer 10 MB) |
| 5 Function-level | Strong | fail-closed permissions; SEC-004 residual |
| 6 Sensitive flows | Partial | payment orders maker-checker; QR is a sensitive flow without audience isolation |
| 7 SSRF | Low | `fetch` on server-minted R2 URLs (`qr.service.ts`, monthly reports) |
| 8 Misconfig | Good | Swagger off, Redis required, Helmet |
| 9 Inventory | Good | `/api/v1` + live endpoint docs; Swagger opt-in |
| 10 Unsafe 3rd-party | Watch | Firebase, R2, Resend, Better Auth, Google/Apple OAuth |

---

## Recommended remediation order

1. **SEC-001 + SEC-003** — reject QR `aud` in `JwtStrategy`; add test; then split keys.
2. **SEC-002** — restore territorial crop or update the security guide and lock down `GET .../sections`.
3. **SEC-013** — force `role_category: 'CLUB'` on `role_id`.
4. **SEC-014** — implement reset confirm or stop issuing unused tokens.
5. **SEC-004 / SEC-015–018** — fail-closed resource types, OAuth throttle, upload magic bytes, OCR URL allowlist.
6. **SEC-010 / SEC-011** — sequential IDs (accepted risk), BA `trustedOrigins` defense-in-depth.

SEC-009 and SEC-012 are closed on `fix/security-hardening-lote`.
