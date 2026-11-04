import { SetMetadata } from '@nestjs/common';
import type { GlobalRoleName } from '../authorization/generated/role-names';

export const GLOBAL_ROLES_KEY = 'global_roles';

export type GlobalRoleType = GlobalRoleName;

/**
 * Decorator to require specific global roles for an endpoint.
 *
 * @example
 * // Require admin or super-admin role
 * @GlobalRoles('admin', 'super-admin')
 * @UseGuards(JwtAuthGuard, GlobalRolesGuard)
 * @Post('honors/validate')
 * validateHonor() { ... }
 */
export const GlobalRoles = (...roles: GlobalRoleType[]) =>
  SetMetadata(GLOBAL_ROLES_KEY, roles);

export const EXACT_GLOBAL_ROLES_KEY = 'exact_global_roles';

/**
 * Like {@link GlobalRoles} but WITHOUT alias expansion: the accepted set is
 * exactly the listed roles (e.g. `director-lf` does not admit
 * `director-union`). super-admin still bypasses. When both decorators are
 * present at the same level, `ExactGlobalRoles` wins.
 */
export const ExactGlobalRoles = (...roles: GlobalRoleType[]) =>
  SetMetadata(EXACT_GLOBAL_ROLES_KEY, roles);
