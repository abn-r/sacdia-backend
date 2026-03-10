import { SetMetadata, applyDecorators } from '@nestjs/common';
import { AuthorizationResource } from './authorization-resource.decorator';
import { RequirePermissions } from './permissions.decorator';
import {
  getSensitiveUserSubresourcePolicy,
  type SensitiveUserSubresourceFamily,
  type SensitiveUserSubresourceMode,
} from '../guards/sensitive-user-subresource-policy';

export const SENSITIVE_USER_SUBRESOURCE_KEY = 'sensitive_user_subresource';

export type SensitiveUserSubresourceMetadata = {
  family: SensitiveUserSubresourceFamily;
  mode: SensitiveUserSubresourceMode;
};

export function SensitiveUserSubresource(
  family: SensitiveUserSubresourceFamily,
  mode: SensitiveUserSubresourceMode,
  options?: {
    ownerParam?: string;
  },
): ClassDecorator & MethodDecorator {
  const policy = getSensitiveUserSubresourcePolicy(family, mode);

  return applyDecorators(
    SetMetadata(SENSITIVE_USER_SUBRESOURCE_KEY, { family, mode }),
    RequirePermissions(policy.finePermission),
    AuthorizationResource({
      type: 'user',
      ownerParam: options?.ownerParam ?? 'userId',
    }),
  );
}
