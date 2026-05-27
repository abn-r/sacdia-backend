import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../decorators/authorization-resource.decorator';
import {
  PERMISSIONS_KEY,
  type PermissionRequirement,
} from '../decorators/permissions.decorator';
import {
  SENSITIVE_USER_SUBRESOURCE_KEY,
  type SensitiveUserSubresourceMetadata,
} from '../decorators/sensitive-user-subresource.decorator';
import { getSensitiveUserSubresourceFallbackPermission } from './sensitive-user-subresource-policy';

type AuthorizationSectionType = 'adventurers' | 'pathfinders' | 'master_guilds';

type ResolvedInstanceScope = {
  mainClubId: number;
  instanceType: AuthorizationSectionType;
  instanceId: number;
};

type ResolvedJointActivityScope = {
  mainClubId: number;
  participatingSectionIds: number[];
};

type ResolvedTerritoryScope = {
  localFieldId: number;
  unionId?: number | null;
  divisionId?: number | null;
  countryId?: number | null;
};

type ResolvedUnionCamporeeScope = {
  unionId: number;
  divisionId?: number | null;
  countryId: number | null;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement || requirement.permissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;

    if (!userId) {
      throw new AppForbiddenException(ErrorCode.GUARD_USER_NOT_AUTHENTICATED);
    }

    const resource =
      this.reflector.getAllAndOverride<AuthorizationResourceMetadata>(
        AUTHORIZATION_RESOURCE_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (!resource) {
      throw new AppInternalServerErrorException(
        ErrorCode.GUARD_RBAC_MISCONFIGURATION,
      );
    }
    const sensitiveUserSubresource =
      this.reflector.getAllAndOverride<SensitiveUserSubresourceMetadata>(
        SENSITIVE_USER_SUBRESOURCE_KEY,
        [context.getHandler(), context.getClass()],
      );

    if (
      resource.type === 'user' &&
      this.isResourceOwner(request, userId, resource)
    ) {
      return true;
    }

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    request.authorization = resolved.authorization;

    if (
      !this.hasRequiredPermissions(
        resolved,
        requirement,
        resource,
        sensitiveUserSubresource,
      )
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    switch (resource.type) {
      case 'global':
      case 'user':
      case 'active_assignment':
        return true;
      case 'club':
        return this.validateClubScope(userId, request, resolved, resource);
      case 'club_section':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveClubSectionScope(request, resource),
        );
      case 'camporee':
        return this.validateTerritoryScope(
          resolved,
          await this.resolveCamporeeScope(request, resource),
        );
      case 'union_camporee':
        return this.validateUnionCamporeeScope(
          resolved,
          await this.resolveUnionCamporeeScope(request, resource),
        );
      case 'camporee_event': {
        const eventScope = await this.resolveCamporeeEventScope(
          request,
          resource,
        );
        if (eventScope.type === 'local') {
          return this.validateTerritoryScope(resolved, eventScope.scope);
        } else {
          return this.validateUnionCamporeeScope(resolved, eventScope.scope);
        }
      }
      case 'camporee_venue': {
        const venueScope = await this.resolveCamporeeVenueScope(
          request,
          resource,
        );
        if (venueScope.type === 'local_field') {
          return this.validateTerritoryScope(resolved, venueScope.scope);
        } else {
          return this.validateUnionCamporeeScope(resolved, venueScope.scope);
        }
      }
      case 'activity': {
        const activityScopeResult = await this.resolveActivityScope(
          request,
          resource,
        );
        if ('participatingSectionIds' in activityScopeResult) {
          return this.validateJointActivityScope(
            userId,
            resolved,
            activityScopeResult,
          );
        }
        return this.validateInstanceScope(
          userId,
          resolved,
          activityScopeResult,
        );
      }
      case 'finance':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveFinanceScope(request, resource),
        );
      case 'inventory_instance':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveInventoryInstanceScope(request, resource),
        );
      case 'inventory_item':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveInventoryItemScope(request, resource),
        );
      case 'club_assignment':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveClubAssignmentScope(request, resource),
        );
      case 'investiture_enrollment':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveInvestitureEnrollmentScope(request, resource),
        );
      case 'monthly_report':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveMonthlyReportScope(request, resource),
        );
      case 'insurance_member':
        return this.validateAnyInstanceScope(
          userId,
          resolved,
          await this.resolveInsuranceMemberScopes(request, resource),
        );
      case 'insurance_record':
        return this.validateAnyInstanceScope(
          userId,
          resolved,
          await this.resolveInsuranceRecordScopes(request, resource),
        );
      default:
        return true;
    }
  }

  private hasRequiredPermissions(
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
  ): boolean {
    const globalPermissions = this.getGlobalPermissions(resolved);

    if (resource.type === 'user' && sensitiveUserSubresource) {
      return this.hasSensitiveUserSubresourcePermissions(
        globalPermissions,
        requirement,
        sensitiveUserSubresource,
      );
    }

    const activeClubPermissions = this.getActiveClubPermissions(resolved);
    const candidatePermissions =
      resource.type === 'global' || resource.type === 'user'
        ? globalPermissions
        : new Set([...globalPermissions, ...activeClubPermissions]);

    if (requirement.mode === 'any') {
      return requirement.permissions.some((permission) =>
        candidatePermissions.has(permission),
      );
    }

    return requirement.permissions.every((permission) =>
      candidatePermissions.has(permission),
    );
  }

  private hasSensitiveUserSubresourcePermissions(
    globalPermissions: Set<string>,
    requirement: PermissionRequirement,
    sensitiveUserSubresource: SensitiveUserSubresourceMetadata,
  ): boolean {
    const matchesPermission = (permission: string): boolean => {
      const legacyFallbackPermission =
        getSensitiveUserSubresourceFallbackPermission(
          sensitiveUserSubresource.family,
          sensitiveUserSubresource.mode,
        );

      return (
        globalPermissions.has(permission) ||
        globalPermissions.has(legacyFallbackPermission)
      );
    };

    if (requirement.mode === 'any') {
      return requirement.permissions.some(matchesPermission);
    }

    return requirement.permissions.every(matchesPermission);
  }

  private getGlobalPermissions(
    resolved: ResolvedAuthorizationProfile,
  ): Set<string> {
    return new Set(
      resolved.authorization.grants.global_roles.flatMap(
        (grant) => grant.permissions,
      ),
    );
  }

  private getActiveClubPermissions(
    resolved: ResolvedAuthorizationProfile,
  ): Set<string> {
    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;

    if (!activeAssignmentId) {
      return new Set<string>();
    }

    const activeGrant = resolved.authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );

    return new Set(activeGrant?.permissions ?? []);
  }

  private async validateClubScope(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
  ): Promise<boolean> {
    const clubId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.clubIdParam ?? 'clubId'),
      'Club ID not found in request',
    );

    if (await this.authorizationContext.canManageClub(userId, clubId)) {
      return true;
    }

    const activeClubScope = resolved.authorization.effective.scope.club;

    if (!activeClubScope || activeClubScope.club.club_id !== clubId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    return true;
  }

  private async validateInstanceScope(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedInstanceScope,
  ): Promise<boolean> {
    if (
      await this.authorizationContext.canManageClub(
        userId,
        resourceScope.mainClubId,
      )
    ) {
      return true;
    }

    const activeClubScope = resolved.authorization.effective.scope.club;

    if (
      !activeClubScope ||
      activeClubScope.club.club_id !== resourceScope.mainClubId ||
      activeClubScope.section.club_section_id !== resourceScope.instanceId
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    return true;
  }

  private async validateAnyInstanceScope(
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
  private async validateJointActivityScope(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedJointActivityScope,
  ): Promise<boolean> {
    if (
      await this.authorizationContext.canManageClub(
        userId,
        resourceScope.mainClubId,
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

  private validateTerritoryScope(
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

    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;
    const activeGrant = resolved.authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );
    const activeGrantLocalFieldId = activeGrant?.scope.local_field?.id;

    if (
      typeof activeGrantLocalFieldId === 'number' &&
      activeGrantLocalFieldId === resourceScope.localFieldId
    ) {
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  private isResourceOwner(
    request: any,
    userId: string,
    resource: AuthorizationResourceMetadata,
  ): boolean {
    const ownerParam = resource.ownerParam ?? 'userId';
    return request.params?.[ownerParam] === userId;
  }

  private async resolveActivityScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope | ResolvedJointActivityScope> {
    const activityId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'activityId'),
      'Activity ID not found in request',
    );

    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
      select: {
        is_joint: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
        activity_instances: {
          where: { active: true },
          select: {
            club_section_id: true,
            club_sections: {
              select: {
                club_section_id: true,
                main_club_id: true,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_NOT_FOUND);
    }

    // For joint activities, resolve authorization using all participating sections
    if (activity.is_joint) {
      const mainClubId = activity.club_sections?.main_club_id;

      if (!mainClubId) {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const participatingSectionIds = activity.activity_instances
        .map((instance) => instance.club_section_id)
        .filter((id): id is number => id !== null);

      return {
        mainClubId,
        participatingSectionIds,
      };
    }

    return this.buildInstanceScopeFromSection(activity.club_sections);
  }

  private async resolveCamporeeScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedTerritoryScope> {
    const camporeeId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'camporeeId'),
      'Camporee ID not found in request',
    );

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

  private async resolveCamporeeEventScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<
    | { type: 'local'; scope: ResolvedTerritoryScope }
    | { type: 'union'; scope: ResolvedUnionCamporeeScope }
  > {
    const eventId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'eventId'),
      'Event ID not found in request',
    );

    const event = await this.prisma.camporee_events.findUnique({
      where: { camporee_event_id: eventId },
      select: {
        local_camporee_id: true,
        union_camporee_id: true,
      },
    });

    if (!event) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_EVENT_NOT_FOUND);
    }

    if (event.local_camporee_id) {
      const camporee = await this.prisma.local_camporees.findUnique({
        where: { local_camporee_id: event.local_camporee_id },
        select: {
          local_field_id: true,
          local_fields: {
            select: {
              union_id: true,
              unions: { select: { country_id: true } },
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
        type: 'local',
        scope: {
          localFieldId: camporee.local_field_id,
          unionId:
            hierarchy.union_id ?? camporee.local_fields?.union_id ?? null,
          divisionId: hierarchy.division_id,
          countryId: camporee.local_fields?.unions?.country_id ?? null,
        },
      };
    } else {
      const camporee = await this.prisma.union_camporees.findUnique({
        where: { union_camporee_id: event.union_camporee_id! },
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
        type: 'union',
        scope: {
          unionId: camporee.union_id,
          divisionId: hierarchy.division_id,
          countryId: camporee.unions?.country_id ?? null,
        },
      };
    }
  }

  /**
   * Resolves territory/union scope for a camporee venue.
   *
   * - PATCH/DELETE /camporee-venues/:venueId → looks up the venue row by id
   *   and returns its `union_id` (union scope) xor `local_field_id`
   *   (local_field scope).
   * - POST /camporee-venues (generic create) → no `idParam` and no row exists
   *   yet, so the scope is read from the request body (`scope` +
   *   `union_id` | `local_field_id`).
   *
   * Note: the camporee-scoped POST endpoints (POST
   * /local-camporees/:id/venues and POST /union-camporees/:id/venues) are
   * still authorized via `camporee` / `union_camporee` resource types —
   * those derive the scope from the parent camporee row.
   */
  private async resolveCamporeeVenueScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<
    | { type: 'local_field'; scope: ResolvedTerritoryScope }
    | { type: 'union'; scope: ResolvedUnionCamporeeScope }
  > {
    // Case 1: mutation by id (PATCH/DELETE).
    const rawId = this.getRequestValue(
      request,
      'param',
      resource.idParam ?? 'venueId',
    );

    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const venueId = this.getRequiredNumericValue(
        rawId,
        'Venue ID not found in request',
      );

      const venue = await this.prisma.camporee_venues.findUnique({
        where: { camporee_venue_id: venueId },
        select: {
          scope: true,
          union_id: true,
          local_field_id: true,
        },
      });

      if (!venue) {
        throw new AppNotFoundException(ErrorCode.CAMPOREE_VENUE_NOT_FOUND);
      }

      return this.buildCamporeeVenueScopeFromRow(venue);
    }

    // Case 2: create via generic POST — read from body.
    const body = request.body ?? {};
    return this.buildCamporeeVenueScopeFromRow({
      scope: body.scope,
      union_id: body.union_id ?? null,
      local_field_id: body.local_field_id ?? null,
    });
  }

  private async buildCamporeeVenueScopeFromRow(venue: {
    scope: string | null | undefined;
    union_id: number | null | undefined;
    local_field_id: number | null | undefined;
  }): Promise<
    | { type: 'local_field'; scope: ResolvedTerritoryScope }
    | { type: 'union'; scope: ResolvedUnionCamporeeScope }
  > {
    if (venue.scope === 'union') {
      if (typeof venue.union_id !== 'number') {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const union = await this.prisma.unions.findUnique({
        where: { union_id: venue.union_id },
        select: { country_id: true },
      });

      const hierarchy = await this.hierarchy.resolveCurrent({
        unionId: venue.union_id,
      });

      return {
        type: 'union',
        scope: {
          unionId: venue.union_id,
          divisionId: hierarchy.division_id,
          countryId: union?.country_id ?? null,
        },
      };
    }

    if (venue.scope === 'local_field') {
      if (typeof venue.local_field_id !== 'number') {
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: venue.local_field_id },
        select: {
          union_id: true,
          unions: { select: { country_id: true } },
        },
      });

      const hierarchy = await this.hierarchy.resolveCurrent({
        localFieldId: venue.local_field_id,
      });

      return {
        type: 'local_field',
        scope: {
          localFieldId: venue.local_field_id,
          unionId: hierarchy.union_id ?? localField?.union_id ?? null,
          divisionId: hierarchy.division_id,
          countryId: localField?.unions?.country_id ?? null,
        },
      };
    }

    // Unknown / missing scope on the row or in the body → reject.
    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  private async resolveUnionCamporeeScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedUnionCamporeeScope> {
    const camporeeId = this.getRequiredNumericValue(
      this.getRequestValue(
        request,
        'param',
        resource.idParam ?? 'unionCamporeeId',
      ),
      'Union camporee ID not found in request',
    );

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
    };
  }

  private validateUnionCamporeeScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedUnionCamporeeScope,
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

    // Local-field-level actors (admin, coordinator, director-lf, assistant-lf)
    // and club-assignment actors with a local field are permitted through —
    // the service layer enforces that the local field participates in this
    // union camporee via union_camporee_local_fields.
    const globalScope = resolved.authorization.effective.scope.global;
    const globalLocalFieldId = globalScope.local_field?.id;

    if (
      typeof globalLocalFieldId === 'number' &&
      (this.hasGlobalRole(resolved, 'admin') ||
        this.hasGlobalRole(resolved, 'assistant-admin') ||
        this.hasGlobalRole(resolved, 'coordinator') ||
        this.hasGlobalRole(resolved, 'director-lf') ||
        this.hasGlobalRole(resolved, 'assistant-lf'))
    ) {
      return true;
    }

    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;
    const activeGrant = resolved.authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );
    const activeGrantLocalFieldId = activeGrant?.scope.local_field?.id;

    if (typeof activeGrantLocalFieldId === 'number') {
      return true;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  private toHierarchyScope(
    scope: ResolvedTerritoryScope | ResolvedUnionCamporeeScope,
  ): {
    division_id: number | null;
    union_id: number | null;
    local_field_id: number | null;
  } {
    return {
      division_id: scope.divisionId ?? null,
      union_id: scope.unionId ?? null,
      local_field_id: 'localFieldId' in scope ? scope.localFieldId : null,
    };
  }

  private canUseLegacyCountryFallback(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: Pick<ResolvedTerritoryScope, 'divisionId' | 'countryId'>,
  ): boolean {
    // Country is geography now, not authority. Keep this fallback only for
    // legacy resource resolvers that cannot provide a division yet.
    if (typeof resourceScope.divisionId === 'number') {
      return false;
    }

    const globalCountryId =
      resolved.authorization.effective.scope.global.country?.id;

    return (
      typeof resourceScope.countryId === 'number' &&
      typeof globalCountryId === 'number' &&
      globalCountryId === resourceScope.countryId &&
      this.hasGlobalRole(resolved, 'admin')
    );
  }

  private hasGlobalRole(
    resolved: ResolvedAuthorizationProfile,
    roleName: string,
  ): boolean {
    return resolved.authorization.grants.global_roles.some(
      (grant) => grant.role_name.toLowerCase() === roleName,
    );
  }

  private async resolveFinanceScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const financeId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'financeId'),
      'Finance ID not found in request',
    );

    const finance = await this.prisma.finances.findUnique({
      where: { finance_id: financeId },
      select: {
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!finance) {
      throw new AppNotFoundException(ErrorCode.FINANCE_TRANSACTION_NOT_FOUND);
    }

    return this.buildInstanceScopeFromSection(finance.club_sections);
  }

  private async resolveClubSectionScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const sectionId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'sectionId'),
      'Club section ID not found in request',
    );
    const expectedClubId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.clubIdParam ?? 'clubId'),
      'Club ID not found in request',
    );

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (!section || section.main_club_id !== expectedClubId) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    return this.buildInstanceScopeFromSection(section);
  }

  private async resolveInventoryInstanceScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const sectionId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'clubId'),
      'Club section ID not found in request',
    );

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    return this.buildInstanceScopeFromSection(section);
  }

  private async resolveInventoryItemScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const inventoryId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'id'),
      'Inventory item ID not found in request',
    );

    const inventoryItem = await this.prisma.club_inventory.findUnique({
      where: { club_inventory_id: inventoryId },
      select: {
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!inventoryItem) {
      throw new AppNotFoundException(ErrorCode.INVENTORY_NOT_FOUND);
    }

    return this.buildInstanceScopeFromSection(inventoryItem.club_sections);
  }

  private async resolveClubAssignmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const assignmentId = String(
      this.getRequestValue(
        request,
        'param',
        resource.idParam ?? 'assignmentId',
      ),
    );

    if (!assignmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const assignment = await this.prisma.club_role_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new AppNotFoundException(ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND);
    }

    return this.buildInstanceScopeFromSection(assignment.club_sections);
  }

  private async resolveInvestitureEnrollmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const enrollmentId = this.getRequiredNumericValue(
      this.getRequestValue(
        request,
        'param',
        resource.idParam ?? 'enrollmentId',
      ),
      'Investiture enrollment ID not found in request',
    );

    const enrollment = await this.prisma.enrollments.findFirst({
      where: { enrollment_id: enrollmentId, active: true },
      select: {
        user_id: true,
        ecclesiastical_year_id: true,
        classes: { select: { club_type_id: true } },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      );
    }

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        active: true,
        status: 'active',
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
        club_sections: {
          club_type_id: enrollment.classes.club_type_id,
        },
      },
      select: {
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    return this.buildInstanceScopeFromSection(
      assignment?.club_sections ?? null,
    );
  }

  private async resolveMonthlyReportScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const reportId = this.getRequestValue(request, 'param', 'reportId');

    if (reportId) {
      const report = await this.prisma.monthly_reports.findUnique({
        where: { monthly_report_id: String(reportId) },
        select: {
          club_enrollment: {
            select: {
              club_section: {
                select: {
                  club_section_id: true,
                  main_club_id: true,
                  club_type_id: true,
                },
              },
            },
          },
        },
      });

      if (!report) {
        throw new AppNotFoundException(ErrorCode.MONTHLY_REPORT_NOT_FOUND);
      }

      return this.buildInstanceScopeFromSection(
        report.club_enrollment.club_section,
      );
    }

    const enrollmentId = String(
      this.getRequestValue(
        request,
        'param',
        resource.idParam ?? 'enrollmentId',
      ) ?? '',
    );

    if (!enrollmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: {
        club_section: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    if (!enrollment) {
      throw new AppNotFoundException(
        ErrorCode.MONTHLY_REPORT_ENROLLMENT_NOT_FOUND,
      );
    }

    return this.buildInstanceScopeFromSection(enrollment.club_section);
  }

  private async resolveInsuranceMemberScopes(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope[]> {
    const memberId = String(
      this.getRequestValue(request, 'param', resource.idParam ?? 'memberId') ??
        '',
    );

    if (!memberId) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    const member = await this.prisma.users.findUnique({
      where: { user_id: memberId },
      select: { user_id: true },
    });

    if (!member) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_MEMBER_NOT_FOUND);
    }

    return this.resolveMemberAssignmentScopes(memberId);
  }

  private async resolveInsuranceRecordScopes(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope[]> {
    const insuranceId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'insuranceId'),
      'Insurance ID not found in request',
    );

    const insurance = await this.prisma.member_insurances.findUnique({
      where: { insurance_id: insuranceId },
      select: { user_id: true },
    });

    if (!insurance) {
      throw new AppNotFoundException(ErrorCode.INSURANCE_NOT_FOUND);
    }

    return this.resolveMemberAssignmentScopes(insurance.user_id);
  }

  private async resolveMemberAssignmentScopes(
    memberId: string,
  ): Promise<ResolvedInstanceScope[]> {
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: memberId,
        active: true,
        status: 'active',
      },
      select: {
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
      },
    });

    return assignments
      .map((assignment) => assignment.club_sections)
      .filter(
        (
          section,
        ): section is {
          club_section_id: number;
          main_club_id: number;
          club_type_id: number;
        } => Boolean(section?.main_club_id),
      )
      .map((section) => this.buildInstanceScopeFromSection(section));
  }

  private buildInstanceScopeFromSection(
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
    const instanceType = this.clubTypeIdToInstanceType(section.club_type_id);

    return {
      mainClubId: section.main_club_id,
      instanceType,
      instanceId: section.club_section_id,
    };
  }

  private clubTypeIdToInstanceType(
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

  private getRequestValue(
    request: any,
    source: 'param' | 'query' | 'body',
    field: string,
  ): unknown {
    switch (source) {
      case 'query':
        return request.query?.[field];
      case 'body':
        return request.body?.[field];
      case 'param':
      default:
        return request.params?.[field];
    }
  }

  private getRequiredNumericValue(
    value: unknown,
    _errorMessage: string,
  ): number {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isFinite(parsed)) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    return parsed;
  }

  private requireMainClubId(
    value: number | null | undefined,
    _errorMessage: string,
  ): number {
    if (!Number.isFinite(value)) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }

    return value as number;
  }
}
