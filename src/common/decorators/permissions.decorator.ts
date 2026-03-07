import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

export type PermissionMode = 'all' | 'any';

export type PermissionRequirement = {
  permissions: string[];
  mode: PermissionMode;
};

export function RequirePermissions(
  ...permissions: string[]
): ClassDecorator & MethodDecorator;
export function RequirePermissions(
  requirement: PermissionRequirement,
): ClassDecorator & MethodDecorator;
export function RequirePermissions(
  ...args: [PermissionRequirement] | string[]
): ClassDecorator & MethodDecorator {
  const requirement =
    typeof args[0] === 'object' && !Array.isArray(args[0])
      ? args[0]
      : {
          permissions: args as string[],
          mode: 'all' as PermissionMode,
        };

  return SetMetadata(PERMISSIONS_KEY, requirement);
}
