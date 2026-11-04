import type { AuthorizationResourceMetadata } from '../decorators/authorization-resource.decorator';
import type { PermissionRequirement } from '../decorators/permissions.decorator';
import type { SensitiveUserSubresourceMetadata } from '../decorators/sensitive-user-subresource.decorator';
import { getSensitiveUserSubresourceFallbackPermission } from '../guards/sensitive-user-subresource-policy';
import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import { COORDINATOR_GLOBAL_ROLE_NAMES } from './coordinator-section-scope';

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

export function directPermissionsSatisfy(
  resolved: ResolvedAuthorizationProfile,
  requirement: PermissionRequirement,
): boolean {
  const direct = new Set(
    resolved.authorization.grants.direct_permissions ?? [],
  );
  return requirement.mode === 'any'
    ? requirement.permissions.some((permission) => direct.has(permission))
    : requirement.permissions.every((permission) => direct.has(permission));
}

export function getGlobalPermissions(
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
            !COORDINATOR_GLOBAL_ROLE_NAMES.has(grant.role_name.toLowerCase())),
      )
      .flatMap((grant) => grant.permissions),
    ...(resolved.authorization.grants.direct_permissions ?? []),
  ]);
}

export function getActiveClubPermissions(
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

/** Resources that belong to the user named by `ownerParam`. */
export function isOwnerAwareResource(
  resource: AuthorizationResourceMetadata,
): boolean {
  return (
    resource.type === 'user' ||
    (resource.type === 'active_assignment' && Boolean(resource.ownerParam))
  );
}

function hasSensitiveUserSubresourcePermissions(
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

export function hasRequiredPermissions(
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
  const globalPermissions = getGlobalPermissions(resolved, {
    excludeBaseRole: isOwnerAwareResource(resource),
    excludeCoordinatorRoles,
  });

  if (resource.type === 'user' && sensitiveUserSubresource) {
    return hasSensitiveUserSubresourcePermissions(
      globalPermissions,
      requirement,
      sensitiveUserSubresource,
    );
  }

  const activeClubPermissions = getActiveClubPermissions(resolved);
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
