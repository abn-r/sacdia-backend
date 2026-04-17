import { SetMetadata } from '@nestjs/common';
import { SKIP_MFA_CHECK_KEY } from '../guards/mfa.guard';

/**
 * @SkipMfaCheck() — Marks a route handler or controller as exempt from MfaGuard.
 *
 * Apply to any endpoint that must be accessible when the user has `mfa_pending: true`
 * in their JWT (i.e. they have authenticated with password but not yet verified TOTP).
 *
 * Example:
 *   @Post('verify')
 *   @UseGuards(JwtAuthGuard, MfaGuard)
 *   @SkipMfaCheck()
 *   async verifyMfa(...) { ... }
 */
export const SkipMfaCheck = () => SetMetadata(SKIP_MFA_CHECK_KEY, true);
