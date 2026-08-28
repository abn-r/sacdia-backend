import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorCanAccessHierarchyScope,
  resolveActorTerritoryScope,
  type ActorTerritoryScope,
} from '../common/authorization/actor-territory-scope';
import {
  resolveOrderActor,
  type OrderActor,
  type RequestWithProfile,
} from '../field-payment-orders/order-actor';

export type { OrderActor, RequestWithProfile };

export const ISSUER_CLUB_ROLES: ReadonlySet<string> = new Set([
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
  'treasurer',
]);

const REVIEW_ROLES = new Set([
  'director-lf',
  'assistant-lf',
  'admin',
  'super-admin',
]);

export type CamporeeOrderOwnerScope = 'DIVISION' | 'UNION' | 'LOCAL_FIELD';

export type CamporeeOrderOwner = {
  scope: CamporeeOrderOwnerScope;
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
};

export type CamporeeOfferingTarget = {
  type: 'local' | 'union';
  localFieldId?: number;
  unionId?: number;
};

export interface CamporeeOrderActor extends OrderActor {
  territory: ActorTerritoryScope;
  globalRoles: readonly string[];
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

function globalRoleSet(actor: CamporeeOrderActor): Set<string> {
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

function activeClubRole(actor: CamporeeOrderActor): string | undefined {
  const role = actor.activeSection?.role_name;
  return typeof role === 'string' ? normalizeRole(role) : undefined;
}

/**
 * Order-actor semantics plus the canonical territorial recorte. Club issuance
 * still comes from the active assignment; catalog/review/offering checks use
 * `territory` and never invent a second hierarchy resolver.
 */
export function resolveCamporeeOrderActor(
  request: RequestWithProfile,
): CamporeeOrderActor {
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

export function assertCanIssueOrder(actor: CamporeeOrderActor): void {
  const role = activeClubRole(actor);
  if (!actor.activeSection || !role || !ISSUER_CLUB_ROLES.has(role)) {
    throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
  }
}

export function assertCanDistribute(
  actor: CamporeeOrderActor,
  orderClubSectionId: number,
): void {
  const section = actor.activeSection;
  const role = activeClubRole(actor);
  if (
    !section ||
    role !== 'director' ||
    section.club_section_id !== orderClubSectionId
  ) {
    throw new AppForbiddenException(ErrorCode.CAMPOREE_ORDER_FORBIDDEN);
  }
}

/**
 * Territorial write access to a library product. Ancestors may manage a
 * descendant-owned product (union/division → LOCAL_FIELD; division → UNION).
 * LF cannot create or mutate union/division-owned products. Unconfigured and
 * open actors fail closed.
 */
export function canManageCatalog(
  actor: CamporeeOrderActor,
  owner: CamporeeOrderOwner,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
    return false;
  }
  if (territory.level === 'all') {
    return true;
  }

  if (owner.scope === 'DIVISION') {
    return (
      territory.level === 'division' &&
      typeof owner.divisionId === 'number' &&
      territory.divisionId === owner.divisionId
    );
  }

  if (owner.scope === 'UNION') {
    if (territory.level === 'local_field') {
      return false;
    }
    if (territory.level === 'union') {
      return (
        typeof owner.unionId === 'number' && territory.unionId === owner.unionId
      );
    }
    return (
      territory.level === 'division' &&
      typeof owner.divisionId === 'number' &&
      territory.divisionId === owner.divisionId
    );
  }

  return actorCanAccessHierarchyScope(territory, {
    division_id: owner.divisionId,
    union_id: owner.unionId,
    local_field_id: owner.localFieldId,
  });
}

/**
 * Offerings are owned by the camporee organizer, not by territorial ancestors.
 * Union leadership does not configure a local camporee's catalog; LF does not
 * configure a union camporee's catalog. Super-admin (`all`) may.
 */
export function canConfigureOffering(
  actor: CamporeeOrderActor,
  camporee: CamporeeOfferingTarget,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
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

function canOperateLocalFieldCaja(
  actor: CamporeeOrderActor,
  orderLocalFieldId: number,
): boolean {
  const { territory } = actor;
  if (isMutationScopeClosed(territory)) {
    return false;
  }
  if (!hasAnyRole(globalRoleSet(actor), REVIEW_ROLES)) {
    return false;
  }
  if (territory.level === 'all') {
    return true;
  }
  if (
    typeof actor.localFieldId === 'number' &&
    actor.localFieldId === orderLocalFieldId
  ) {
    return true;
  }
  if (territory.level === 'local_field') {
    return territory.localFieldId === orderLocalFieldId;
  }
  return false;
}

export function canReviewPayment(
  actor: CamporeeOrderActor,
  orderLocalFieldId: number,
): boolean {
  return canOperateLocalFieldCaja(actor, orderLocalFieldId);
}

export function canAuthorizeWithoutProof(
  actor: CamporeeOrderActor,
  orderLocalFieldId: number,
): boolean {
  return canOperateLocalFieldCaja(actor, orderLocalFieldId);
}

export function canDeliverToSection(
  actor: CamporeeOrderActor,
  orderLocalFieldId: number,
): boolean {
  return canOperateLocalFieldCaja(actor, orderLocalFieldId);
}
