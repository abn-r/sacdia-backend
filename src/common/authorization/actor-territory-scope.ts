import { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import type {
  AuthorizationSnapshot,
  ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { LOCAL_FIELD_ROLES as LOCAL_FIELD_ROLE_LIST } from './role-sets';
import { ActorScope } from './actor-scope';
import { toTerritoryId } from './territory-id';

export { toTerritoryId };

export const LOCAL_FIELD_ROLES: ReadonlySet<string> = new Set(
  LOCAL_FIELD_ROLE_LIST,
);

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
  AuthorizationSnapshot | ResolvedAuthorizationProfile | null | undefined;

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

/**
 * Role-first territorial scope. Home `local_field_id` never upgrades or
 * downgrades a union/division actor. Admin/assistant-admin follow dashboard
 * precedence: union, then local field, then division. The ladder itself lives
 * in `ActorScope.territorialTier()`; this adapter only accepts a bare
 * snapshot or a resolved profile.
 */
export function resolveActorTerritoryScope(
  input: ActorTerritoryInput,
): ActorTerritoryScope {
  const snapshot = asAuthorizationSnapshot(input);
  if (!snapshot) {
    return { level: 'open' };
  }

  return ActorScope.from({
    authorization: snapshot,
  } as ResolvedAuthorizationProfile).territorialTier();
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

/**
 * Un MIEMBRO pertenece a un territorio si su propia fila `users` lo dice O
 * tiene un rol de club EFECTIVO en un club de ese territorio (decisión de
 * producto: un director sin `users.local_field_id` sigue siendo del Campo
 * Local de su club). Para consultas centradas en la persona, no en el club.
 *
 * `effectiveAssignment` es el predicado canónico de vigencia
 * (`ClubAssignmentEffectivityPolicy.toPrismaWhere`, vía
 * `MemberTerritoryScopeService`): activo, estado `active` y dentro de
 * start/end/expires. Estos builders nunca definen vigencia por su cuenta.
 */
function memberViaClubWhere(
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
  clubsWhere: Prisma.clubsWhereInput,
): Prisma.usersWhereInput {
  return {
    club_role_assignments: {
      some: {
        ...effectiveAssignment,
        club_sections: { clubs: clubsWhere },
      },
    },
  };
}

export function memberInLocalFieldWhere(
  localFieldId: number,
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
): Prisma.usersWhereInput {
  return {
    OR: [
      { local_field_id: localFieldId },
      memberViaClubWhere(effectiveAssignment, { local_field_id: localFieldId }),
    ],
  };
}

export function memberInUnionWhere(
  unionId: number,
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
): Prisma.usersWhereInput {
  return {
    OR: [
      { union_id: unionId },
      { local_fields: { union_id: unionId } },
      memberViaClubWhere(effectiveAssignment, {
        local_fields: { union_id: unionId },
      }),
    ],
  };
}

export function memberInDivisionWhere(
  divisionId: number,
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
): Prisma.usersWhereInput {
  return {
    OR: [
      { unions: { division_id: divisionId } },
      { local_fields: { unions: { division_id: divisionId } } },
      memberViaClubWhere(effectiveAssignment, {
        local_fields: { unions: { division_id: divisionId } },
      }),
    ],
  };
}

/** `users` visibles para el actor (miembro-céntrico). Igual que los otros helpers, `unconfigured` falla cerrado. */
export function usersWhereForActor(
  scope: ActorTerritoryScope,
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
): Prisma.usersWhereInput {
  switch (scope.level) {
    case 'all':
    case 'open':
      return {};
    case 'unconfigured':
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    case 'local_field':
      return memberInLocalFieldWhere(scope.localFieldId, effectiveAssignment);
    case 'union':
      return memberInUnionWhere(scope.unionId, effectiveAssignment);
    case 'division':
      return memberInDivisionWhere(scope.divisionId, effectiveAssignment);
  }
}

/** ¿El usuario es miembro del Campo Local (fila propia o rol de club efectivo)? */
export async function isMemberInLocalField(
  prisma: Pick<PrismaService, 'users'>,
  userId: string,
  localFieldId: number,
  effectiveAssignment: Prisma.club_role_assignmentsWhereInput,
  /** `users.local_field_id` when the caller already loaded it. */
  ownLocalFieldId?: number | null,
): Promise<boolean> {
  // Own user row first: the common case needs no club lookup.
  const own =
    ownLocalFieldId !== undefined
      ? ownLocalFieldId
      : ((
          await prisma.users.findUnique({
            where: { user_id: userId },
            select: { local_field_id: true },
          })
        )?.local_field_id ?? null);
  if (own === localFieldId) {
    return true;
  }
  const count = await prisma.users.count({
    where: {
      AND: [
        { user_id: userId },
        memberInLocalFieldWhere(localFieldId, effectiveAssignment),
      ],
    },
  });
  return count > 0;
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
      typeof resource.union_id === 'number' &&
      resource.union_id === actor.unionId
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

export function catalogCountryIdFromActor(
  input: ActorTerritoryInput,
): number | undefined {
  const snapshot = asAuthorizationSnapshot(input);
  const fromScope = toTerritoryId(
    snapshot?.effective?.scope?.global?.country?.id,
  );
  if (fromScope) {
    return fromScope;
  }

  if (input && typeof input === 'object' && 'profile' in input) {
    return toTerritoryId(input.profile?.country_id);
  }

  return undefined;
}

/**
 * Country used to recorte GET /catalogs geography. `all` / `open` → no
 * recorte. Territorial without a resolvable country → fail-closed.
 */
export async function resolveActorCatalogCountryId(
  prisma: Pick<PrismaService, 'local_fields' | 'unions'>,
  input: ActorTerritoryInput,
): Promise<number | undefined> {
  const scope = resolveActorTerritoryScope(input);
  if (scope.level === 'all' || scope.level === 'open') {
    return undefined;
  }

  if (scope.level === 'unconfigured') {
    throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
  }

  const fromActor = catalogCountryIdFromActor(input);
  if (fromActor) {
    return fromActor;
  }

  if (scope.level === 'local_field') {
    const localField = await prisma.local_fields.findUnique({
      where: { local_field_id: scope.localFieldId },
      select: { unions: { select: { country_id: true } } },
    });
    const countryId = toTerritoryId(localField?.unions?.country_id);
    if (!countryId) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    return countryId;
  }

  if (scope.level === 'union') {
    const union = await prisma.unions.findUnique({
      where: { union_id: scope.unionId },
      select: { country_id: true },
    });
    const countryId = toTerritoryId(union?.country_id);
    if (!countryId) {
      throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
    }
    return countryId;
  }

  throw new AppForbiddenException(ErrorCode.ADMIN_USER_SCOPE_MISSING);
}

/**
 * Geography a territorial actor may list in GET /catalogs: their country, or
 * their division for division leadership (a division spans several
 * countries, so a single country would hide part of it).
 */
export type CatalogRecorte = { countryId: number } | { divisionId: number };

/** `undefined` = no recorte. Same fail-closed rules as the country helper. */
export async function resolveActorCatalogRecorte(
  prisma: Pick<PrismaService, 'local_fields' | 'unions'>,
  input: ActorTerritoryInput,
): Promise<CatalogRecorte | undefined> {
  const scope = resolveActorTerritoryScope(input);
  if (scope.level === 'division') {
    return { divisionId: scope.divisionId };
  }
  const countryId = await resolveActorCatalogCountryId(prisma, input);
  return countryId === undefined ? undefined : { countryId };
}

/** 403 when a catalog filter points outside the actor recorte. */
export async function assertCatalogFiltersInRecorte(
  prisma: Pick<PrismaService, 'unions' | 'local_fields' | 'districts'>,
  recorte: CatalogRecorte,
  filters?: Parameters<typeof assertCatalogFiltersInCountry>[2],
): Promise<void> {
  if ('countryId' in recorte) {
    return assertCatalogFiltersInCountry(prisma, recorte.countryId, filters);
  }
  if (!filters) {
    return;
  }

  const { divisionId } = recorte;
  const deny = () => {
    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  };

  if (filters.divisionId !== undefined && filters.divisionId !== divisionId) {
    deny();
  }

  if (filters.countryId !== undefined) {
    const unionInDivision = await prisma.unions.findFirst({
      where: {
        country_id: filters.countryId,
        division_id: divisionId,
        active: true,
      },
      select: { union_id: true },
    });
    if (!unionInDivision) deny();
  }

  if (filters.unionId !== undefined) {
    const union = await prisma.unions.findUnique({
      where: { union_id: filters.unionId },
      select: { division_id: true },
    });
    if (!union || union.division_id !== divisionId) deny();
  }

  if (filters.localFieldId !== undefined) {
    const localField = await prisma.local_fields.findUnique({
      where: { local_field_id: filters.localFieldId },
      select: { unions: { select: { division_id: true } } },
    });
    if (localField?.unions?.division_id !== divisionId) deny();
  }

  if (filters.districtId !== undefined) {
    const district = await prisma.districts.findUnique({
      where: { districlub_type_id: filters.districtId },
      select: {
        local_fields: {
          select: { unions: { select: { division_id: true } } },
        },
      },
    });
    if (district?.local_fields?.unions?.division_id !== divisionId) deny();
  }
}

export async function assertCatalogFiltersInCountry(
  prisma: Pick<PrismaService, 'unions' | 'local_fields' | 'districts'>,
  countryId: number,
  filters?: {
    countryId?: number;
    divisionId?: number;
    unionId?: number;
    localFieldId?: number;
    districtId?: number;
  },
): Promise<void> {
  if (!filters) {
    return;
  }

  if (filters.countryId !== undefined && filters.countryId !== countryId) {
    throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
  }

  if (filters.unionId !== undefined) {
    const union = await prisma.unions.findUnique({
      where: { union_id: filters.unionId },
      select: { country_id: true },
    });
    if (!union || union.country_id !== countryId) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  if (filters.divisionId !== undefined) {
    const unionInCountry = await prisma.unions.findFirst({
      where: {
        division_id: filters.divisionId,
        country_id: countryId,
        active: true,
      },
      select: { union_id: true },
    });
    if (!unionInCountry) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  if (filters.localFieldId !== undefined) {
    const localField = await prisma.local_fields.findUnique({
      where: { local_field_id: filters.localFieldId },
      select: { unions: { select: { country_id: true } } },
    });
    if (!localField?.unions || localField.unions.country_id !== countryId) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  if (filters.districtId !== undefined) {
    const district = await prisma.districts.findUnique({
      where: { districlub_type_id: filters.districtId },
      select: {
        local_fields: {
          select: { unions: { select: { country_id: true } } },
        },
      },
    });
    if (
      !district?.local_fields?.unions ||
      district.local_fields.unions.country_id !== countryId
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }
}
