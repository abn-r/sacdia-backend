import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthorizationSnapshot } from '../../common/services/authorization-context.service';
import { AppForbiddenException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  assertLocalFieldInActorScope,
  resolveActorTerritoryScope,
  resolveLocalFieldIdsForList,
  type ActorTerritoryScope,
} from '../../common/authorization/actor-territory-scope';

/**
 * ActorLocalFieldScope describes how a caller is allowed to address local_fields
 * within the materials module.
 *
 *  - 'single'    → bound to exactly one local_field.
 *  - 'union'     → every local_field in that union (does not collapse to home field).
 *  - 'division'  → every local_field in that division.
 *  - 'all'       → unscoped caller (super-admin / club-only fallback with no LF).
 */
export type ActorLocalFieldScope =
  | { scope: 'single'; localFieldId: number }
  | { scope: 'union'; unionId: number }
  | { scope: 'division'; divisionId: number }
  | { scope: 'all' };

function actorFromMaterialsScope(
  scope: ActorLocalFieldScope,
): ActorTerritoryScope {
  if (scope.scope === 'single') {
    return { level: 'local_field', localFieldId: scope.localFieldId };
  }
  if (scope.scope === 'union') {
    return { level: 'union', unionId: scope.unionId };
  }
  if (scope.scope === 'division') {
    return { level: 'division', divisionId: scope.divisionId };
  }
  return { level: 'all' };
}

/**
 * Role-first local_field constraint. A union/division actor with a home
 * `local_field_id` stays at union/division — they do not collapse to 'single'.
 *
 * Club-only actors (no territorial global role) still resolve via the active
 * club assignment's local_field.
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

  const actor = resolveActorTerritoryScope(authorization);
  if (actor.level === 'unconfigured') {
    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
  }
  if (actor.level === 'local_field') {
    return { scope: 'single', localFieldId: actor.localFieldId };
  }
  if (actor.level === 'union') {
    return { scope: 'union', unionId: actor.unionId };
  }
  if (actor.level === 'division') {
    return { scope: 'division', divisionId: actor.divisionId };
  }
  if (actor.level === 'all') {
    return { scope: 'all' };
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

  return { scope: 'all' };
}

/**
 * Asserts that an explicit local_field_id is compatible with the actor scope.
 *
 *  - 'single' actor MUST hit only their own LF.
 *  - 'all' / union / division MUST pass an explicit override for writes/reads
 *    that target one field; union/division overrides must sit inside the territory.
 */
export async function requireLocalFieldFor(
  prisma: PrismaService,
  scope: ActorLocalFieldScope,
  override: number | undefined,
  reason: 'write' | 'read' = 'write',
): Promise<number> {
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

  if (scope.scope === 'union' || scope.scope === 'division') {
    await assertLocalFieldInActorScope(
      prisma,
      override,
      actorFromMaterialsScope(scope),
    );
  }

  return override;
}

export async function resolveMaterialsListLocalFieldId(
  prisma: PrismaService,
  authorization: AuthorizationSnapshot | undefined,
  override?: number,
): Promise<number | number[] | undefined> {
  const scope = await resolveActorLocalField(prisma, authorization);
  const actor = resolveActorTerritoryScope(authorization);

  if (scope.scope === 'single') {
    if (override !== undefined && override !== scope.localFieldId) {
      throw new ForbiddenException({
        code: 'local_field_scope_violation',
        message: 'You may only operate within your own local_field.',
      });
    }
    return scope.localFieldId;
  }

  return resolveLocalFieldIdsForList(prisma, actor, override);
}
