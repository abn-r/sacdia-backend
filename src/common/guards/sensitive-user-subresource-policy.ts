import type { PermissionKey } from '../authorization/generated/permission-keys';

export type SensitiveUserSubresourceFamily =
  | 'health'
  | 'emergency_contacts'
  | 'legal_representative'
  | 'post_registration';

export type SensitiveUserSubresourceMode = 'read' | 'update';

export type SensitiveUserSubresourcePolicy = {
  finePermission: PermissionKey;
  legacyFallbackPermission: PermissionKey;
};

export const LEGACY_PERMISSION_BY_MODE: Record<
  SensitiveUserSubresourceMode,
  PermissionKey
> = {
  read: 'users:read_detail',
  update: 'users:update_profile',
};

/**
 * Last day the users:* OR fallback remains canonical for third-party
 * sensitive subresources. After this date the fine family permission is
 * required. Owner self-service is unaffected.
 */
export const USERS_LEGACY_OR_SUNSET_DATE = '2027-03-31';

export function getSensitiveUserSubresourcePolicy(
  family: SensitiveUserSubresourceFamily,
  mode: SensitiveUserSubresourceMode,
): SensitiveUserSubresourcePolicy {
  return {
    // Cast, not `as const`: the post_registration + update pair is NOT in the
    // permission catalog (no caller uses it; only 'read' is wired). Narrowing it away here
    // would change the public family/mode types, so it is left for a follow-up.
    finePermission: `${family}:${mode}` as PermissionKey,
    legacyFallbackPermission: LEGACY_PERMISSION_BY_MODE[mode],
  };
}

export function getSensitiveUserSubresourceFallbackPermission(
  family: SensitiveUserSubresourceFamily,
  mode: SensitiveUserSubresourceMode,
): PermissionKey {
  return getSensitiveUserSubresourcePolicy(family, mode)
    .legacyFallbackPermission;
}
