import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import {
  AppBadRequestException,
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
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SKIP_PERMISSIONS_KEY } from '../decorators/skip-permissions.decorator';
import {
  SENSITIVE_USER_SUBRESOURCE_KEY,
  type SensitiveUserSubresourceMetadata,
} from '../decorators/sensitive-user-subresource.decorator';
import {
  getSensitiveUserSubresourceFallbackPermission,
  getSensitiveUserSubresourcePolicy,
} from './sensitive-user-subresource-policy';
import {
  COORDINATOR_GLOBAL_ROLE_NAMES,
  coordinatorRolePermissions,
  coordinatorScopeIncludesSection,
} from '../authorization/coordinator-section-scope';

/**
 * Same shape `ParseUUIDPipe` accepts (and Postgres `uuid` parses). Stricter
 * `isUUID(…, 'all')` rejects non-RFC variants that are valid ids in the DB.
 */
const UUID_PARAM_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuthorizationSectionType = 'adventurers' | 'pathfinders' | 'master_guilds';

type ResolvedInstanceScope = {
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
type CoordinatorSectionsCheck = {
  requirement: PermissionRequirement;
  clubAuthority: boolean;
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
  /**
   * Set when the scope comes from a concrete union camporee. Only then can a
   * participating local field be admitted by validateUnionCamporeeScope.
   */
  unionCamporeeId?: number | null;
};

/**
 * GLOBAL base role that every account receives at sign-up (see auth.service
 * and social-account.resolver). Its grants describe what a user may do with
 * their OWN data, so on an owner-aware resource they amount to "any signed-in
 * user". The owner already passes through the owner bypass, which means these
 * grants would only ever be consulted for a non-owner: they must never
 * authorize access to another user's object. A non-owner needs a non-base
 * source: another global role, a direct grant, or one of the club-scoped
 * section-member paths.
 */
export const BASE_GLOBAL_ROLE_NAME = 'user';

const SECTION_MEMBER_PROFILE_READ_PERMISSIONS = new Set([
  'users:read_detail',
  'classes:read',
  'user_honors:read',
]);

const SECTION_MEMBER_PROFILE_GATE_PERMISSIONS = new Set([
  'club_roles:read',
  'club_members:approve',
  'users:read_detail',
]);

/** E2E-only. Nest cannot rebind APP_GUARD via overrideGuard(PermissionsGuard). */
export const E2E_PASSTHROUGH_PERMISSIONS_ENV = 'E2E_PASSTHROUGH_PERMISSIONS';

// Only NODE_ENV=test (Jest and the CI e2e job) may bypass RBAC. Deployed
// servers can run with NODE_ENV=development, so "not production" is not enough.
function isE2ePermissionsPassthrough(): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env[E2E_PASSTHROUGH_PERMISSIONS_ENV] === 'true'
  );
}

/** Request slot where a successful PermissionsGuard pass is memoized. */
const PERMISSIONS_GRANTED = Symbol('permissionsGuardGranted');

interface PermissionsGrantMemo {
  handler: unknown;
  userId: string | undefined;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Controllers re-declare `@UseGuards(JwtAuthGuard, PermissionsGuard)` on
    // top of the global APP_GUARD, so the same check runs twice per request.
    // Reuse the first grant for the same handler and principal instead of
    // resolving the authorization context and club scope again.
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();
    const granted = request?.[PERMISSIONS_GRANTED] as
      PermissionsGrantMemo | undefined;
    if (
      granted &&
      granted.handler === handler &&
      granted.userId === request.user?.sub
    ) {
      return true;
    }

    const allowed = await this.evaluate(context);
    if (allowed && request) {
      request[PERMISSIONS_GRANTED] = {
        handler,
        userId: request.user?.sub,
      } satisfies PermissionsGrantMemo;
    }
    return allowed;
  }

  private async evaluate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const skipPermissions = this.reflector.getAllAndOverride<boolean>(
      SKIP_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipPermissions) {
      return true;
    }

    if (isE2ePermissionsPassthrough()) {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement || requirement.permissions.length === 0) {
      throw new AppInternalServerErrorException(
        ErrorCode.GUARD_RBAC_MISCONFIGURATION,
      );
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

    const isOwnerBypass = this.canBypassForResourceOwner(
      request,
      userId,
      resource,
    );
    const hasTenantBindings = (resource.bind?.length ?? 0) > 0;

    if (isOwnerBypass && !hasTenantBindings) {
      return true;
    }

    const resolved =
      await this.authorizationContext.resolveUserAuthorization(userId);
    request.authorization = resolved.authorization;
    request.authorizationProfile = resolved;

    // Owners skip the permission check, but tenant identifiers they send are
    // still bound to their own scope.
    if (isOwnerBypass) {
      await this.enforceTenantBindings(userId, request, resolved, resource);
      return true;
    }

    const hasRequiredPermissions = this.hasRequiredPermissions(
      resolved,
      requirement,
      resource,
      sensitiveUserSubresource,
    );

    if (
      !hasRequiredPermissions &&
      !(await this.canReadSectionMemberProfile(
        request,
        userId,
        resolved,
        requirement,
        resource,
        sensitiveUserSubresource,
      )) &&
      !(await this.canReadSectionMemberSensitiveSubresource(
        request,
        userId,
        resolved,
        resource,
        sensitiveUserSubresource,
      ))
    ) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    if (
      !(await this.validateResourceScope(
        userId,
        request,
        resolved,
        requirement,
        resource,
      ))
    ) {
      return false;
    }

    await this.enforceTenantBindings(userId, request, resolved, resource);
    return true;
  }

  /**
   * Resolves the resource named by the route metadata and checks it against
   * the actor's scope. `global`, `user` and `active_assignment` carry no
   * resource of their own: any tenant identifier those routes accept must be
   * declared through `bind` (see enforceTenantBindings).
   */
  private async validateResourceScope(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
  ): Promise<boolean> {
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
          this.coordinatorSectionsCheck(resolved, requirement, resource),
          request,
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
      case 'camporee_payment': {
        const paymentScope = await this.resolveCamporeePaymentScope(
          request,
          resource,
        );
        if (paymentScope.type === 'local') {
          return this.validateTerritoryScope(resolved, paymentScope.scope);
        }
        return this.validateUnionCamporeeScope(resolved, paymentScope.scope);
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
      case 'activity_series': {
        const seriesScope = await this.resolveActivitySeriesScope(
          request,
          resource,
        );
        if ('participatingSectionIds' in seriesScope) {
          return this.validateJointActivityScope(userId, resolved, seriesScope);
        }
        return this.validateInstanceScope(userId, resolved, seriesScope);
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
          this.coordinatorSectionsCheck(resolved, requirement, resource),
          request,
        );
      case 'class_counselor_assignment':
        return this.validateInstanceScope(
          userId,
          resolved,
          await this.resolveClassCounselorAssignmentScope(request, resource),
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
          this.coordinatorSectionsCheck(resolved, requirement, resource),
          request,
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
      default: {
        const _exhaustive: never = resource.type;
        void _exhaustive;
        throw new AppInternalServerErrorException(
          ErrorCode.GUARD_RBAC_MISCONFIGURATION,
        );
      }
    }
  }

  private hasRequiredPermissions(
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
    {
      excludeCoordinatorRoles = false,
    }: { excludeCoordinatorRoles?: boolean } = {},
  ): boolean {
    // Reached only after the owner bypass failed: on an owner-aware resource
    // the actor is a non-owner here, so the base role does not count.
    const globalPermissions = this.getGlobalPermissions(resolved, {
      excludeBaseRole: this.isOwnerAwareResource(resource),
      excludeCoordinatorRoles,
    });

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
    {
      excludeBaseRole,
      excludeCoordinatorRoles = false,
    }: { excludeBaseRole: boolean; excludeCoordinatorRoles?: boolean },
  ): Set<string> {
    return new Set([
      ...resolved.authorization.grants.global_roles
        .filter(
          (grant) =>
            (!excludeBaseRole ||
              grant.role_name.toLowerCase() !== BASE_GLOBAL_ROLE_NAME) &&
            (!excludeCoordinatorRoles ||
              !COORDINATOR_GLOBAL_ROLE_NAMES.has(
                grant.role_name.toLowerCase(),
              )),
        )
        .flatMap((grant) => grant.permissions),
      ...(resolved.authorization.grants.direct_permissions ?? []),
    ]);
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

    if (!activeGrant || activeGrant.operational === false) {
      return new Set<string>();
    }

    return new Set(activeGrant.permissions ?? []);
  }

  private async canReadSectionMemberProfile(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
  ): Promise<boolean> {
    if (resource.type !== 'user' || sensitiveUserSubresource) {
      return false;
    }

    if (
      requirement.permissions.length === 0 ||
      !requirement.permissions.every((permission) =>
        SECTION_MEMBER_PROFILE_READ_PERMISSIONS.has(permission),
      )
    ) {
      return false;
    }

    const activeClubPermissions = this.getActiveClubPermissions(resolved);
    const canReadSectionMemberProfile = [
      ...SECTION_MEMBER_PROFILE_GATE_PERMISSIONS,
    ].some((permission) => activeClubPermissions.has(permission));
    if (!canReadSectionMemberProfile) {
      return false;
    }

    return this.isTargetInActiveSection(
      request,
      actorUserId,
      resolved,
      resource,
      ['active', 'pending'],
    );
  }

  /**
   * Club-scoped read of a section member's sensitive subresources
   * (health, emergency contacts, ...). Requires the fine `<family>:read`
   * permission on the active club assignment — the legacy
   * `users:read_detail` fallback is intentionally not honored here — and
   * the target must be an active (not pending) member of the actor's
   * active section.
   */
  private async canReadSectionMemberSensitiveSubresource(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    sensitiveUserSubresource?: SensitiveUserSubresourceMetadata,
  ): Promise<boolean> {
    if (
      resource.type !== 'user' ||
      !sensitiveUserSubresource ||
      sensitiveUserSubresource.mode !== 'read'
    ) {
      return false;
    }

    const finePermission = getSensitiveUserSubresourcePolicy(
      sensitiveUserSubresource.family,
      sensitiveUserSubresource.mode,
    ).finePermission;
    if (!this.getActiveClubPermissions(resolved).has(finePermission)) {
      return false;
    }

    return this.isTargetInActiveSection(
      request,
      actorUserId,
      resolved,
      resource,
      ['active'],
    );
  }

  private async isTargetInActiveSection(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    allowedStatuses: string[],
  ): Promise<boolean> {
    const activeClubScope = resolved.authorization.effective.scope.club;
    const activeSectionId = activeClubScope?.section.club_section_id;
    if (typeof activeSectionId !== 'number') {
      return false;
    }

    const targetUserId = this.getRequestValue(
      request,
      'param',
      resource.ownerParam ?? 'userId',
    );

    if (
      typeof targetUserId !== 'string' ||
      !UUID_PARAM_PATTERN.test(targetUserId) ||
      targetUserId === actorUserId
    ) {
      return false;
    }

    const sectionAssignment = await this.prisma.club_role_assignments.findFirst(
      {
        where: {
          user_id: targetUserId,
          club_section_id: activeSectionId,
          active: true,
          OR: [
            { status: null },
            {
              status: {
                in: allowedStatuses,
              },
            },
          ],
        },
        select: { assignment_id: true },
      },
    );

    return sectionAssignment != null;
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

    await this.assertClubAccess(userId, resolved, clubId);
    return true;
  }

  private async assertClubAccess(
    userId: string,
    resolved: ResolvedAuthorizationProfile,
    clubId: number,
  ): Promise<void> {
    // Checked first because it needs no DB: a member of the club passes
    // without the territorial hierarchy lookup inside canManageClub.
    const activeClubScope = resolved.authorization.effective.scope.club;
    if (activeClubScope && activeClubScope.club.club_id === clubId) {
      return;
    }

    if (
      await this.authorizationContext.canManageClub(userId, clubId, resolved)
    ) {
      return;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  private async enforceTenantBindings(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
  ): Promise<void> {
    for (const binding of resource.bind ?? []) {
      const rawValue = this.getRequestValue(
        request,
        binding.source,
        binding.field,
      );

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        if (binding.optional) {
          continue;
        }
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      if (binding.kind === 'club_enrollment_territory') {
        await this.assertClubEnrollmentTerritoryAccess(
          userId,
          this.parseEntityUuid(rawValue),
        );
        continue;
      }

      const tenantId = this.parseTenantId(rawValue);

      switch (binding.kind) {
        case 'club':
          await this.assertClubAccess(userId, resolved, tenantId);
          break;
        case 'club_section':
          await this.assertClubSectionAccess(
            userId,
            request,
            resolved,
            resource,
            tenantId,
          );
          break;
        case 'local_field':
          this.assertHierarchyAccess(
            resolved,
            await this.loadHierarchyScope({ localFieldId: tenantId }),
          );
          break;
        case 'union':
          this.assertHierarchyAccess(
            resolved,
            await this.loadHierarchyScope({ unionId: tenantId }),
          );
          break;
        case 'camporee':
          this.validateTerritoryScope(
            resolved,
            await this.loadCamporeeScope(tenantId),
          );
          break;
        case 'union_camporee':
          this.assertUnionCamporeeOwnerScope(
            resolved,
            await this.loadUnionCamporeeScope(tenantId),
          );
          break;
        default: {
          const _exhaustive: never = binding.kind;
          void _exhaustive;
          throw new AppInternalServerErrorException(
            ErrorCode.GUARD_RBAC_MISCONFIGURATION,
          );
        }
      }
    }
  }

  /**
   * A bound section must belong to the route's club (when the route carries
   * one) and the actor must be able to act on that club.
   */
  private async assertClubSectionAccess(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
    sectionId: number,
  ): Promise<void> {
    const routeClubIdValue = this.getRequestValue(
      request,
      'param',
      resource.clubIdParam ?? 'clubId',
    );
    const routeClubId =
      routeClubIdValue === undefined || routeClubIdValue === null
        ? null
        : this.parseTenantId(routeClubIdValue);

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true },
    });

    if (
      !section ||
      (routeClubId !== null && section.main_club_id !== routeClubId)
    ) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const mainClubId = this.requireMainClubId(
      section.main_club_id,
      'Club section without main club',
    );

    await this.assertClubAccess(userId, resolved, mainClubId);
  }

  /**
   * Resolves a club enrollment UUID to its club and requires the actor's
   * territory to cover it (Campo Local review). An active club assignment
   * does not qualify: a club cannot approve its own enrollment.
   */
  private async assertClubEnrollmentTerritoryAccess(
    userId: string,
    enrollmentId: string,
  ): Promise<void> {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: { club_section: { select: { main_club_id: true } } },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    const mainClubId = this.requireMainClubId(
      enrollment.club_section?.main_club_id,
      'Club enrollment section without main club',
    );

    if (!(await this.authorizationContext.canManageClub(userId, mainClubId))) {
      throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
    }
  }

  private async loadHierarchyScope(input: {
    localFieldId?: number;
    unionId?: number;
  }): Promise<{
    division_id: number | null;
    union_id: number | null;
    local_field_id: number | null;
  }> {
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

  private assertHierarchyAccess(
    resolved: ResolvedAuthorizationProfile,
    scope: {
      division_id: number | null;
      union_id: number | null;
      local_field_id: number | null;
    },
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
  private assertUnionCamporeeOwnerScope(
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

  /**
   * Tenant ids must be a positive integer or its plain decimal string form.
   * Arrays, objects and partially numeric strings ("20abc") are rejected.
   */
  private parseTenantId(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
      return value;
    }

    if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) {
        return parsed;
      }
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  /** Entity UUIDs are checked before they reach a `@db.Uuid` lookup. */
  private parseEntityUuid(value: unknown): string {
    if (typeof value === 'string' && isUUID(value, 'all')) {
      return value;
    }

    throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
  }

  /**
   * Only for routes that opted in with `coordinatorSections` (see
   * AuthorizationResourceMetadata); undefined everywhere else, so every other
   * route keeps the generic rule.
   */
  private coordinatorSectionsCheck(
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
  ): CoordinatorSectionsCheck | undefined {
    if (!resource.coordinatorSections) {
      return undefined;
    }
    return {
      requirement,
      clubAuthority: this.hasRequiredPermissions(
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
  private async validateInstanceScope(
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
  private async coordinatorCoversSection(
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
  private async validateJointActivityScope(
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

  /** Resources that belong to the user named by `ownerParam`. */
  private isOwnerAwareResource(
    resource: AuthorizationResourceMetadata,
  ): boolean {
    return (
      resource.type === 'user' ||
      (resource.type === 'active_assignment' && Boolean(resource.ownerParam))
    );
  }

  private canBypassForResourceOwner(
    request: any,
    userId: string,
    resource: AuthorizationResourceMetadata,
  ): boolean {
    return (
      this.isOwnerAwareResource(resource) &&
      this.isResourceOwner(request, userId, resource)
    );
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

  private async resolveActivitySeriesScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope | ResolvedJointActivityScope> {
    const seriesId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'seriesId'),
      'Activity series ID not found in request',
    );

    const series = await this.prisma.activity_series.findUnique({
      where: { activity_series_id: seriesId },
      select: {
        is_joint: true,
        club_id: true,
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            main_club_id: true,
            club_type_id: true,
          },
        },
        activity_series_sections: {
          select: { club_section_id: true },
        },
      },
    });

    if (!series) {
      throw new AppNotFoundException(ErrorCode.ACTIVITY_SERIES_NOT_FOUND);
    }

    const participatingSectionIds = series.activity_series_sections.map(
      (row) => row.club_section_id,
    );

    if (series.is_joint || participatingSectionIds.length > 1) {
      return {
        mainClubId: series.club_id,
        participatingSectionIds:
          participatingSectionIds.length > 0
            ? participatingSectionIds
            : series.club_section_id
              ? [series.club_section_id]
              : [],
      };
    }

    return this.buildInstanceScopeFromSection(series.club_sections);
  }

  private async resolveCamporeeScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedTerritoryScope> {
    const camporeeId = this.getRequiredNumericValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'camporeeId'),
      'Camporee ID not found in request',
    );

    return this.loadCamporeeScope(camporeeId);
  }

  private async loadCamporeeScope(
    camporeeId: number,
  ): Promise<ResolvedTerritoryScope> {
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
          unionCamporeeId: event.union_camporee_id,
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

  /**
   * Resolves a camporee payment UUID to the camporee of the member it was
   * registered for: local camporee → territory scope, union camporee → union
   * camporee scope (same validators as the camporee routes themselves).
   */
  private async resolveCamporeePaymentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<
    | { type: 'local'; scope: ResolvedTerritoryScope }
    | { type: 'union'; scope: ResolvedUnionCamporeeScope }
  > {
    const paymentId = this.parseEntityUuid(
      this.getRequestValue(request, 'param', resource.idParam ?? 'paymentId'),
    );

    const payment = await this.prisma.camporee_payments.findUnique({
      where: { camporee_payment_id: paymentId },
      select: {
        camporee_member: {
          select: { camporee_id: true, union_camporee_id: true },
        },
      },
    });

    if (!payment) {
      throw new AppNotFoundException(ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND);
    }

    const { camporee_id: localCamporeeId, union_camporee_id: unionCamporeeId } =
      payment.camporee_member;

    if (typeof localCamporeeId === 'number') {
      return {
        type: 'local',
        scope: await this.loadCamporeeScope(localCamporeeId),
      };
    }

    if (typeof unionCamporeeId === 'number') {
      return {
        type: 'union',
        scope: await this.loadUnionCamporeeScope(unionCamporeeId),
      };
    }

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

    return this.loadUnionCamporeeScope(camporeeId);
  }

  private async loadUnionCamporeeScope(
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

  private async validateUnionCamporeeScope(
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

  private resolveUnionCamporeeParticipantLocalFieldId(
    resolved: ResolvedAuthorizationProfile,
  ): number | undefined {
    const globalLocalFieldId =
      resolved.authorization.effective.scope.global.local_field?.id;

    if (
      typeof globalLocalFieldId === 'number' &&
      (this.hasGlobalRole(resolved, 'admin') ||
        this.hasGlobalRole(resolved, 'assistant-admin') ||
        this.hasGlobalRole(resolved, 'director-lf') ||
        this.hasGlobalRole(resolved, 'assistant-lf'))
    ) {
      return globalLocalFieldId;
    }

    const activeAssignmentId =
      resolved.authorization.active_assignment.assignment_id;
    const activeGrant = resolved.authorization.grants.club_assignments.find(
      (assignment) => assignment.assignment_id === activeAssignmentId,
    );
    const activeGrantLocalFieldId = activeGrant?.scope.local_field?.id;

    return typeof activeGrantLocalFieldId === 'number'
      ? activeGrantLocalFieldId
      : undefined;
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
    const expectedClubIdValue = this.getRequestValue(
      request,
      'param',
      resource.clubIdParam ?? 'clubId',
    );
    const expectedClubId =
      expectedClubIdValue === undefined || expectedClubIdValue === null
        ? null
        : this.getRequiredNumericValue(
            expectedClubIdValue,
            'Club ID not found in request',
          );

    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (
      !section ||
      (expectedClubId !== null && section.main_club_id !== expectedClubId)
    ) {
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
    const assignmentId = this.getOptionalUuidValue(
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

  private async resolveClassCounselorAssignmentScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedInstanceScope> {
    const assignmentId = this.getOptionalUuidValue(
      this.getRequestValue(
        request,
        'param',
        resource.idParam ?? 'assignmentId',
      ),
    );

    if (!assignmentId) {
      throw new AppForbiddenException(ErrorCode.GUARD_ASSIGNMENT_SCOPE_INVALID);
    }

    const assignment = await (
      this.prisma as any
    ).class_counselor_assignments.findUnique({
      where: { assignment_id: assignmentId },
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

    if (!assignment) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_NOT_FOUND,
      );
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
      if (!isUUID(String(reportId), 'all')) {
        throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_ID);
      }

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

    if (!isUUID(enrollmentId, 'all')) {
      throw new AppBadRequestException(ErrorCode.MONTHLY_REPORT_INVALID_ID);
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
    const memberId = this.getOptionalUuidValue(
      this.getRequestValue(request, 'param', resource.idParam ?? 'memberId'),
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

  /**
   * Guards run before `ParseUUIDPipe`, so a malformed id would otherwise reach
   * a `@db.Uuid` lookup and surface as a 500. Missing/empty → `null` (callers
   * keep their own 403); present but not a UUID → 400.
   */
  private getOptionalUuidValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string' || !UUID_PARAM_PATTERN.test(value)) {
      throw new AppBadRequestException(ErrorCode.GUARD_ID_PARAM_INVALID);
    }

    return value;
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
