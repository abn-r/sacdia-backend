import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import {
  CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
  CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
} from '../authorization/club-assignment-temporal';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import { MemberTerritoryScopeService } from '../authorization/member-territory-scope.service';
import { isTargetUserInActorScope } from '../authorization/target-user-scope';
import {
  directPermissionsSatisfy,
  getActiveClubPermissions,
  hasRequiredPermissions,
  isOwnerAwareResource,
  BASE_GLOBAL_ROLE_NAME,
} from '../authorization/permission-requirements';
import {
  getRequestValue,
  getRequiredNumericValue,
  parseEntityUuid,
  parseTenantId,
  requireMainClubId,
  UUID_PARAM_PATTERN,
} from '../authorization/policies/request-values';
import { buildResourcePolicyRegistry } from '../authorization/policies/build-policy-registry';
import type { ResourcePolicyRegistry } from '../authorization/policies/policy-registry';
import type { PolicyContext } from '../authorization/policies/resource-policy';
import { assertClubAccess } from '../authorization/policies/scope/club-access';
import { AssignmentEffectivity } from '../authorization/policies/scope/instance-scope';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
  type AuthorizationResourceType,
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
import { getSensitiveUserSubresourcePolicy } from './sensitive-user-subresource-policy';

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

export { BASE_GLOBAL_ROLE_NAME };

type LegacyResourceType = Extract<
  AuthorizationResourceType,
  | 'camporee'
  | 'union_camporee'
  | 'camporee_event'
  | 'camporee_venue'
  | 'camporee_payment'
>;

const SECTION_MEMBER_PROFILE_GATE_PERMISSIONS = new Set([
  'club_roles:read',
  'club_members:approve',
  'users:read_detail',
]);

/**
 * Club-scoped reads of a member of the actor's active section, each with the
 * club permissions that open it. Investiture eligibility
 * (`validation:read`) is for the section board only, the roles that present
 * investiture requests (decision 2026-11-02): `club_members:approve` is held
 * by director, deputy-director, secretary and secretary-treasurer.
 */
const SECTION_MEMBER_READ_GATES: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map<string, ReadonlySet<string>>([
  ['users:read_detail', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['classes:read', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['user_honors:read', SECTION_MEMBER_PROFILE_GATE_PERMISSIONS],
  ['validation:read', new Set(['club_members:approve'])],
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
  private readonly policies: ResourcePolicyRegistry;
  private readonly assignments: AssignmentEffectivity;

  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
    private readonly assignmentEffectivity: ClubAssignmentEffectivityPolicy,
    private readonly temporalContexts: TemporalContextFactory,
    @Optional() private readonly memberScope?: MemberTerritoryScopeService,
  ) {
    this.assignments = new AssignmentEffectivity(
      assignmentEffectivity,
      temporalContexts,
    );
    this.policies = buildResourcePolicyRegistry(
      {
        prisma,
        authorizationContext,
        hierarchy,
        effectivity: assignmentEffectivity,
        temporal: temporalContexts,
        memberScope,
      },
      (ctx) => this.legacyResourceScope(ctx),
    );
  }

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

    const permissionsSatisfied = hasRequiredPermissions(
      resolved,
      requirement,
      resource,
      sensitiveUserSubresource,
    );

    // A global permission says what the actor may do, not on whom: on a
    // `user` resource the target must be inside the actor's territory, else
    // only the section-member paths below can still let the request in.
    // A direct per-user grant is an explicit admin decision about this actor
    // and keeps working as before.
    const grantedByGlobalPermission =
      permissionsSatisfied &&
      (resource.type !== 'user' ||
        directPermissionsSatisfy(resolved, requirement) ||
        (await this.isTargetUserInScope(request, userId, resolved, resource)));

    if (
      !grantedByGlobalPermission &&
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
   * the actor's scope through the policy registry. `global`, `user` and
   * `active_assignment` carry no resource of their own: any tenant identifier
   * those routes accept must be declared through `bind` (see
   * enforceTenantBindings).
   */
  private validateResourceScope(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    requirement: PermissionRequirement,
    resource: AuthorizationResourceMetadata,
  ): Promise<boolean> {
    const policy = this.policies.get(resource.type);
    if (!policy) {
      throw new AppInternalServerErrorException(
        ErrorCode.GUARD_RBAC_MISCONFIGURATION,
      );
    }
    return policy.resolve({ userId, request, resolved, requirement, resource });
  }

  /** Pre-registry switch; shrinks as types move to their own policy. */
  private async legacyResourceScope(ctx: PolicyContext): Promise<boolean> {
    const { request, resolved, resource } = ctx;
    const type = resource.type as LegacyResourceType;
    switch (type) {
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
      default: {
        const _exhaustive: never = type;
        void _exhaustive;
        throw new AppInternalServerErrorException(
          ErrorCode.GUARD_RBAC_MISCONFIGURATION,
        );
      }
    }
  }

  private async isTargetUserInScope(
    request: any,
    actorUserId: string,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
  ): Promise<boolean> {
    const targetUserId = getRequestValue(
      request,
      'param',
      resource.ownerParam ?? 'userId',
    );
    if (
      typeof targetUserId !== 'string' ||
      !UUID_PARAM_PATTERN.test(targetUserId)
    ) {
      return false;
    }
    return isTargetUserInActorScope(
      { prisma: this.prisma, memberScope: this.memberScope },
      actorUserId,
      resolved,
      targetUserId,
    );
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
        SECTION_MEMBER_READ_GATES.has(permission),
      )
    ) {
      return false;
    }

    const activeClubPermissions = getActiveClubPermissions(resolved);
    const canReadSectionMemberProfile = requirement.permissions.every(
      (permission) =>
        [...(SECTION_MEMBER_READ_GATES.get(permission) ?? [])].some((gate) =>
          activeClubPermissions.has(gate),
        ),
    );
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
    if (!getActiveClubPermissions(resolved).has(finePermission)) {
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

    const targetUserId = getRequestValue(
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

    const sectionAssignments = await this.prisma.club_role_assignments.findMany(
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
        select: {
          assignment_id: true,
          active: true,
          status: true,
          ...CLUB_ASSIGNMENT_TEMPORAL_FIELDS,
          ...CLUB_ASSIGNMENT_LOCAL_FIELD_SELECT,
        },
      },
    );

    // Filas 'active' deben estar vigentes (policy). Las no activas (p. ej.
    // 'pending' en lecturas de flujo de alta) no otorgan autoridad y no
    // tienen vigencia que evaluar.
    return sectionAssignments.some(
      (assignment) =>
        assignment.status !== 'active' ||
        this.assignments.isAssignmentEffective(assignment),
    );
  }

  private async enforceTenantBindings(
    userId: string,
    request: any,
    resolved: ResolvedAuthorizationProfile,
    resource: AuthorizationResourceMetadata,
  ): Promise<void> {
    for (const binding of resource.bind ?? []) {
      const rawValue = getRequestValue(request, binding.source, binding.field);

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        if (binding.optional) {
          continue;
        }
        throw new AppForbiddenException(ErrorCode.GUARD_CLUB_SCOPE_REQUIRED);
      }

      if (binding.kind === 'club_enrollment_territory') {
        await this.assertClubEnrollmentTerritoryAccess(
          userId,
          parseEntityUuid(rawValue),
        );
        continue;
      }

      const tenantId = parseTenantId(rawValue);

      switch (binding.kind) {
        case 'club':
          await assertClubAccess(
            this.authorizationContext,
            userId,
            resolved,
            tenantId,
          );
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
    const routeClubIdValue = getRequestValue(
      request,
      'param',
      resource.clubIdParam ?? 'clubId',
    );
    const routeClubId =
      routeClubIdValue === undefined || routeClubIdValue === null
        ? null
        : parseTenantId(routeClubIdValue);

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

    const mainClubId = requireMainClubId(
      section.main_club_id,
      'Club section without main club',
    );

    await assertClubAccess(
      this.authorizationContext,
      userId,
      resolved,
      mainClubId,
    );
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

    const mainClubId = requireMainClubId(
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

  private canBypassForResourceOwner(
    request: any,
    userId: string,
    resource: AuthorizationResourceMetadata,
  ): boolean {
    return (
      isOwnerAwareResource(resource) &&
      this.isResourceOwner(request, userId, resource)
    );
  }

  private async resolveCamporeeScope(
    request: any,
    resource: AuthorizationResourceMetadata,
  ): Promise<ResolvedTerritoryScope> {
    const camporeeId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'camporeeId'),
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
    const eventId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'eventId'),
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
    const rawId = getRequestValue(
      request,
      'param',
      resource.idParam ?? 'venueId',
    );

    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const venueId = getRequiredNumericValue(
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
    const paymentId = parseEntityUuid(
      getRequestValue(request, 'param', resource.idParam ?? 'paymentId'),
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
    const camporeeId = getRequiredNumericValue(
      getRequestValue(request, 'param', resource.idParam ?? 'unionCamporeeId'),
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
}
