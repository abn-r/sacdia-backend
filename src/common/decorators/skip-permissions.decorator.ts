import { SetMetadata } from '@nestjs/common';

export const SKIP_PERMISSIONS_KEY = 'skipPermissions';

/**
 * Opt-out of the global PermissionsGuard.
 *
 * Use only when JWT (or @Public) is the intended lock:
 * - auth/session/MFA/OAuth self-service
 * - post-registration club picker
 * - inbox/FCM/own QR/dashboard identity
 * - GlobalRoles-only admin surfaces that do not speak the permission catalog
 *
 * A new authenticated endpoint without @RequirePermissions, @Public or
 * @SkipPermissions fails closed (GUARD_RBAC_MISCONFIGURATION).
 */
export const SkipPermissions = () => SetMetadata(SKIP_PERMISSIONS_KEY, true);
