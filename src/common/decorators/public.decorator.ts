import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or whole controller) as exempt from the global JwtAuthGuard.
 *
 * Use ONLY for endpoints that are intentionally anonymous:
 * - auth entry points (login, register, refresh, OAuth, password reset)
 * - the public health ping
 * - catalog-style endpoints guarded locally by OptionalJwtAuthGuard
 * - the one-time RBAC bootstrap (protected by x-bootstrap-secret)
 *
 * Everything else is authenticated by default via APP_GUARD.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
