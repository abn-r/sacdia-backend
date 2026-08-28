import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  resolveActorTerritoryScope,
  type ActorTerritoryScope,
} from '../common/authorization/actor-territory-scope';
import {
  resolveOrderActor,
  type OrderActor,
  type RequestWithProfile,
} from '../field-payment-orders/order-actor';

export type { OrderActor, RequestWithProfile };

export const SUPPLY_ISSUER_CLUB_ROLES: ReadonlySet<string> = new Set([
  'director',
  'secretary',
  'secretary-treasurer',
]);

const LF_CAJA_ROLES = new Set([
  'director-lf',
  'assistant-lf',
  'admin',
  'super-admin',
]);

const ORGANIZER_ROLES = new Set([
  'director-lf',
  'assistant-lf',
  'director-union',
  'assistant-union',
  'admin',
  'super-admin',
]);

export type CamporeeKind = 'local' | 'union';

export type SupplyCamporeeTarget = {
  type: CamporeeKind;
  localFieldId?: number;
  unionId?: number;
};

export interface CamporeeSupplyActor extends OrderActor {
  territory: ActorTerritoryScope;
  globalRoles: readonly string[];
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function globalRoleSet(actor: CamporeeSupplyActor): Set<string> {
  return new Set(actor.globalRoles.map(normalizeRole));
}

function hasAnyRole(roles: Set<string>, allowed: Set<string>): boolean {
  for (const role of allowed) {
    if (roles.has(role)) {
      return true;
    }
  }
  return false;
}

function isMutationScopeClosed(territory: ActorTerritoryScope): boolean {
  return territory.level === 'unconfigured' || territory.level === 'open';
}

function activeClubRole(actor: CamporeeSupplyActor): string | undefined {
  const role = actor.activeSection?.role_name;
  return typeof role === 'string' ? normalizeRole(role) : undefined;
}

export function resolveCamporeeSupplyActor(
  request: RequestWithProfile,
): CamporeeSupplyActor {
  const orderActor = resolveOrderActor(request);
  const territory = resolveActorTerritoryScope(request.authorizationProfile);
  const globalRoles = (
    request.authorizationProfile?.authorization.grants.global_roles ?? []
  ).map((grant) => normalizeRole(grant.role_name));

  return {
    ...orderActor,
    territory,
    globalRoles,
  };
}

export function assertCanPlanSupplies(actor: CamporeeSupplyActor): void {
  const role = activeClubRole(actor);
  if (!actor.activeSection || !role || !SUPPLY_ISSUER_CLUB_ROLES.has(role)) {
    throw new AppForbiddenException(ErrorCode.CAMPOREE_SUPPLIES_FORBIDDEN);
  }
}

export function isLfCaja(actor: CamporeeSupplyActor): boolean {
  return hasAnyRole(globalRoleSet(actor), LF_CAJA_ROLES);
}

export function isSupplyOrganizer(actor: CamporeeSupplyActor): boolean {
  return hasAnyRole(globalRoleSet(actor), ORGANIZER_ROLES);
}

export function canOperateLocalFieldCaja(
  actor: CamporeeSupplyActor,
  planLocalFieldId: number,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
    return false;
  }
  if (!isLfCaja(actor)) {
    return false;
  }
  if (territory.level === 'all') {
    return true;
  }
  if (
    typeof actor.localFieldId === 'number' &&
    actor.localFieldId === planLocalFieldId
  ) {
    return true;
  }
  if (territory.level === 'local_field') {
    return territory.localFieldId === planLocalFieldId;
  }
  return false;
}

export function canReviewSupplyPayment(
  actor: CamporeeSupplyActor,
  planLocalFieldId: number,
): boolean {
  return canOperateLocalFieldCaja(actor, planLocalFieldId);
}

export function canDeliverSupplies(
  actor: CamporeeSupplyActor,
  planLocalFieldId: number,
): boolean {
  return canOperateLocalFieldCaja(actor, planLocalFieldId);
}

/**
 * Organizer of the camporee (LF for local, union for union) plus platform admin.
 * Participating LF on a union camporee is allowed by the service after an
 * enrollment check — this helper only covers exact organizer scope.
 */
export function canConfigureSupplyOrganizer(
  actor: CamporeeSupplyActor,
  camporee: SupplyCamporeeTarget,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
    return false;
  }
  if (!isSupplyOrganizer(actor)) {
    return false;
  }
  if (territory.level === 'all') {
    return true;
  }
  if (camporee.type === 'local') {
    return (
      territory.level === 'local_field' &&
      typeof camporee.localFieldId === 'number' &&
      territory.localFieldId === camporee.localFieldId
    );
  }
  return (
    territory.level === 'union' &&
    typeof camporee.unionId === 'number' &&
    territory.unionId === camporee.unionId
  );
}

export function canConfigureAsParticipatingLf(
  actor: CamporeeSupplyActor,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
    return false;
  }
  if (
    !hasAnyRole(
      globalRoleSet(actor),
      new Set(['director-lf', 'assistant-lf', 'admin', 'super-admin']),
    )
  ) {
    return false;
  }
  return territory.level === 'local_field' || territory.level === 'all';
}

export function canBypassSupplyFreeze(actor: CamporeeSupplyActor): boolean {
  return hasAnyRole(
    globalRoleSet(actor),
    new Set([
      'director-lf',
      'assistant-lf',
      'director-union',
      'assistant-union',
      'admin',
      'super-admin',
    ]),
  );
}
