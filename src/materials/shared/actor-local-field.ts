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
 *  - 'all'       → unscoped caller (super-admin / admin GLOBAL with no
 *                  territorial scope). The service must require the caller
 *                  to pass an explicit local_field_id when targeting a single
 *                  field, or fan out across fields for listing endpoints.
 */
export type ActorLocalFieldScope =
  | { scope: 'single'; localFieldId: number }
  | { scope: 'all' };

/**
 * Resolves the local_field constraint for the current request based on the
 * authorization snapshot attached by PermissionsGuard.
 *
 * Resolution order (first match wins):
 *  1. effective.scope.club.local_field_id          → director (CLUB role)
 *  2. effective.scope.global.local_field.id        → director-lf / assistant-lf
 *     (LF-territorial GLOBAL role)
 *  3. effective.scope.global.union/country/none    → admin / super-admin
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

  const territorial = authorization.effective.scope.global;
  const lfNodeId = territorial?.local_field?.id;
  if (lfNodeId !== undefined && lfNodeId !== null) {
    const lfId =
      typeof lfNodeId === 'string' ? parseInt(lfNodeId, 10) : lfNodeId;
    if (Number.isFinite(lfId)) {
      return { scope: 'single', localFieldId: lfId };
    }
  }

  const club = authorization.effective.scope.club;
  if (club?.club.club_id) {
    const found = await prisma.clubs.findUnique({
      where: { club_id: club.club.club_id },
      select: { local_field_id: true },
    });
    if (!found) {
      throw new ForbiddenException({
        code: 'club_not_found',
        message: `Club ${club.club.club_id} no longer exists.`,
      });
    }
    return { scope: 'single', localFieldId: found.local_field_id };
  }

  // Admin / super-admin with no territorial scope → 'all'
  return { scope: 'all' };
}

/**
 * Asserts that an explicit local_field_id (e.g. from a query param) is
 * compatible with the actor scope. Returns the resolved id.
 *
 *  - 'single' actor MUST hit only their own LF. If they pass an override
 *    that doesn't match, 403.
 *  - 'all' actor MUST pass an explicit override (otherwise 400) because
 *    the service can't guess which LF to write to.
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
          ? 'local_field_id is required for this action when called by an unscoped admin.'
          : 'local_field_id query param is required for this listing when called by an unscoped admin.',
    });
  }

  return override;
}
