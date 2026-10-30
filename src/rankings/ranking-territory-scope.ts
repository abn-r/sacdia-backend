import type { Prisma } from '@prisma/client';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

/**
 * Territory tiers above the local field for ranking reads.
 *
 * `read_division` and `read_union` sit between `read_global` (admin only, no
 * restriction) and `read_lf`. The caller's division or union comes from the
 * global role scope; without one the caller sees nothing.
 */
export type RankingTerritory =
  | { level: 'division'; id: number | null }
  | { level: 'union'; id: number | null };

/** Club fields a row check needs: local field → union → division. */
export type RankingClubTerritory = {
  local_field_id: number | null;
  local_fields?: {
    union_id: number;
    unions?: { division_id: number } | null;
  } | null;
} | null;

export const RANKING_CLUB_TERRITORY_SELECT = {
  club_id: true,
  local_field_id: true,
  local_fields: {
    select: { union_id: true, unions: { select: { division_id: true } } },
  },
} as const;

export function resolveRankingTerritory(
  profile: ResolvedAuthorizationProfile,
  permissions: { division: string; union: string },
): RankingTerritory | null {
  const perms = profile.authorization.effective.permissions;
  const scope = profile.authorization.effective.scope.global;

  if (perms.includes(permissions.division)) {
    return { level: 'division', id: numberOrNull(scope.division?.id) };
  }
  if (perms.includes(permissions.union)) {
    return { level: 'union', id: numberOrNull(scope.union?.id) };
  }
  return null;
}

/** WHERE on the related club. Null when the caller has no territory id. */
export function rankingTerritoryClubWhere(
  territory: RankingTerritory,
): Prisma.clubsWhereInput | null {
  if (territory.id === null) return null;
  return territory.level === 'division'
    ? { local_fields: { unions: { division_id: territory.id } } }
    : { local_fields: { union_id: territory.id } };
}

export function clubInRankingTerritory(
  territory: RankingTerritory,
  club: RankingClubTerritory,
): boolean {
  if (territory.id === null || !club?.local_fields) return false;
  return territory.level === 'division'
    ? club.local_fields.unions?.division_id === territory.id
    : club.local_fields.union_id === territory.id;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
