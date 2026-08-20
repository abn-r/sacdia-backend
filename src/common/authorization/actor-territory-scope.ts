import { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import type {
  AuthorizationSnapshot,
  ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import type { PrismaService } from '../../prisma/prisma.service';

const SUPER_ADMIN_ROLES = new Set(['super-admin']);
const DIVISION_ROLES = new Set(['director-dia', 'assistant-dia']);
const UNION_ROLES = new Set(['director-union', 'assistant-union']);
const LOCAL_FIELD_ROLES = new Set(['director-lf', 'assistant-lf']);
const ADMIN_SCOPE_ROLES = new Set(['admin', 'assistant-admin']);

export type ActorTerritoryScope =
  | { level: 'all' }
  | { level: 'open' }
  | { level: 'unconfigured' }
  | {
      level: 'division';
      divisionId: number;
      unionId?: number;
      localFieldId?: number;
    }
  | {
      level: 'union';
      unionId: number;
      divisionId?: number;
      localFieldId?: number;
    }
  | {
      level: 'local_field';
      localFieldId: number;
      unionId?: number;
      divisionId?: number;
    };

export type ActorTerritoryInput =
  | AuthorizationSnapshot
  | ResolvedAuthorizationProfile
  | null
  | undefined;

type GlobalScopeNodes = NonNullable<
  AuthorizationSnapshot['effective']['scope']['global']
>;

export function toTerritoryId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return undefined;
}

export function asAuthorizationSnapshot(
  input: ActorTerritoryInput,
): AuthorizationSnapshot | undefined {
  if (!input) {
    return undefined;
  }

  if ('authorization' in input && input.authorization) {
    return input.authorization;
  }

  if ('grants' in input && 'effective' in input) {
    return input;
  }

  return undefined;
}

export function hasTerritorialRecorte(
  scope: ActorTerritoryScope,
): scope is Extract<
  ActorTerritoryScope,
  { level: 'division' | 'union' | 'local_field' }
> {
  return (
    scope.level === 'division' ||
    scope.level === 'union' ||
    scope.level === 'local_field'
  );
}

function roleNamesFromSnapshot(snapshot: AuthorizationSnapshot): Set<string> {
  return new Set(
    (snapshot.grants?.global_roles ?? []).map((grant) =>
      grant.role_name.trim().toLowerCase(),
    ),
  );
}

function hasAnyRole(roles: Set<string>, allowed: Set<string>): boolean {
  for (const role of allowed) {
    if (roles.has(role)) {
      return true;
    }
  }
  return false;
}

function readGlobalScope(
  snapshot: AuthorizationSnapshot,
): GlobalScopeNodes | undefined {
  return snapshot.effective?.scope?.global;
}

function scopeIds(globalScope: GlobalScopeNodes | undefined): {
  divisionId?: number;
  unionId?: number;
  localFieldId?: number;
} {
  return {
    divisionId: toTerritoryId(globalScope?.division?.id),
    unionId: toTerritoryId(globalScope?.union?.id),
    localFieldId: toTerritoryId(globalScope?.local_field?.id),
  };
}

function withOptionalIds<T extends ActorTerritoryScope>(
  scope: T,
  ids: { divisionId?: number; unionId?: number; localFieldId?: number },
): T {
  if (scope.level === 'all' || scope.level === 'open' || scope.level === 'unconfigured') {
    return scope;
  }

  return {
    ...scope,
    ...(ids.divisionId ? { divisionId: ids.divisionId } : {}),
    ...(ids.unionId ? { unionId: ids.unionId } : {}),
    ...(ids.localFieldId ? { localFieldId: ids.localFieldId } : {}),
  };
}

/**
 * Role-first territorial scope. Home `local_field_id` never upgrades or
 * downgrades a union/division actor. Admin/assistant-admin follow dashboard
 * precedence: union, then local field, then division.
 */
export function resolveActorTerritoryScope(
  input: ActorTerritoryInput,
): ActorTerritoryScope {
  const snapshot = asAuthorizationSnapshot(input);
  if (!snapshot) {
    return { level: 'open' };
  }

  const roles = roleNamesFromSnapshot(snapshot);
  const ids = scopeIds(readGlobalScope(snapshot));

  if (hasAnyRole(roles, SUPER_ADMIN_ROLES)) {
    return { level: 'all' };
  }

  if (hasAnyRole(roles, DIVISION_ROLES)) {
    if (!ids.divisionId) {
      return { level: 'unconfigured' };
    }
    return withOptionalIds(
      { level: 'division', divisionId: ids.divisionId },
      ids,
    );
  }

  if (hasAnyRole(roles, UNION_ROLES)) {
    if (!ids.unionId) {
      return { level: 'unconfigured' };
    }
    return withOptionalIds({ level: 'union', unionId: ids.unionId }, ids);
  }

  if (hasAnyRole(roles, LOCAL_FIELD_ROLES)) {
    if (!ids.localFieldId) {
      return { level: 'unconfigured' };
    }
    return withOptionalIds(
      { level: 'local_field', localFieldId: ids.localFieldId },
      ids,
    );
  }

  if (hasAnyRole(roles, ADMIN_SCOPE_ROLES)) {
    if (ids.unionId) {
      return withOptionalIds({ level: 'union', unionId: ids.unionId }, ids);
    }
    if (ids.localFieldId) {
      return withOptionalIds(
        { level: 'local_field', localFieldId: ids.localFieldId },
        ids,
      );
    }
    if (ids.divisionId) {
      return withOptionalIds(
        { level: 'division', divisionId: ids.divisionId },
        ids,
      );
    }
    return { level: 'unconfigured' };
  }

  return { level: 'open' };
}

export function clubsWhereForActor(
  scope: ActorTerritoryScope,
): Prisma.clubsWhereInput {
  switch (scope.level) {
    case 'all':
    case 'open':
      return {};
    case 'unconfigured':
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    case 'local_field':
      return { local_field_id: scope.localFieldId };
    case 'union':
      return { local_fields: { union_id: scope.unionId } };
    case 'division':
      return { local_fields: { unions: { division_id: scope.divisionId } } };
  }
}

export function localFieldsWhereForActor(
  scope: ActorTerritoryScope,
): Prisma.local_fieldsWhereInput {
  switch (scope.level) {
    case 'all':
    case 'open':
      return {};
    case 'unconfigured':
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    case 'local_field':
      return { local_field_id: scope.localFieldId };
    case 'union':
      return { union_id: scope.unionId };
    case 'division':
      return { unions: { division_id: scope.divisionId } };
  }
}

export function actorCanAccessHierarchyScope(
  actor: ActorTerritoryScope,
  resource: {
    division_id?: number | null;
    union_id?: number | null;
    local_field_id?: number | null;
  },
): boolean {
  if (actor.level === 'all') {
    return true;
  }

  if (actor.level === 'open' || actor.level === 'unconfigured') {
    return false;
  }

  if (actor.level === 'local_field') {
    return (
      typeof resource.local_field_id === 'number' &&
      resource.local_field_id === actor.localFieldId
    );
  }

  if (actor.level === 'union') {
    return (
      typeof resource.union_id === 'number' && resource.union_id === actor.unionId
    );
  }

  return (
    typeof resource.division_id === 'number' &&
    resource.division_id === actor.divisionId
  );
}

export async function isLocalFieldInActorScope(
  prisma: Pick<PrismaService, 'local_fields'>,
  localFieldId: number,
  scope: ActorTerritoryScope,
): Promise<boolean> {
  if (scope.level === 'all' || scope.level === 'open') {
    return true;
  }

  if (scope.level === 'unconfigured') {
    return false;
  }

  if (scope.level === 'local_field') {
    return localFieldId === scope.localFieldId;
  }

  const localField = await prisma.local_fields.findUnique({
    where: { local_field_id: localFieldId },
    select: {
      local_field_id: true,
      union_id: true,
      unions: { select: { division_id: true } },
    },
  });

  if (!localField) {
    return false;
  }

  if (scope.level === 'union') {
    return localField.union_id === scope.unionId;
  }

  return localField.unions?.division_id === scope.divisionId;
}

export async function assertLocalFieldInActorScope(
  prisma: Pick<PrismaService, 'local_fields'>,
  localFieldId: number,
  scope: ActorTerritoryScope,
): Promise<void> {
  if (scope.level === 'all' || scope.level === 'open') {
    return;
  }

  if (scope.level === 'unconfigured') {
    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
  }

  const allowed = await isLocalFieldInActorScope(prisma, localFieldId, scope);
  if (!allowed) {
    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }
}

export async function assertClubListFiltersInActorScope(
  prisma: Pick<PrismaService, 'local_fields' | 'districts' | 'churches'>,
  scope: ActorTerritoryScope,
  filters?: {
    localFieldId?: number;
    districtId?: number;
    churchId?: number;
  },
): Promise<void> {
  if (!hasTerritorialRecorte(scope)) {
    if (scope.level === 'unconfigured') {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    return;
  }

  if (filters?.localFieldId !== undefined) {
    await assertLocalFieldInActorScope(prisma, filters.localFieldId, scope);
  }

  if (filters?.districtId !== undefined) {
    const district = await prisma.districts.findUnique({
      where: { districlub_type_id: filters.districtId },
      select: { local_field_id: true },
    });
    if (!district) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    await assertLocalFieldInActorScope(prisma, district.local_field_id, scope);
  }

  if (filters?.churchId !== undefined) {
    const church = await prisma.churches.findUnique({
      where: { church_id: filters.churchId },
      select: { districts: { select: { local_field_id: true } } },
    });
    if (!church?.districts) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
    await assertLocalFieldInActorScope(
      prisma,
      church.districts.local_field_id,
      scope,
    );
  }
}

export async function resolveLocalFieldIdsForList(
  prisma: Pick<PrismaService, 'local_fields'>,
  scope: ActorTerritoryScope,
  override?: number,
): Promise<number | number[] | undefined> {
  if (scope.level === 'unconfigured') {
    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
  }

  if (override !== undefined) {
    await assertLocalFieldInActorScope(prisma, override, scope);
    return override;
  }

  if (scope.level === 'all' || scope.level === 'open') {
    return undefined;
  }

  if (scope.level === 'local_field') {
    return scope.localFieldId;
  }

  const rows = await prisma.local_fields.findMany({
    where: localFieldsWhereForActor(scope),
    select: { local_field_id: true },
  });

  return rows.map((row) => row.local_field_id);
}
