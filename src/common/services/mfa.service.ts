import { Injectable, Logger } from '@nestjs/common';
import { AppUnauthorizedException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { BetterAuthService } from '../../better-auth/better-auth.service';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

/**
 * Returned by enrollMfa.
 * The client is responsible for generating a QR code image from `totpURI`.
 * There is ONE TOTP per user — no factorId concept.
 */
export interface MfaEnrollResponse {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Represents whether 2FA is enabled for the current user.
 */
export interface MfaStatus {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * MfaService — Autenticación de Dos Factores via direct Prisma + otplib.
 *
 * Design:
 * - ONE TOTP per user — no factorId concept.
 * - No challenge step — verify directly with the 6-digit code.
 * - Enroll (enable) and disable both require the user's PASSWORD.
 * - TOTP secrets stored in the `verification` table with identifier = `totp:{userId}`.
 * - Backup codes: 10 random 8-char codes, bcrypt-hashed in DB, plain returned once.
 * - All operations identified by userId from the SACDIA JWT (req.user.userId).
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(private readonly betterAuthService: BetterAuthService) {}

  // ---------------------------------------------------------------------------
  // Enroll
  // ---------------------------------------------------------------------------

  /**
   * Enable TOTP 2FA for the authenticated user.
   *
   * @param userId   - User's UUID from the SACDIA JWT (req.user.userId).
   * @param password - User's current password (required for security).
   * @returns `{ totpURI, backupCodes }` — client generates QR from `totpURI`.
   *          backupCodes are shown ONCE — they are hashed in the DB.
   */
  async enrollMfa(
    userId: string,
    password: string,
  ): Promise<MfaEnrollResponse> {
    const result = await this.betterAuthService.enrollTotp(userId, password);
    this.logger.log(`TOTP enrollment completed for user: ${userId}`);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  /**
   * Verify a TOTP code and, on success, issue a full aal2 JWT.
   *
   * This endpoint is intended to be called after a password-only login when the
   * user has MFA enrolled. The caller provides the aal1 token (mfa_pending: true)
   * in the Authorization header and a 6-digit TOTP code in the body. On success
   * a new JWT without `mfa_pending` is returned, granting full aal2 access.
   *
   * @param userId     - User's UUID from the SACDIA JWT (populated by JwtAuthGuard).
   * @param email      - User's email from the SACDIA JWT (needed to re-sign).
   * @param code       - 6-digit TOTP code from the authenticator app.
   * @param sessionId  - BA session row ID from the aal1 JWT `sid` claim. When present,
   *                     it is forwarded to `signJwt` so the resulting aal2 token
   *                     preserves the `sid` claim and GET /auth/sessions can correctly
   *                     mark `is_current`. Null/undefined for legacy tokens.
   * @returns `{ verified: true, accessToken }` on success;
   *          `{ verified: false }` on invalid TOTP code.
   * @throws UnauthorizedException when TOTP is not enrolled.
   */
  async verifyMfa(
    userId: string,
    email: string,
    code: string,
    sessionId?: string | null,
  ): Promise<{ verified: boolean; accessToken?: string }> {
    const { enabled } = await this.betterAuthService.hasTotpEnabled(userId);
    if (!enabled) {
      throw new AppUnauthorizedException(ErrorCode.MFA_CODE_INVALID);
    }

    const result = await this.betterAuthService.verifyTotp(userId, code);
    this.logger.log(`TOTP verification for user ${userId}: ${result.verified}`);

    if (!result.verified) {
      return { verified: false };
    }

    // Issue a full aal2 JWT (no mfa_pending flag) to replace the aal1 token.
    // Forward sessionId so the new token preserves the `sid` claim — this is
    // what allows GET /auth/sessions to correctly mark `is_current`.
    const accessToken = this.betterAuthService.signJwt(
      { id: userId, email },
      false,
      sessionId ?? undefined,
    );

    this.logger.log(
      `MFA verification complete (aal2 token issued) for user: ${userId}`,
    );

    return { verified: true, accessToken };
  }

  // ---------------------------------------------------------------------------
  // Disable / unenroll
  // ---------------------------------------------------------------------------

  /**
   * Disable TOTP 2FA for the authenticated user.
   *
   * @param userId   - User's UUID from the SACDIA JWT.
   * @param password - User's current password (required for security).
   */
  async disableMfa(userId: string, password: string): Promise<void> {
    await this.betterAuthService.disableTotp(userId, password);
    this.logger.log(`TOTP disabled for user: ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /**
   * Returns whether the user has 2FA enrolled.
   *
   * @param userId - User's UUID from the SACDIA JWT.
   */
  async getMfaStatus(userId: string): Promise<MfaStatus> {
    const { enabled } = await this.betterAuthService.hasTotpEnabled(userId);
    return { enabled };
  }
}
