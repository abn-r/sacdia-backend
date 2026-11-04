import { AppForbiddenException } from '../../../errors/app.exception';
import { ErrorCode } from '../../../errors/error-codes';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { TemporalContextFactory } from '../../../clock/temporal-context.factory';
import type { AuthorizationResourceMetadata } from '../../../decorators/authorization-resource.decorator';
import type { PermissionRequirement } from '../../../decorators/permissions.decorator';
import type {
  AuthorizationContextService,
  ResolvedAuthorizationProfile,
} from '../../../services/authorization-context.service';
import type { ClubAssignmentEffectivityPolicy } from '../../club-assignment-effectivity.policy';
import { toTemporalLocalField } from '../../club-assignment-temporal';
import {
  coordinatorRolePermissions,
  coordinatorScopeIncludesSection,
} from '../../coordinator-section-scope';
import { hasRequiredPermissions } from '../../permission-requirements';

export type AuthorizationSectionType =
  'adventurers' | 'pathfinders' | 'master_guilds';

export type ResolvedInstanceScope = {
  mainClubId: number;
  instanceType: AuthorizationSectionType;
  instanceId: number;
};

/**
 * What a `coordinatorSections` route hands to validateInstanceScope.
 * `clubAuthority`: the requirement is met WITHOUT the coordinator roles'
 * permissions (active club role, direct grants, other global roles). When it
 * is false, the permission came from a coordinator role, and a coordinator's
 * authority is their assignments only: the club branches cannot open the
 * section, the coordinator path decides.
 */
export type CoordinatorSectionsCheck = {
  requirement: PermissionRequirement;
  clubAuthority: boolean;
};

export type ResolvedJointActivityScope = {
  mainClubId: number;
  participatingSectionIds: number[];
};

export function buildInstanceScopeFromSection(
  section: {
    club_section_id: number;
    main_club_id: number | null;
    club_type_id: number;
  } | null,
): ResolvedInstanceScope {
  if (!section || !section.main_club_id) {
    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  // Map club_type_id to instance type name for backward compatibility
  const instanceType = clubTypeIdToInstanceType(section.club_type_id);

  return {
    mainClubId: section.main_club_id,
    instanceType,
    instanceId: section.club_section_id,
  };
}

export function clubTypeIdToInstanceType(
  clubTypeId: number,
): AuthorizationSectionType {
  // These mappings follow the club_types catalog convention
  switch (clubTypeId) {
    case 1:
      return 'adventurers';
    case 2:
      return 'pathfinders';
    case 3:
      return 'master_guilds';
    default:
      return 'pathfinders'; // safe fallback
  }
}

export class AssignmentEffectivity {
  constructor(
    private readonly assignmentEffectivity: ClubAssignmentEffectivityPolicy,
    private readonly temporalContexts: TemporalContextFactory,
  ) {}

  /**
   * Vigencia temporal del assignment evaluada con la fecha de negocio de SU
   * Campo Local; toda decision pasa por `ClubAssignmentEffectivityPolicy`.
   */
  isAssignmentEffective(assignment: {
    active: boolean;
    status: string | null;
    start_date: Date;
    end_date: Date | null;
    expires_at: Date | null;
    club_sections?: {
      clubs?: {
        local_fields?: {
          local_field_id: number;
          timezone: string | null;
        } | null;
      } | null;
    } | null;
  }): boolean {
    return this.assignmentEffectivity.isEffective(
      assignment,
      this.temporalContexts.forLocalField(
        toTemporalLocalField(assignment.club_sections?.clubs?.local_fields),
      ),
    );
  }
}

export class InstanceScopeValidator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  /**
   * Only for routes that opted in with `coordinatorSections` (see
   * AuthorizationResourceMetadata); undefined everywhere else, so every other
   * route keeps the generic rule.
   */
  coordinatorSectionsCheck(
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
  ): CoordinatorSectionsCheck | undefined {
    if (!resource.coordinatorSections) {
      return undefined;
    }
    return {
      requirement,
      clubAuthority: hasRequiredPermissions(
        resolved,
        requirement,
        resource,
        undefined,
        { excludeCoordinatorRoles: true },
      ),
    };
  }

  /**
   * `coordinator` is set only when the route opted in with
   * `coordinatorSections`. There, the club branches (territory via
   * canManageClub, the active club section) count only when the requirement
   * is met WITHOUT the coordinator roles' permissions: a coordinator's
   * permission is coordinator authority, and only their assignments open a
   * section (a coordinator who is a plain member of the section, or whose
   * territory comes from another role lacking the permission, is not let in
   * by it). A coordinator who is also a director/secretary of the section
   * keeps those club powers: their club role satisfies the requirement alone.
   *
   * When the request gets in ONLY through the coordinator path,
   * `request.coordinatorSectionGrant` is set to true: the caller has
   * coordinator authority over the section, not club authority, so a
   * permission that came from somewhere else (a club role in ANOTHER club
   * that happens to be the active one) must not widen what they see here.
   */
  async validateInstanceScope(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedInstanceScope,
    coordinator?: CoordinatorSectionsCheck,
    request?: Record<string, unknown>,
  ): Promise<boolean> {
    if (coordinator?.clubAuthority ?? true) {
      if (
        await this.authorizationContext.canManageClub(
          userId,
          resourceScope.mainClubId,
          resolved,
        )
      ) {
        return true;
      }

      const activeClubScope = resolved.authorization.effective.scope.club;

      if (
        activeClubScope &&
        activeClubScope.club.club_id === resourceScope.mainClubId &&
        activeClubScope.section.club_section_id === resourceScope.instanceId
      ) {
        return true;
      }
    }

    if (
      coordinator &&
      (await this.coordinatorCoversSection(
        userId,
        resolved,
        coordinator.requirement,
        resourceScope.instanceId,
      ))
    ) {
      if (request) {
        request.coordinatorSectionGrant = true;
      }
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  /**
   * A coordinator ROLE carries the requirement by itself (direct grants and
   * club assignments do not count: they say nothing about coordinator
   * territory) and the canonical coordinator scope covers the section.
   */
  async coordinatorCoversSection(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    clubSectionId: number,
  ): Promise<boolean> {
    const coordinatorPermissions = coordinatorRolePermissions(
      resolved.authorization.grants.global_roles,
    );
    const satisfied =
      requirement.mode === 'any'
        ? requirement.permissions.some((p) => coordinatorPermissions.has(p))
        : requirement.permissions.every((p) => coordinatorPermissions.has(p));
    if (!satisfied) {
      return false;
    }

    return coordinatorScopeIncludesSection(this.prisma, userId, clubSectionId);
  }

  async validateAnyInstanceScope(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    resourceScopes: ResolvedInstanceScope[],
  ): Promise<boolean> {
    if (resourceScopes.length === 0) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    for (const resourceScope of resourceScopes) {
      if (
        await this.authorizationContext.canManageClub(
          userId,
          resourceScope.mainClubId,
          resolved,
        )
      ) {
        return true;
      }
    }

    const activeClubScope = resolved.authorization.effective.scope.club;

    if (
      activeClubScope &&
      resourceScopes.some(
        (resourceScope) =>
          activeClubScope.club.club_id === resourceScope.mainClubId &&
          activeClubScope.section.club_section_id === resourceScope.instanceId,
      )
    ) {
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  /**
   * Authorization check for joint activities.
   * The user is authorized if they have a club-level admin override OR
   * if their active section assignment is ANY of the participating sections.
   * This enables directors of any participating section to manage the joint activity.
   */
  async validateJointActivityScope(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedJointActivityScope,
  ): Promise<boolean> {
    if (
      await this.authorizationContext.canManageClub(
        userId,
        resourceScope.mainClubId,
        resolved,
      )
    ) {
      return true;
    }

    const activeClubScope = resolved.authorization.effective.scope.club;

    if (
      !activeClubScope ||
      activeClubScope.club.club_id !== resourceScope.mainClubId
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const activeSectionId = activeClubScope.section.club_section_id;

    if (!resourceScope.participatingSectionIds.includes(activeSectionId)) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    return true;
  }
}
