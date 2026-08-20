export type SensitiveUserSubresourceFamily =
  | 'health'
  | 'emergency_contacts'
  | 'legal_representative'
  | 'post_registration';

export type SensitiveUserSubresourceMode = 'read' | 'update';

export type SensitiveUserSubresourcePolicy = {
  finePermission: string;
  legacyFallbackPermission: string;
};

export const LEGACY_PERMISSION_BY_MODE: Record<SensitiveUserSubresourceMode, string> =
  {
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
    finePermission: `${family}:${mode}`,
    legacyFallbackPermission: LEGACY_PERMISSION_BY_MODE[mode],
  };
}

export function getSensitiveUserSubresourceFallbackPermission(
  family: SensitiveUserSubresourceFamily,
  mode: SensitiveUserSubresourceMode,
): string {
  return getSensitiveUserSubresourcePolicy(family, mode)
    .legacyFallbackPermission;
}
