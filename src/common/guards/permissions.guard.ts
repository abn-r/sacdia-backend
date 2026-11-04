import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  AppForbiddenException,
  AppInternalServerErrorException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { ClubAssignmentEffectivityPolicy } from '../authorization/club-assignment-effectivity.policy';
import {
  AuthorizationContextService,
  type ResolvedAuthorizationProfile,
} from '../services/authorization-context.service';
import { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import { MemberTerritoryScopeService } from '../authorization/member-territory-scope.service';
import {
  directPermissionsSatisfy,
  hasRequiredPermissions,
  isOwnerAwareResource,
  BASE_GLOBAL_ROLE_NAME,
} from '../authorization/permission-requirements';
import { buildResourcePolicyRegistry } from '../authorization/policies/build-policy-registry';
import type { ResourcePolicyRegistry } from '../authorization/policies/policy-registry';
import { AssignmentEffectivity } from '../authorization/policies/scope/instance-scope';
import {
  CamporeeScopeLoader,
  TerritoryScopeValidator,
} from '../authorization/policies/scope/territory-scope';
import { SectionMemberAccess } from '../authorization/section-member-access';
import { TenantBindingEnforcer } from '../authorization/tenant-binding.enforcer';
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

export { BASE_GLOBAL_ROLE_NAME };

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
  private readonly tenantBindings: TenantBindingEnforcer;
  private readonly sectionMembers: SectionMemberAccess;

  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly prisma: PrismaService,
    private readonly hierarchy: InstitutionalHierarchyService,
    private readonly assignmentEffectivity: ClubAssignmentEffectivityPolicy,
    private readonly temporalContexts: TemporalContextFactory,
    @Optional() private readonly memberScope?: MemberTerritoryScopeService,
  ) {
    const assignments = new AssignmentEffectivity(
      assignmentEffectivity,
      temporalContexts,
    );
    this.policies = buildResourcePolicyRegistry({
      prisma,
      authorizationContext,
      hierarchy,
      effectivity: assignmentEffectivity,
      temporal: temporalContexts,
      memberScope,
    });
    const territory = new TerritoryScopeValidator(
      authorizationContext,
      prisma,
      hierarchy,
    );
    this.tenantBindings = new TenantBindingEnforcer(
      prisma,
      authorizationContext,
      hierarchy,
      territory,
      new CamporeeScopeLoader(prisma, hierarchy),
    );
    this.sectionMembers = new SectionMemberAccess(
      prisma,
      assignments,
      memberScope,
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
      await this.tenantBindings.enforce({
        userId,
        request,
        resolved,
        requirement,
        resource,
      });
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
        (await this.sectionMembers.isTargetUserInScope(
          request,
          userId,
          resolved,
          resource,
        )));

    if (
      !grantedByGlobalPermission &&
      !(await this.sectionMembers.canReadSectionMemberProfile(
        request,
        userId,
        resolved,
        requirement,
        resource,
        sensitiveUserSubresource,
      )) &&
      !(await this.sectionMembers.canReadSectionMemberSensitiveSubresource(
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
      !(await this.applyResourcePolicy(
        userId,
        request,
        resolved,
        requirement,
        resource,
      ))
    ) {
      return false;
    }

    await this.tenantBindings.enforce({
      userId,
      request,
      resolved,
      requirement,
      resource,
    });
    return true;
  }

  /**
   * Resolves the resource named by the route metadata and checks it against
   * the actor's scope through the policy registry. `global`, `user` and
   * `active_assignment` carry no resource of their own: any tenant identifier
   * those routes accept must be declared through `bind` (see
   * TenantBindingEnforcer).
   */
  private applyResourcePolicy(
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
}
