import { SetMetadata } from '@nestjs/common';

export const GLOBAL_ROLES_KEY = 'global_roles';

export type GlobalRoleType = 'super_admin' | 'admin' | 'coordinator' | 'user';

/**
 * Decorator to require specific global roles for an endpoint.
 *
 * @example
 * // Require admin or super_admin role
 * @GlobalRoles('admin', 'super_admin')
 * @UseGuards(JwtAuthGuard, GlobalRolesGuard)
 * @Post('honors/validate')
 * validateHonor() { ... }
 */
export const GlobalRoles = (...roles: GlobalRoleType[]) =>
  SetMetadata(GLOBAL_ROLES_KEY, roles);
