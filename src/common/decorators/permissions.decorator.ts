import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../authorization/generated/permission-keys';

export const PERMISSIONS_KEY = 'permissions';

export type PermissionMode = 'all' | 'any';

/** Shape stored as route metadata and read by PermissionsGuard. */
export type PermissionRequirement = {
  permissions: string[];
  mode: PermissionMode;
};

/** Shape accepted by the decorator; `mode` defaults to 'all'. */
export type PermissionRequirementInput = {
  permissions: PermissionKey[];
  mode?: PermissionMode;
};

export function RequirePermissions(
  ...permissions: PermissionKey[]
): ClassDecorator & MethodDecorator;
export function RequirePermissions(
  requirement: PermissionRequirementInput,
): ClassDecorator & MethodDecorator;
export function RequirePermissions(
  ...args: [PermissionRequirementInput] | PermissionKey[]
): ClassDecorator & MethodDecorator {
  const requirement: PermissionRequirement =
    typeof args[0] === 'object' && !Array.isArray(args[0])
      ? {
          permissions: args[0].permissions,
          mode: args[0].mode ?? 'all',
        }
      : {
          permissions: args as PermissionKey[],
          mode: 'all',
        };

  return SetMetadata(PERMISSIONS_KEY, requirement);
}
