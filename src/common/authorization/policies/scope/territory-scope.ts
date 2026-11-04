import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type {
  AuthorizationContextService,
  ResolvedAuthorizationProfile,
} from '../../../services/authorization-context.service';
import type { InstitutionalHierarchyService } from '../../../services/institutional-hierarchy.service';
import { ActorScope } from '../../actor-scope';
import { GlobalRole } from '../../roles';

export type ResolvedTerritoryScope = {
  localFieldId: number;
  unionId?: number | null;
  divisionId?: number | null;
  countryId?: number | null;
};

export type ResolvedUnionCamporeeScope = {
  unionId: number;
  divisionId?: number | null;
  countryId: number | null;
  /**
   * Set when the scope comes from a concrete union camporee. Only then can a
   * participating local field be admitted by validateUnionCamporeeScope.
   */
  unionCamporeeId?: number | null;
};

export type HierarchyScope = {
  division_id: number | null;
  union_id: number | null;
  local_field_id: number | null;
};

export class TerritoryScopeValidator {
  constructor(
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async loadHierarchyScope(input: {
    localFieldId?: number;
    unionId?: number;
  }): Promise<HierarchyScope> {
    try {
      const hierarchy = await this.hierarchy.resolveCurrent(input);
      return {
        division_id: hierarchy.division_id ?? null,
        union_id: hierarchy.union_id ?? null,
        local_field_id: hierarchy.local_field_id ?? null,
      };
    } catch {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }
  }

  assertHierarchyAccess(
    resolved: ResolvedAuthorizationProfile,
    scope: HierarchyScope,
  ): void {
    if (
      !this.authorizationContext.canAccessHierarchyScope(
        resolved,
        scope,
        'current-write',
      )
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }
  }

  /**
   * Owner-level check for a union camporee: only actors whose territory
   * covers the organizing union (or the legacy country fallback). Unlike
   * validateUnionCamporeeScope, participating local-field and club actors are
   * not admitted.
   */
  assertUnionCamporeeOwnerScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedUnionCamporeeScope,
  ): void {
    if (
      this.authorizationContext.canAccessHierarchyScope(
        resolved,
        this.toHierarchyScope(resourceScope),
        'current-write',
      ) ||
      this.canUseLegacyCountryFallback(resolved, resourceScope)
    ) {
      return;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  validateTerritoryScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedTerritoryScope,
  ): boolean {
    if (
      this.authorizationContext.canAccessHierarchyScope(
        resolved,
        this.toHierarchyScope(resourceScope),
        'current-write',
      )
    ) {
      return true;
    }

    if (this.canUseLegacyCountryFallback(resolved, resourceScope)) {
      return true;
    }

    if (
      ActorScope.from(resolved).activeLocalFieldId ===
      resourceScope.localFieldId
    ) {
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  async validateUnionCamporeeScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedUnionCamporeeScope,
  ): Promise<boolean> {
    if (
      this.authorizationContext.canAccessHierarchyScope(
        resolved,
        this.toHierarchyScope(resourceScope),
        'current-write',
      )
    ) {
      return true;
    }

    if (this.canUseLegacyCountryFallback(resolved, resourceScope)) {
      return true;
    }

    // Local-field-level actors (admin, director-lf, assistant-lf) and
    // club-assignment actors are admitted only when their local field
    // participates in this union camporee (active union_camporee_local_fields
    // row). Scopes without a concrete camporee (union venues) never qualify.
    const participantLocalFieldId =
      this.resolveUnionCamporeeParticipantLocalFieldId(resolved);

    if (
      typeof resourceScope.unionCamporeeId === 'number' &&
      typeof participantLocalFieldId === 'number'
    ) {
      const participation =
        await this.prisma.union_camporee_local_fields.findFirst({
          where: {
            union_camporee_lf_id: resourceScope.unionCamporeeId,
            local_field_id: participantLocalFieldId,
            active: true,
          },
          select: { local_field_id: true },
        });

      if (participation) {
        return true;
      }
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  resolveUnionCamporeeParticipantLocalFieldId(
    resolved: ResolvedAuthorizationProfile,
  ): number | undefined {
    const actor = ActorScope.from(resolved);

    if (
      typeof actor.localFieldId === 'number' &&
      actor.hasRole(
        GlobalRole.ADMIN,
        GlobalRole.ASSISTANT_ADMIN,
        GlobalRole.DIRECTOR_LF,
        GlobalRole.ASSISTANT_LF,
      )
    ) {
      return actor.localFieldId;
    }

    return actor.activeLocalFieldId;
  }

  toHierarchyScope(
    scope: ResolvedTerritoryScope | ResolvedUnionCamporeeScope,
  ): HierarchyScope {
    return {
      division_id: scope.divisionId ?? null,
      union_id: scope.unionId ?? null,
      local_field_id: 'localFieldId' in scope ? scope.localFieldId : null,
    };
  }

  canUseLegacyCountryFallback(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: Pick<ResolvedTerritoryScope, 'divisionId' | 'countryId'>,
  ): boolean {
    // Country is geography now, not authority. Keep this fallback only for
    // legacy resource resolvers that cannot provide a division yet.
    if (typeof resourceScope.divisionId === 'number') {
      return false;
    }

    const actor = ActorScope.from(resolved);

    return (
      typeof resourceScope.countryId === 'number' &&
      typeof actor.countryId === 'number' &&
      actor.countryId === resourceScope.countryId &&
      actor.hasRole(GlobalRole.ADMIN)
    );
  }

  hasGlobalRole(
    resolved: ResolvedAuthorizationProfile,
    roleName: string,
  ): boolean {
    return ActorScope.from(resolved).hasRole(roleName);
  }
}

export class CamporeeScopeLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async loadCamporeeScope(camporeeId: number): Promise<ResolvedTerritoryScope> {
    const camporee = await this.prisma.local_camporees.findUnique({
      where: { local_camporee_id: camporeeId },
      select: {
        local_field_id: true,
        local_fields: {
          select: {
            union_id: true,
            unions: {
              select: {
                country_id: true,
              },
            },
          },
        },
      },
    });

    if (!camporee) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_NOT_FOUND);
    }

    const hierarchy = await this.hierarchy.resolveCurrent({
      localFieldId: camporee.local_field_id,
    });

    return {
      localFieldId: camporee.local_field_id,
      unionId: hierarchy.union_id ?? camporee.local_fields?.union_id ?? null,
      divisionId: hierarchy.division_id,
      countryId: camporee.local_fields?.unions?.country_id ?? null,
    };
  }

  async loadUnionCamporeeScope(
    camporeeId: number,
  ): Promise<ResolvedUnionCamporeeScope> {
    const camporee = await this.prisma.union_camporees.findUnique({
      where: { union_camporee_id: camporeeId },
      select: {
        union_id: true,
        unions: { select: { country_id: true } },
      },
    });

    if (!camporee) {
      throw new AppNotFoundException(
        ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
      );
    }

    const hierarchy = await this.hierarchy.resolveCurrent({
      unionId: camporee.union_id,
    });

    return {
      unionId: camporee.union_id,
      divisionId: hierarchy.division_id,
      countryId: camporee.unions?.country_id ?? null,
      unionCamporeeId: camporeeId,
    };
  }
}
