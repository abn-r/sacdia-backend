# E2E Test Debt — Backend

## Status

The e2e test harness was silently broken between commit `f0ba7a6` (MFA/otplib wave) and commit
`5cb7ac6` (harness restore). During that window CI ran with `continue-on-error: true` on the
unit-test job, so every e2e failure appeared as a warning and went unnoticed. Effective e2e
coverage was **zero** for that entire period.

Once the harness was restored (companion commit `b4e05b8` added HTTP-layer guard coverage for
confirm-union), 32 tests across 10 spec files are found to be failing. All 32 failures are
pre-existing — none were introduced by the harness fix itself.

**Strategy (Option B):** no batch fix sprint. Fix a spec file in the same PR that touches its
production module. When a spec is fixed, remove its entry from this document in the same PR.

---

## How to use this document

If you are about to modify any module listed in the Debt Index below, **fix its spec(s) as part
of your PR**. Do NOT open standalone "fix all tests" PRs — that is explicitly not the strategy.
When a spec entry is fully fixed, delete that subsection from this file in the same PR and check
the box in the Tracking section.

---

## Debt Index

### 1. `test/users.e2e-spec.ts` — 6 failing tests

**Link:** [`test/users.e2e-spec.ts`](../test/users.e2e-spec.ts)  
**Failing tests:**

- `Users E2E Tests > /api/v1/users/:userId (GET) > should return user info`
- `Users E2E Tests > /api/v1/users/:userId/allergies (GET) > should return active allergies as a flat success envelope`
- `Users E2E Tests > /api/v1/users/:userId/allergies (GET) > should return an empty list for an existing user without active allergies`
- `Users E2E Tests > /api/v1/users/:userId/allergies (GET) > should return 404 when the user does not exist`
- `Users E2E Tests > /api/v1/users/:userId/diseases (GET) > should return active diseases as a flat success envelope`
- `Users E2E Tests > /api/v1/users/:userId/medicines (GET) > should return active medicines as a flat success envelope`

**Root cause:** Pattern #1. The JWT sub is hardcoded as `'test-user-id'` (line 68 of the spec):

```typescript
// test/users.e2e-spec.ts:65-71 — BROKEN
const authHeaders = () => ({
  Authorization: `Bearer ${createBearerToken(
    jwtService,
    'test-user-id',   // ← non-UUID string
    'test@example.com',
  )}`,
});
```

`PermissionsGuard` is mocked, but the `JwtAuthGuard` still populates `request.user.sub` with
`'test-user-id'`. For endpoints decorated with `@RequirePermissions`, `PermissionsGuard.canActivate`
would skip Prisma (it's mocked). However, `AuthorizationContextService.resolveUserAuthorization`
can be triggered from other paths (e.g., `AuthorizationContextService` is injected into services
that run before the guard returns). When it reaches Neon with a non-UUID `user_id`, Postgres
rejects it: `invalid input syntax for type uuid` → Prisma `P2007` → 400 or 500.

Additionally, the `isResourceOwner` check in `PermissionsGuard` (line 98-102 of
`permissions.guard.ts`) short-circuits early when `request.params[ownerParam] === userId` — but
`'test-user-id'` in the JWT sub must match `'test-user-id'` in the URL param, which it does for
the `GET /users/test-user-id` case. But the prisma spies mock `findUnique` — so the issue
is that even a mocked guard may still allow request.user.sub to propagate into service code that
calls `AuthorizationContextService` without mocking it.

**Suggested fix:** Replace the hardcoded sub with a real UUID. Generate a deterministic UUID at
the top of the spec (e.g., `const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001'`) and
use it as both the JWT sub and the URL param. See Pattern #1 fix pattern below.

**Estimated effort:** trivial  
**Trigger:** any change to `src/users/users.controller.ts` or `src/users/users.service.ts`

---

### 2. `test/admin-users.e2e-spec.ts` — 6 failing tests

**Link:** [`test/admin-users.e2e-spec.ts`](../test/admin-users.e2e-spec.ts)  
**Failing tests:**

- `Admin Users Detail E2E > should return only the permitted fine-grained block when using family permissions`
- `Admin Users Detail E2E > should keep transitional legacy compatibility for users:read_detail`
- `Admin Users Detail E2E > should prune sensitive blocks when the actor lacks fine and legacy detail permissions`
- `Admin Users Detail E2E > should expose transitional formative fields from the correct sources`
- `Admin Users Detail E2E > should return null operational enrollment when no active ecclesiastical year is resolved`
- `Admin Users Detail E2E > should return null operational enrollment on conflicting annual enrollment candidates`

**Root cause:** Pattern #1. The actor JWT is minted with sub `'admin-1'` (line 270 of the spec, via
`makeToken('admin-1', 'admin@test.com')`), and the actor fixture record in `actorRecord` also uses
`user_id: 'admin-1'` (line 135-140). The `mockScopedDetailLookup()` helper spies on
`prisma.users.findUnique` to return `actorRecord`, but `AuthorizationContextService.resolveUserAuthorization`
is **spied directly** on the prototype (line 274 in each test). The issue is that the spy on
`resolveUserAuthorization` uses `.mockResolvedValue(buildResolvedAuthorization([...]))` — this
should intercept the call cleanly.

However, the first `prisma.users.findUnique` call inside `mockScopedDetailLookup()` returns
`actorRecord` which has `user_id: 'admin-1'` (a non-UUID). Any secondary Prisma call that Neon
receives with `'admin-1'` as a UUID field will fail. The guard is mocked but the service code
path may call `prisma.users.findFirst` for the target user (which is also spied), while Neon
may still receive the actor lookup before the spies activate.

**Suggested fix:** Replace all sub values and user_id fixture fields with real UUIDs. Define them
once at the top of the spec:

```typescript
const ADMIN_UUID = '00000000-0000-0000-0000-000000000001';
const TARGET_UUID = '00000000-0000-0000-0000-000000000002';
```

Then update `makeToken`, `actorRecord.user_id`, and `userDetailRecord.user_id` consistently.

**Estimated effort:** small  
**Trigger:** any change to `src/admin/admin-users.service.ts` or `src/admin/admin-users.controller.ts`

---

### 3. `test/insurance.e2e-spec.ts` — 4 failing tests

**Link:** [`test/insurance.e2e-spec.ts`](../test/insurance.e2e-spec.ts)  
**Failing tests:**

- `Insurance E2E > GET /clubs/:clubId/sections/:sectionId/members/insurance returns the mapped list`
- `Insurance E2E > GET /users/:memberId/insurance returns the member insurance detail`
- `Insurance E2E > POST /users/:memberId/insurance accepts multipart uploads and forwards the current user`
- `Insurance E2E > PATCH /insurance/:insuranceId accepts multipart form data without requiring a file`

**Root cause:** Pattern #1. The `TEST_USER` object at line 14-17 sets `sub: 'insured-user-1'`.
The `MockJwtAuthGuard` injects this directly into `request.user`, bypassing JWT validation.
However `InsuranceService` is fully mocked — all 4 service methods are intercepted. The sub
`'insured-user-1'` propagates into service calls as the `user` argument. On the PATCH and POST
tests, `expect(user).toBe(TEST_USER.sub)` asserts the string is passed through. This part works.

The failure vector is that any guard or middleware that is NOT overridden may receive the
non-UUID sub and attempt a Prisma lookup. Specifically, the spec does NOT mock `PermissionsGuard`
or `AuthorizationContextService`. If any endpoint in the insurance routes has `@RequirePermissions`
on it, `PermissionsGuard` runs with `userId = 'insured-user-1'` and calls
`this.authorizationContext.resolveUserAuthorization('insured-user-1')` → Prisma `P2007` → 500.

**Suggested fix:** Either mock `PermissionsGuard` (preferred) or switch `TEST_USER.sub` to a valid
UUID and mock `prisma.users` / `AuthorizationContextService` as needed. Since `InsuranceService`
is already fully mocked, adding a `PermissionsGuard` mock is the minimal change.

**Estimated effort:** trivial  
**Trigger:** any change to `src/insurance/insurance.service.ts` or `src/insurance/insurance.controller.ts`

---

### 4. `test/admin-catalogs.e2e-spec.ts` — 3 failing tests

**Link:** [`test/admin-catalogs.e2e-spec.ts`](../test/admin-catalogs.e2e-spec.ts)  
**Failing tests:**

- `Admin Catalogs E2E > should return 401 when no token is provided`
- `Admin Catalogs E2E > should allow admin to create country`
- `Admin Catalogs E2E > should allow admin to list relationship types`

**Root cause:** Pattern #1 / Mock wiring. The spec has 4 tests total. The `should return 403 for
non-admin user` test uses `mockPermissionsGuard.canActivate.mockReturnValueOnce(false)` which
works, but the 3 failing tests all have `PermissionsGuard` returning `true`. The sub values
`'user-1'` and `'admin-1'` (lines 109, 121) are non-UUIDs. Although `PermissionsGuard` is mocked
at module level, the `JwtAuthGuard` may still run and the resulting `request.user.sub` may be
passed to `AuthorizationContextService` from controller-level interceptors or pipes.

The deeper issue: `AdminGeographyService` and `AdminReferenceService` are fully mocked, but the
spec does NOT mock `AuthorizationContextService`. If any guard or interceptor calls
`resolveUserAuthorization` with the non-UUID sub before reaching the mocked service, it will
throw. The 401 test fails because the endpoint unexpectedly returns something other than 401
(guard misconfiguration under the test harness).

**Suggested fix:** Add explicit UUID test IDs and mock `AuthorizationContextService.prototype.resolveUserAuthorization`
on the prototype as this spec's sibling `admin-users.e2e-spec.ts` already does (line 274 pattern).

**Estimated effort:** small  
**Trigger:** any change to `src/admin/admin-geography.service.ts`, `src/admin/admin-reference.service.ts`,
or their controllers

---

### 5. `test/admin-users-scope.e2e-spec.ts` — 2 failing tests

**Link:** [`test/admin-users-scope.e2e-spec.ts`](../test/admin-users-scope.e2e-spec.ts)  
**Failing tests:**

- `Admin Users Scope E2E > should allow super_admin with ALL scope`
- `Admin Users Scope E2E > should enforce UNION scope for admin even when filters are provided`

**Root cause:** Pattern #1 (mixed). The `PermissionsGuard` is mocked, but the subs `'super-1'`
and `'admin-1'` (lines 71, 100) are non-UUIDs. The scope-resolution service
(`AdminUsersService` or similar) calls `prisma.users.findUnique` with the JWT sub to look up
the actor's `union_id` and `local_field_id`. This call is spied with `jest.spyOn(prisma.users, 'findUnique')`,
but Neon still receives the non-UUID before the spy intercepts — depending on call order.

The 2 passing tests (`should enforce LOCAL_FIELD scope for coordinator`, `should return 403 for
coordinator without local_field_id configured`, `should return 404 when requested user is outside
actor scope`) may coincidentally succeed due to test ordering or a different code path that hits
the spy before Neon.

**Suggested fix:** Replace `'super-1'`, `'admin-1'`, `'coord-1'`, `'coord-bad'`, `'admin-2'`
with deterministic UUIDs throughout the spec. The spies on `prisma.users.findUnique` already
return the expected fixture objects — just swap the string values consistently.

**Estimated effort:** small  
**Trigger:** any change to `src/admin/admin-users.service.ts` scope resolution logic

---

### 6. `test/classes.e2e-spec.ts` — 2 failing tests

**Link:** [`test/classes.e2e-spec.ts`](../test/classes.e2e-spec.ts)  
**Failing tests:**

- `Classes E2E Tests > /api/v1/users/:userId/classes/enroll (POST) > should enroll user in a class`
- `Classes E2E Tests > /api/v1/users/:userId/classes/:classId/progress > returns enrollment-owned progress for a single active enrollment`

**Root cause:** Pattern #1. The `authHeaders(userId)` helper (line 72-78) passes whatever `userId`
string is given. Notably, the enroll test (line 98) uses a proper UUID
`'550e8400-e29b-41d4-a716-446655440000'`, so that test's failure is NOT the sub pattern — it is
likely a service logic or mock wiring issue. The progress test also uses the same UUID at line 123.

Re-examining: `PermissionsGuard` is mocked. Both failing tests use a valid UUID. The failures
here may be due to the `$transaction` mock not being wired correctly, or a secondary service call
that escapes the mock boundary and hits Neon. The `GET /api/v1/classes` test (no auth required)
passes, confirming the harness works.

**Note:** The summary table classifies these as "non-UUID user ID → 500" but the actual spec
uses a valid UUID for the failing test cases. The true failure cause requires running the suite
to observe the actual error message — it is likely a Prisma transaction mock issue in the
`returns enrollment-owned progress` test or a validation error in the enroll test.

**Suggested fix:** Run the test in isolation to capture the real error. Check that
`prisma.$transaction` mock is wired to match the service's actual transaction callback signature.

**Estimated effort:** small  
**Trigger:** any change to `src/classes/classes.service.ts` or `src/classes/classes.controller.ts`

---

### 7. `test/evidence-folder.e2e-spec.ts` — 2 failing tests

**Link:** [`test/evidence-folder.e2e-spec.ts`](../test/evidence-folder.e2e-spec.ts)  
**Failing tests:**

- `Evidence Folder E2E > GET /club-sections/:sectionId/evidence-folder returns the mapped folder structure`
- `Evidence Folder E2E > POST /club-sections/:sectionId/evidence-folder/sections/:efSectionId/submit submits a section`

**Root cause:** Pattern #1. `TEST_USER_ID = 'user-evidence-1'` (line 15). The `MockJwtAuthGuard`
injects this directly into `request.user.sub`. `EvidenceFolderService` is fully mocked, but the
spec does NOT mock `PermissionsGuard`. Any endpoint decorated with `@RequirePermissions` will
trigger `PermissionsGuard.canActivate`, which calls
`this.authorizationContext.resolveUserAuthorization('user-evidence-1')` → Prisma hit on Neon with
a non-UUID → `P2007` → 500.

The two passing tests (`POST .../files` upload and `DELETE .../files/:fileId`) may coincidentally
survive if those endpoints lack `@RequirePermissions` or use a different guard path.

**Suggested fix:** Add `overrideGuard(PermissionsGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })`
to the module fixture, and/or replace `TEST_USER_ID` with a valid UUID and mock
`AuthorizationContextService.prototype.resolveUserAuthorization`.

**Estimated effort:** trivial  
**Trigger:** any change to `src/folders/evidence-folder.service.ts` or `src/folders/evidence-folder.controller.ts`

---

### 8. `test/post-registration.e2e-spec.ts` — 2 failing tests

**Link:** [`test/post-registration.e2e-spec.ts`](../test/post-registration.e2e-spec.ts)  
**Failing tests:**

- `Post-registration step 3 E2E > converges to one active annual enrollment and completes step 3`
- `Post-registration step 3 E2E > fails without active year and does not commit enrollment writes`

**Root cause:** Pattern #1. The JWT sub is `'owner-user-1'` (line 41-45, via `createBearerToken`):

```typescript
// test/post-registration.e2e-spec.ts:41-45 — BROKEN
const authHeaders = () => ({
  Authorization: `Bearer ${createBearerToken(
    jwtService,
    'owner-user-1',   // ← non-UUID string
    'owner@example.com',
  )}`,
});
```

The `PermissionsGuard` is mocked. The `$transaction` mock is wired directly on `prisma` (line 124).
However, the URL param is `/api/v1/users/owner-user-1/post-registration/step-3/complete` — so
`isResourceOwner` in `PermissionsGuard` would match (sub equals param), but since the guard
is fully mocked this is moot. The non-UUID propagates when any non-mocked code path (e.g.,
`AuthorizationContextService`, or `OwnerOrAdminGuard`) receives the sub and queries Neon.

**Suggested fix:** Replace `'owner-user-1'` with a valid UUID such as
`'550e8400-e29b-41d4-a716-446655440002'`. Update the URL path and the `$transaction` mock assertions
that reference `'owner-user-1'` (e.g., lines 139, 145, 151).

**Estimated effort:** trivial  
**Trigger:** any change to `src/users/post-registration/post-registration.service.ts`

---

### 9. `test/investiture.e2e-spec.ts` — 2 failing tests

**Link:** [`test/investiture.e2e-spec.ts`](../test/investiture.e2e-spec.ts)  
**Failing tests:**

- `Investiture E2E > GET /api/v1/investiture/pending > returns paginated list without filters`
- `Investiture E2E > GET /api/v1/investiture/pending > forwards query params local_field_id and ecclesiastical_year_id`

**Root cause:** Pattern #2 — **real service signature drift**. The tests assert that
`mockInvestitureService.getPending` was called with 5 positional arguments:

```typescript
// test/investiture.e2e-spec.ts:447-453 — STALE expectation
expect(mockInvestitureService.getPending).toHaveBeenCalledWith(
  TEST_USER.sub,
  undefined,  // localFieldId
  undefined,  // ecclesiasticalYearId
  undefined,  // page
  undefined,  // limit
);           // ← only 5 args
```

But the production service signature (added `status` param) and the controller call at
`src/investiture/investiture.controller.ts:440-447` now pass **6 arguments**:

```typescript
// src/investiture/investiture.controller.ts:440-447 — CURRENT
const data = await this.investitureService.getPending(
  actorId,
  localFieldId,
  ecclesiasticalYearId,
  page,
  limit,
  status,        // ← 6th arg — added after the test was written
);
```

The `toHaveBeenCalledWith(sub, undefined, undefined, undefined, undefined)` assertion fails
because Jest receives 6 args including the trailing `status: undefined`. The `forwards query params`
test has the same issue at line 472-479.

**Suggested fix:** Update the `toHaveBeenCalledWith` assertions to include the 6th argument:

```typescript
expect(mockInvestitureService.getPending).toHaveBeenCalledWith(
  TEST_USER.sub,
  undefined, undefined, undefined, undefined, undefined,
);
```

For the `forwards query params` test, include the actual `status` value passed (likely `undefined`
since no `status` query param is sent).

**Estimated effort:** trivial  
**Trigger:** any change to `src/investiture/investiture.service.ts` or `src/investiture/investiture.controller.ts`

---

### 10. `test/catalogs.e2e-spec.ts` — 1 failing test

**Link:** [`test/catalogs.e2e-spec.ts`](../test/catalogs.e2e-spec.ts)  
**Failing tests:**

- `Catalogs E2E Tests > /api/v1/catalogs/ecclesiastical-years/current (GET) > should return current ecclesiastical year`

**Root cause:** Pattern #2 — **field name drift**. The test at line 120-122 asserts:

```typescript
// test/catalogs.e2e-spec.ts:120-122 — STALE assertion
expect(response.body).toHaveProperty('year_id');
expect(response.body).toHaveProperty('active', true);
```

The mock returns `{ year_id: 1, ... }`, but the controller/serializer for the
`ecclesiastical-years/current` endpoint has been updated to return (or wrap) the response using
`ecclesiastical_year_id` as the field name instead of `year_id`. The mock at line 102-109 still
uses `year_id: 1`, but if the service maps the record through a DTO or transformer that renames
the field, the assertion fails with the field missing.

**Suggested fix:** Check the current response shape by inspecting
`src/catalogs/catalogs.controller.ts` and any response DTOs for the `ecclesiastical-years/current`
endpoint. Update the assertion to match the actual field name. If the field is
`ecclesiastical_year_id`, update both the mock fixture and the assertion.

**Estimated effort:** trivial  
**Trigger:** any change to `src/catalogs/catalogs.service.ts` or `src/catalogs/catalogs.controller.ts`

---

## Fix Patterns

### Pattern #1: Non-UUID JWT sub

**Root cause:** Test JWTs embed hardcoded non-UUID strings as the `sub` claim (e.g.,
`'test-user-id'`, `'admin-1'`, `'insured-user-1'`, `'user-evidence-1'`, `'owner-user-1'`). At
runtime, `PermissionsGuard` reads `request.user.sub` and passes it to
`AuthorizationContextService.resolveUserAuthorization`, which executes
`prisma.users.findUnique({ where: { user_id: userId } })` against the Neon dev database. PostgreSQL
rejects non-UUID strings in a UUID column with `invalid input syntax for type uuid`. Prisma surfaces
this as a `P2007` error, which propagates as a 500 or 400 response. These tests only appeared to
pass before because the e2e harness was broken and no request actually reached the application.

**Before (broken):**

```typescript
// test/users.e2e-spec.ts:65-71
const authHeaders = () => ({
  Authorization: `Bearer ${createBearerToken(
    jwtService,
    'test-user-id',   // ← non-UUID: will crash Neon
    'test@example.com',
  )}`,
});
```

**After (fixed):**

```typescript
// Use a deterministic UUID — no real DB row needed if Prisma is spied
const TEST_USER_UUID = '550e8400-e29b-41d4-a716-446655440001';

const authHeaders = () => ({
  Authorization: `Bearer ${createBearerToken(
    jwtService,
    TEST_USER_UUID,
    'test@example.com',
  )}`,
});
```

Also mock `AuthorizationContextService.prototype.resolveUserAuthorization` if the guard is not
already fully overridden, or ensure `PermissionsGuard` is mocked via `.overrideGuard(PermissionsGuard)`.

**References:**
- Token helper: `test/helpers/rbac-test-helpers.ts` — `createBearerToken(jwtService, sub, email)`
- Authorization mock: see `test/admin-users.e2e-spec.ts:274` for the `jest.spyOn(AuthorizationContextService.prototype, 'resolveUserAuthorization')` pattern
- Guard mock pattern used throughout: `.overrideGuard(PermissionsGuard).useValue({ canActivate: jest.fn().mockReturnValue(true) })`

---

### Pattern #2: Service/field drift

**Root cause:** Production code was refactored after the test was written. Either a service method
gained a new parameter (investiture `getPending` gained a 6th `status` arg), or a controller/DTO
renamed a response field (catalogs `year_id` → possibly `ecclesiastical_year_id`). Because CI was
running with `continue-on-error: true` and the e2e harness was broken, these regressions were
never caught.

**Fix approach:** Each drift case requires reading the current production controller/service to
understand what changed and why. Update the test assertions to match the current API surface.
Do NOT make production code conform to the old test — verify the production change was intentional
first.

---

## Tracking

- [ ] `test/users.e2e-spec.ts`
- [ ] `test/admin-users.e2e-spec.ts`
- [ ] `test/insurance.e2e-spec.ts`
- [ ] `test/admin-catalogs.e2e-spec.ts`
- [ ] `test/admin-users-scope.e2e-spec.ts`
- [ ] `test/classes.e2e-spec.ts`
- [ ] `test/evidence-folder.e2e-spec.ts`
- [ ] `test/post-registration.e2e-spec.ts`
- [ ] `test/investiture.e2e-spec.ts`
- [ ] `test/catalogs.e2e-spec.ts`

---

## CI concern (resolved for unit tests)

The `unit-test` job used to run with `continue-on-error: true`, which allowed failures to accumulate
as warnings. As of the P0+P1 backend hardening change, unit tests are blocking again in CI. The
remaining debt in this document is still useful for domain-by-domain E2E repair, but it is no longer
hidden behind a non-blocking unit-test job.
