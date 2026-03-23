import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
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
   * Verify a TOTP code.
   * Used both to confirm enrollment and to satisfy an MFA step during login.
   *
   * @param userId - User's UUID from the SACDIA JWT.
   * @param code   - 6-digit TOTP code from the authenticator app.
   * @returns `{ verified: true }` on success; `{ verified: false }` on invalid code.
   * @throws UnauthorizedException when TOTP is not enrolled.
   */
  async verifyMfa(
    userId: string,
    code: string,
  ): Promise<{ verified: boolean }> {
    const { enabled } = await this.betterAuthService.hasTotpEnabled(userId);
    if (!enabled) {
      throw new UnauthorizedException(
        'TOTP is not enrolled for this user. Call POST /auth/mfa/enroll first.',
      );
    }

    const result = await this.betterAuthService.verifyTotp(userId, code);
    this.logger.log(`TOTP verification for user ${userId}: ${result.verified}`);
    return result;
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
