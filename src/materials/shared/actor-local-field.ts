import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthorizationSnapshot } from '../../common/services/authorization-context.service';

/**
 * ActorLocalFieldScope describes how a caller is allowed to address local_fields
 * within the materials module.
 *
 *  - 'single'    → the user is bound to exactly one local_field. The service
 *                  must auto-filter by that local_field_id; ignore any
 *                  ?local_field_id=… override (or 403 if the override doesn't
 *                  match).
 *  - 'all'       → super-admin only. Every other role must resolve to exactly
 *                  one local_field or fail closed.
 */
export type ActorLocalFieldScope =
  | { scope: 'single'; localFieldId: number }
  | { scope: 'all' };

const LOCAL_FIELD_GLOBAL_ROLES = new Set([
  'admin',
  'director-lf',
  'assistant-lf',
]);

/**
 * Resolves the local_field constraint for the current request based on the
 * authorization snapshot attached by PermissionsGuard.
 *
 * Resolution order (first match wins):
 *  1. super-admin global grant                     → all
 *  2. effective.scope.global.local_field.id        → single LF
 *  3. effective.scope.club                         → club's LF
 *  4. union/division/unscoped non-super roles      → 403
 *
 * For (1) we still need a Prisma lookup because the snapshot only carries
 * { club_id, club_name }, not the FK to local_fields. We expose the helper as
 * a function that takes the prisma client + the snapshot.
 */
export async function resolveActorLocalField(
  prisma: PrismaService,
  authorization: AuthorizationSnapshot | undefined,
): Promise<ActorLocalFieldScope> {
  if (!authorization) {
    throw new ForbiddenException({
      code: 'missing_authorization',
      message: 'Authorization context is not available for this request.',
    });
  }

  if (
    authorization.grants.global_roles.some(
      (grant) => grant.role_name === 'super-admin',
    )
  ) {
    return { scope: 'all' };
  }

  const globalRoleNames = new Set(
    authorization.grants.global_roles.map((grant) => grant.role_name),
  );
  const hasLocalFieldAuthority = [...LOCAL_FIELD_GLOBAL_ROLES].some((role) =>
    globalRoleNames.has(role),
  );
  const lfNodeId = authorization.effective.scope.global.local_field?.id ?? null;
  if (hasLocalFieldAuthority && lfNodeId !== null) {
    const lfId = Number(lfNodeId);
    if (Number.isInteger(lfId) && lfId > 0) {
      return { scope: 'single', localFieldId: lfId };
    }
  }
  if (hasLocalFieldAuthority) {
    throw new ForbiddenException({
      code: 'local_field_scope_required',
      message: 'This role requires an exact local_field scope.',
    });
  }

  const activeAssignmentId = authorization.active_assignment.assignment_id;
  const activeGrant = authorization.grants.club_assignments.find(
    (grant) => grant.assignment_id === activeAssignmentId,
  );
  if (activeGrant?.club.club_id) {
    const found = await prisma.clubs.findUnique({
      where: { club_id: activeGrant.club.club_id },
      select: { local_field_id: true },
    });
    if (!found) {
      throw new ForbiddenException({
        code: 'club_not_found',
        message: `Club ${activeGrant.club.club_id} no longer exists.`,
      });
    }
    return { scope: 'single', localFieldId: found.local_field_id };
  }

  throw new ForbiddenException({
    code: 'local_field_scope_required',
    message: 'This role requires an exact local_field scope.',
  });
}

/**
 * Asserts that an explicit local_field_id (e.g. from a query param) is
 * compatible with the actor scope. Returns the resolved id.
 *
 *  - 'single' actor MUST hit only their own LF. If they pass an override
 *    that doesn't match, 403.
 *  - super-admin MUST pass an explicit override (otherwise 400).
 */
export function requireLocalFieldFor(
  scope: ActorLocalFieldScope,
  override: number | undefined,
  reason: 'write' | 'read' = 'write',
): number {
  if (scope.scope === 'single') {
    if (override !== undefined && override !== scope.localFieldId) {
      throw new ForbiddenException({
        code: 'local_field_scope_violation',
        message: 'You may only operate within your own local_field.',
      });
    }
    return scope.localFieldId;
  }

  if (override === undefined) {
    throw new BadRequestException({
      code: 'local_field_id_required',
      message:
        reason === 'write'
          ? 'local_field_id is required for this super-admin action.'
          : 'local_field_id is required for this super-admin listing.',
    });
  }

  return override;
}

/**
 * Rejects a UUID-targeted mutation when the resource belongs to another LF.
 * The target is deliberately resolved by the caller with its minimum scope
 * fields before this check, so a caller never needs to supply a mutable LF id.
 */
export function assertActorCanAccessLocalField(
  scope: ActorLocalFieldScope,
  targetLocalFieldId: number,
): void {
  if (scope.scope === 'single' && scope.localFieldId !== targetLocalFieldId) {
    throw new ForbiddenException({
      code: 'local_field_scope_violation',
      message: 'You may only operate within your own local_field.',
    });
  }
}
