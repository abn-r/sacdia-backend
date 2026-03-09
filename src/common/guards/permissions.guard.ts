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
  type AuthorizationInstanceType,
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

type ResolvedInstanceScope = {
  mainClubId: number;
  instanceType: AuthorizationInstanceType;
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
    const requirement =
      this.reflector.getAllAndOverride<PermissionRequirement>(
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

    if (resource.type === 'user' && this.isResourceOwner(request, userId, resource)) {
      return true;
    }

    const resolved = await this.authorizationContext.resolveUserAuthorization(
      userId,
    );
    request.authorization = resolved.authorization;

    if (!this.hasRequiredPermissions(resolved, requirement, resource)) {
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
  ): boolean {
    const globalPermissions = this.getGlobalPermissions(resolved);
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

  private getGlobalPermissions(
    resolved: ResolvedAuthorizationProfile,
  ): Set<string> {
    return new Set(
      resolved.authorization.grants.global_roles.flatMap((grant) => grant.permissions),
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
      activeClubScope.instance.type !== resourceScope.instanceType ||
      activeClubScope.instance.instance_id !== resourceScope.instanceId
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
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
        club_adv_i: { select: { main_club_id: true } },
        club_pathf: { select: { main_club_id: true } },
        club_mg: { select: { main_club_id: true } },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    return this.buildInstanceScopeFromRecord({
      club_adv_id: activity.club_adv_id,
      club_pathf_id: activity.club_pathf_id,
      club_mg_id: activity.club_mg_id,
      club_adventurers: activity.club_adv_i,
      club_pathfinders: activity.club_pathf,
      club_master_guild: activity.club_mg,
    });
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
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
        club_adventurers: { select: { main_club_id: true } },
        club_pathfinders: { select: { main_club_id: true } },
        club_master_guild: { select: { main_club_id: true } },
      },
    });

    if (!finance) {
      throw new NotFoundException('Finance record not found');
    }

    return this.buildInstanceScopeFromRecord(finance);
  }

  private async resolveInventoryInstanceScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const instanceId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'clubId'),
      'Inventory instance ID not found in request',
    );
    const rawInstanceType = this.getRequestValue(
      request,
      resource.instanceTypeSource ?? 'query',
      resource.instanceTypeField ?? 'instanceType',
    );
    const instanceType = this.normalizeInstanceType(rawInstanceType);

    switch (instanceType) {
      case 'adventurers': {
        const instance = await this.prisma.club_adventurers.findUnique({
          where: { club_adv_id: instanceId },
          select: { club_adv_id: true, main_club_id: true },
        });

        if (!instance) {
          throw new NotFoundException('Club adventurers instance not found');
        }

        return {
          mainClubId: this.requireMainClubId(
            instance.main_club_id,
            'Club adventurers instance does not belong to a main club',
          ),
          instanceType,
          instanceId: instance.club_adv_id,
        };
      }
      case 'pathfinders': {
        const instance = await this.prisma.club_pathfinders.findUnique({
          where: { club_pathf_id: instanceId },
          select: { club_pathf_id: true, main_club_id: true },
        });

        if (!instance) {
          throw new NotFoundException('Club pathfinders instance not found');
        }

        return {
          mainClubId: this.requireMainClubId(
            instance.main_club_id,
            'Club pathfinders instance does not belong to a main club',
          ),
          instanceType,
          instanceId: instance.club_pathf_id,
        };
      }
      case 'master_guilds': {
        const instance = await this.prisma.club_master_guilds.findUnique({
          where: { club_mg_id: instanceId },
          select: { club_mg_id: true, main_club_id: true },
        });

        if (!instance) {
          throw new NotFoundException('Club master guilds instance not found');
        }

        return {
          mainClubId: this.requireMainClubId(
            instance.main_club_id,
            'Club master guilds instance does not belong to a main club',
          ),
          instanceType,
          instanceId: instance.club_mg_id,
        };
      }
    }
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
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
        club_adventurers: { select: { main_club_id: true } },
        club_pathfinders: { select: { main_club_id: true } },
        club_master_guild: { select: { main_club_id: true } },
      },
    });

    if (!inventoryItem) {
      throw new NotFoundException('Inventory item not found');
    }

    return this.buildInstanceScopeFromRecord(inventoryItem);
  }

  private async resolveClubAssignmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const assignmentId = String(
      this.getRequestValue(request, 'param', resource.idParam ?? 'assignmentId'),
    );

    if (!assignmentId) {
      throw new ForbiddenException('Assignment ID not found in request');
    }

    const assignment = await this.prisma.club_role_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
        club_adv_id: true,
        club_pathf_id: true,
        club_mg_id: true,
        club_adventurers: { select: { main_club_id: true } },
        club_pathfinders: { select: { main_club_id: true } },
        club_master_guild: { select: { main_club_id: true } },
      },
    });

    if (!assignment) {
      throw new NotFoundException('Club assignment not found');
    }

    return this.buildInstanceScopeFromRecord(assignment);
  }

  private buildInstanceScopeFromRecord(record: {
    club_adv_id?: number | null;
    club_pathf_id?: number | null;
    club_mg_id?: number | null;
    club_adventurers?: { main_club_id: number | null } | null;
    club_pathfinders?: { main_club_id: number | null } | null;
    club_master_guild?: { main_club_id: number | null } | null;
  }): ResolvedInstanceScope {
    if (record.club_adv_id && record.club_adventurers?.main_club_id) {
      return {
        mainClubId: this.requireMainClubId(
          record.club_adventurers.main_club_id,
          'Club adventurers resource does not belong to a main club',
        ),
        instanceType: 'adventurers',
        instanceId: record.club_adv_id,
      };
    }

    if (record.club_pathf_id && record.club_pathfinders?.main_club_id) {
      return {
        mainClubId: this.requireMainClubId(
          record.club_pathfinders.main_club_id,
          'Club pathfinders resource does not belong to a main club',
        ),
        instanceType: 'pathfinders',
        instanceId: record.club_pathf_id,
      };
    }

    if (record.club_mg_id && record.club_master_guild?.main_club_id) {
      return {
        mainClubId: this.requireMainClubId(
          record.club_master_guild.main_club_id,
          'Club master guild resource does not belong to a main club',
        ),
        instanceType: 'master_guilds',
        instanceId: record.club_mg_id,
      };
    }

    throw new ForbiddenException(
      'Unable to resolve the club instance for this resource',
    );
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

  private getRequiredNumericValue(value: unknown, errorMessage: string): number {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(String(value), 10);

    if (!Number.isFinite(parsed)) {
      throw new ForbiddenException(errorMessage);
    }

    return parsed;
  }

  private normalizeInstanceType(rawValue: unknown): AuthorizationInstanceType {
    const value = String(rawValue ?? '').trim().toLowerCase();

    if (value === 'adv' || value === 'adventurers') {
      return 'adventurers';
    }

    if (value === 'pathf' || value === 'pathfinders') {
      return 'pathfinders';
    }

    if (value === 'mg' || value === 'master_guilds') {
      return 'master_guilds';
    }

    throw new ForbiddenException('Instance type not found in request');
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
