# Honors Module Review + Validation Roles (2026-02-05)

> [!NOTE]
> Documento de revisión histórica.
> Algunos hallazgos ya fueron abordados posteriormente (por ejemplo, guards globales/owner-or-admin).
> Validar estado vigente contra código actual y `README.md`.

## Context
Request: review `src/honors` and align it with an admin-managed honors catalog and user-honor validation by administrative roles (local field / union / division + assistants, coordinator).  
Scope includes: `src/honors/*`, related DTOs, RBAC guards, Prisma schema, and product/docs references.

## Sources Reviewed
Code:
- `src/honors/honors.controller.ts`
- `src/honors/honors.service.ts`
- `src/honors/dto/honors.dto.ts`
- `src/honors/honors.module.ts`
- `src/common/guards/*`
- `src/common/decorators/*`
- `src/auth/strategies/jwt.strategy.ts`
- `src/common/dto/pagination.dto.ts`
- `prisma/schema.prisma`

Docs:
- `docs/api/API-SPECIFICATION.md`
- `docs/api/README.md`
- `docs/api/ENDPOINTS-REFERENCE.md`
- `docs/api/walkthrough-honors.md`
- `docs/api/API-ROUTES-AUDIT.md`
- `docs/01-OVERVIEW.md`
- `docs/database/SCHEMA-REFERENCE.md`
- `.specs/_steering/product.md`
- `.specs/features/honores/design.md`

## Current Implementation (Code)

### Public Catalog (Honors)
- `GET /honors` (filters: categoryId, clubTypeId, skillLevel; paginated)
- `GET /honors/:honorId`
- `GET /honors/categories`

Service behavior:
- `findAll` filters `active = true`
- `findOne` does NOT enforce `active = true`
- `getCategories` filters `active = true`

### User Honors (users_honors)
- `GET /users/:userId/honors`
- `GET /users/:userId/honors/stats`
- `POST /users/:userId/honors/:honorId` (start honor)
- `PATCH /users/:userId/honors/:honorId` (update progress)
- `DELETE /users/:userId/honors/:honorId` (abandon honor)

Service behavior:
- No owner check (any authenticated user can query/update any userId)
- `startHonor` uses check-then-create (non-atomic, no unique constraint)
- `updateUserHonor` uses truthy checks (cannot clear empty string/array)
- `users_honors` uses `active` flag for soft delete

### Data Model (Prisma)
From `prisma/schema.prisma`:
- `honors` table has `active` flag (default true)
- `users_honors` has no unique constraint on `(user_id, honor_id)`
- `certificate` is non-nullable string; `document` nullable; `images` is JSON

## Findings (Code)

### Security / Authorization
1) Missing owner-or-admin checks for `users/:userId/honors` routes.  
   - Any authenticated user can access/update another user’s honors.

2) No global-role guard exists (only club roles guard).  
   - Admin/coordinator role checks are not implemented.

3) `ClubRolesGuard` expects `request.user.sub`, but `JwtStrategy` returns `{ userId, email }`.  
   - This guard likely fails unless a different strategy is used.

### Catalog vs Admin Management
4) Catalog endpoints are public but lack an admin-only CRUD path.  
   - If honors must be managed by admins, admin endpoints are missing.

5) `findOne` should enforce `active = true` for public access.

### Consistency / Validation
6) Pagination handling differs from `PaginationDto` defaults (`take` default 50 vs DTO 20).  
7) Filters and pagination are parsed manually (not via DTO), skipping validation limits.  
8) DTO validation is incomplete:
   - `images` should be `@IsArray()` + `@IsString({ each: true })`
   - URLs should use `@IsUrl()` (if required)
   - `skillLevel` range should be bounded (1..3)
9) `updateUserHonor` uses truthy checks, so you cannot clear `certificate`, `images`, `document`.

### Data Integrity
10) `startHonor` is non-atomic; duplicates are possible under concurrency.  
11) There is no unique constraint in `users_honors` for `(user_id, honor_id)`.

## Documentation Findings

### Roles and RBAC
- Global roles documented: `super_admin`, `admin`, `coordinator`, `user`
  - `docs/api/API-SPECIFICATION.md`
  - `docs/api/README.md`
  - `docs/database/SCHEMA-REFERENCE.md`
  - `docs/01-OVERVIEW.md`

- Club roles documented separately (`director`, `subdirector`, etc).

### Coordinator Role
- Coordinator appears as a global role (union / association).
- Product docs mention "coordinator de campo" in validation flows.
- No explicit definition for assistants or division-level roles in docs.

### Honors Flow in Docs vs Implementation
- `docs/api/walkthrough-honors.md` includes:
  - instructor-driven requirement validations
  - certify endpoints
  - club-scoped listings
  - advanced progress endpoints
  These are not implemented in current `src/honors`.

- `docs/api/API-ROUTES-AUDIT.md` lists endpoints not present in code.

### Gap
Docs mention multi-level validation (counselor -> director -> coordinator -> local field), but there is no role/guard logic implemented for that in honors.

## Decisions Needed

1) Validation roles:
   - Who can set `validate` / `certificate` in `users_honors`?
   - Current docs only define global roles: `admin`, `coordinator`, `super_admin`.

2) Validation scope:
   - Should admins be limited by `users.local_field_id`?
   - Should coordinators be limited by `users.union_id`?
   - Should super_admin be unrestricted?

3) Assistants / division roles:
   - If assistants or division roles are required, do we add roles to the `roles` table or map them to existing global roles?

## Proposed Approach (No DB schema changes)

If we use existing roles and data:

- Validation allowed for:
  - `admin`: local field scope (by `users.local_field_id`)
  - `coordinator`: union scope (by `users.union_id`)
  - `super_admin`: global
- Enforce owner-or-admin guard for `users/:userId/honors` routes
- Use `users_roles` + `roles` to check global roles
- If scope needed, compare the target user’s union/local_field with the admin’s

## Proposed Code Changes (Pending Decision)

### Guards + Decorators
- Add `GlobalRolesGuard` + `@GlobalRoles` decorator
- Add guard for owner-or-admin (self or global role)
- Export from `src/common/guards/index.ts` and `src/common/decorators/index.ts`

### Honors Controller
- Apply owner-or-admin guard to `users/:userId/honors/*`
- If validate/cert fields are updated, enforce role guard (admin/coordinator/super_admin)
- Use DTO-based query parsing (`PaginationDto`, `HonorFiltersDto`)

### Honors Service
- `findOne` should filter `active: true` for public access
- `startHonor`: if inactive record exists, reactivate instead of create
- `updateUserHonor`: allow clearing fields (check `!== undefined`)

### DTOs
- Add `@IsString({ each: true })` for `images`
- Add `@IsUrl()` for URL fields (if required)
- Add `@Min(1) @Max(3)` for `skillLevel`

### Tests
- Coverage for owner-or-admin access
- Update and clear fields
- Reactivation path
- Filter/validation behavior

## Open Questions (For Team Review)
- Do we need new roles for assistants/division, or can we map them to existing global roles?
- Should catalog CRUD be added now (admin-only), or kept for later?
- Should club roles (director/subdirector/instructor) ever be allowed to validate honors, or only administrative roles?
