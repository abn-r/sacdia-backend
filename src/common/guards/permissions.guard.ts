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
  countryId?: number | null;
};

type ResolvedUnionCamporeeScope = {
  unionId: number;
  countryId: number | null;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
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
      const className = context.getClass().name;
      const handlerName = context.getHandler().name;
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
    const globalRoleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    if (globalRoleNames.has('super-admin')) {
      return true;
    }

    const globalScope = resolved.authorization.effective.scope.global;
    const globalLocalFieldId = globalScope.local_field?.id;
    const globalUnionId = globalScope.union?.id;
    const globalCountryId = globalScope.country?.id;

    if (
      typeof globalLocalFieldId === 'number' &&
      globalLocalFieldId === resourceScope.localFieldId &&
      (globalRoleNames.has('admin') ||
        globalRoleNames.has('assistant-admin') ||
        globalRoleNames.has('coordinator'))
    ) {
      return true;
    }

    if (
      typeof resourceScope.unionId === 'number' &&
      typeof globalUnionId === 'number' &&
      globalUnionId === resourceScope.unionId &&
      (globalRoleNames.has('admin') || globalRoleNames.has('assistant-admin'))
    ) {
      return true;
    }

    if (
      typeof resourceScope.countryId === 'number' &&
      typeof globalCountryId === 'number' &&
      globalCountryId === resourceScope.countryId &&
      globalRoleNames.has('admin')
    ) {
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

    return {
      localFieldId: camporee.local_field_id,
      unionId: camporee.local_fields?.union_id ?? null,
      countryId: camporee.local_fields?.unions?.country_id ?? null,
    };
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

    return {
      unionId: camporee.union_id,
      countryId: camporee.unions?.country_id ?? null,
    };
  }

  private validateUnionCamporeeScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedUnionCamporeeScope,
  ): boolean {
    const globalRoleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    if (globalRoleNames.has('super-admin')) {
      return true;
    }

    const globalScope = resolved.authorization.effective.scope.global;
    const globalUnionId = globalScope.union?.id;
    const globalCountryId = globalScope.country?.id;

    if (
      typeof globalUnionId === 'number' &&
      globalUnionId === resourceScope.unionId &&
      (globalRoleNames.has('admin') || globalRoleNames.has('assistant-admin'))
    ) {
      return true;
    }

    if (
      typeof resourceScope.countryId === 'number' &&
      typeof globalCountryId === 'number' &&
      globalCountryId === resourceScope.countryId &&
      globalRoleNames.has('admin')
    ) {
      return true;
    }

    // Local-field-level actors (admin, coordinator, director-lf, assistant-lf)
    // and club-assignment actors with a local field are permitted through —
    // the service layer enforces that the local field participates in this
    // union camporee via union_camporee_local_fields.
    const globalLocalFieldId = globalScope.local_field?.id;

    if (
      typeof globalLocalFieldId === 'number' &&
      (globalRoleNames.has('admin') ||
        globalRoleNames.has('assistant-admin') ||
        globalRoleNames.has('coordinator') ||
        globalRoleNames.has('director-lf') ||
        globalRoleNames.has('assistant-lf'))
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
