import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Key used to mark an endpoint as MFA-exempt via @SkipMfaCheck().
 * Apply to the MFA verify endpoint and any other public/pre-auth routes.
 */
export const SKIP_MFA_CHECK_KEY = 'skipMfaCheck';

/**
 * MfaGuard — enforces aal2 authentication level for protected routes.
 *
 * If a JWT carries `mfa_pending: true`, it means the user authenticated
 * with a password (aal1) but has TOTP enrolled and has not yet verified
 * the second factor. This guard rejects such tokens with 403 Forbidden.
 *
 * ## Usage
 * Add `@UseGuards(JwtAuthGuard, MfaGuard)` to any route or controller that
 * requires full two-factor authentication. JwtAuthGuard must run first to
 * populate `req.user`.
 *
 * ## Exempt routes
 * Use `@SkipMfaCheck()` on routes that must be accessible with an aal1 token:
 *   - POST /auth/mfa/verify  (the MFA verify endpoint itself)
 *   - POST /auth/logout      (should always be reachable)
 *   - POST /auth/refresh     (should always be reachable)
 *
 * Note: This guard should be applied selectively, not registered globally,
 * to avoid blocking currently authenticated users with existing aal1 tokens
 * until a proper migration strategy is in place.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if this specific handler or class is marked as MFA-exempt
    const skipMfaCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_MFA_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipMfaCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as
      | { mfa_pending?: boolean }
      | undefined;

    // If there is no authenticated user at this point, let JwtAuthGuard handle it
    if (!user) {
      return true;
    }

    if (user.mfa_pending === true) {
      throw new ForbiddenException(
        'MFA verification required. Please complete TOTP verification at POST /auth/mfa/verify.',
      );
    }

    return true;
  }
}
