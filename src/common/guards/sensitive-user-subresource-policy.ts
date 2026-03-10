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

const LEGACY_PERMISSION_BY_MODE: Record<SensitiveUserSubresourceMode, string> = {
  read: 'users:read_detail',
  update: 'users:update',
};

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
  return getSensitiveUserSubresourcePolicy(family, mode).legacyFallbackPermission;
}
