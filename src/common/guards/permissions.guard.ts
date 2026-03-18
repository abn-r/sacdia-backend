import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

type ResolvedTerritoryScope = {
  localFieldId: number;
  unionId?: number | null;
  countryId?: number | null;
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
      throw new ForbiddenException('User not authenticated');
    }

    const resource =
      this.reflector.getAllAndOverride<AuthorizationResourceMetadata>(
        AUTHORIZATION_RESOURCE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? { type: 'global' };
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
      throw new ForbiddenException(
        this.buildPermissionsErrorMessage(requirement, resource),
      );
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
          'You need an active assignment or global scope for this camporee',
        );
      case 'activity':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveActivityScope(request, resource),
        );
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

  private buildPermissionsErrorMessage(
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
  ): string {
    if (resource.type === 'global' || resource.type === 'user') {
      return `Missing required global permissions: ${requirement.permissions.join(', ')}`;
    }

    return `Missing required permissions: ${requirement.permissions.join(', ')}`;
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
      throw new ForbiddenException(
        'You need an active club assignment for this club',
      );
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
      throw new ForbiddenException(
        'You need an active club assignment for this exact instance',
      );
    }

    return true;
  }

  private validateTerritoryScope(
    resolved: ResolvedAuthorizationProfile,
    resourceScope: ResolvedTerritoryScope,
    errorMessage: string,
  ): boolean {
    const globalRoleNames = new Set(
      resolved.authorization.grants.global_roles.map((grant) =>
        grant.role_name.toLowerCase(),
      ),
    );

    if (globalRoleNames.has('super_admin')) {
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
        globalRoleNames.has('assistant_admin') ||
        globalRoleNames.has('coordinator'))
    ) {
      return true;
    }

    if (
      typeof resourceScope.unionId === 'number' &&
      typeof globalUnionId === 'number' &&
      globalUnionId === resourceScope.unionId &&
      (globalRoleNames.has('admin') || globalRoleNames.has('assistant_admin'))
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

    throw new ForbiddenException(errorMessage);
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
  ): Promise<ResolvedInstanceScope> {
    const activityId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'activityId'),
      'Activity ID not found in request',
    );

    const activity = await this.prisma.activities.findUnique({
      where: { activity_id: activityId },
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

    if (!activity) {
      throw new NotFoundException('Activity not found');
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
      throw new NotFoundException('Camporee not found');
    }

    return {
      localFieldId: camporee.local_field_id,
      unionId: camporee.local_fields?.union_id ?? null,
      countryId: camporee.local_fields?.unions?.country_id ?? null,
    };
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
      throw new NotFoundException('Finance record not found');
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
      throw new NotFoundException('Club section not found');
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
      throw new NotFoundException('Inventory item not found');
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
      throw new ForbiddenException('Assignment ID not found in request');
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
      throw new NotFoundException('Club assignment not found');
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
      throw new ForbiddenException(
        'Unable to resolve the club instance for this resource',
      );
    }

    // Map club_type_id to instance type name for backward compatibility
    const instanceType = this.clubTypeIdToInstanceType(section.club_type_id);

    return {
      mainClubId: section.main_club_id,
      instanceType,
      instanceId: section.club_section_id,
    };
  }

  private clubTypeIdToInstanceType(clubTypeId: number): AuthorizationSectionType {
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
    errorMessage: string,
  ): number {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isFinite(parsed)) {
      throw new ForbiddenException(errorMessage);
    }

    return parsed;
  }

  private requireMainClubId(
    value: number | null | undefined,
    errorMessage: string,
  ): number {
    if (!Number.isFinite(value)) {
      throw new ForbiddenException(errorMessage);
    }

    return value as number;
  }
}
