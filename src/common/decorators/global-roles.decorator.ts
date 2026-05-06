import { SetMetadata } from '@nestjs/common';

export const GLOBAL_ROLES_KEY = 'global_roles';

export type GlobalRoleType =
  | 'super-admin'
  | 'admin'
  | 'assistant-admin'
  | 'coordinator'
  | 'pastor'
  | 'user';

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
