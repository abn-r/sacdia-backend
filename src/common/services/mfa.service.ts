import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import type { BetterAuthInstance } from '../../better-auth/better-auth.config';

// ---------------------------------------------------------------------------
// Response types aligned with Better Auth twoFactor plugin
// ---------------------------------------------------------------------------

/**
 * Returned by enrollMfa.
 * The client is responsible for generating a QR code image from `totpURI`.
 * No factorId concept exists in BA — there is ONE TOTP per user.
 */
export interface MfaEnrollResponse {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Represents whether 2FA is enabled for the current user.
 * Replaces the old MfaFactor array — BA has at most one TOTP per user.
 */
export interface MfaStatus {
  enabled: boolean;
}

export interface MfaAssuranceLevel {
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2' | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reproduces the signed BA session cookie so server-side `auth.api.*` calls
 * can authenticate the session.  Mirrors the logic in BetterAuthService
 * (which keeps `sessionHeaders` private — MfaService builds its own copy).
 *
 * Cookie format: `better-auth.session_token=<encoded(rawToken.base64(HMAC))>`
 */
function buildSessionHeaders(rawToken: string): Headers {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new InternalServerErrorException('BETTER_AUTH_SECRET is not configured');
  }
  const signature = createHmac('sha256', secret).update(rawToken).digest('base64');
  const signedValue = encodeURIComponent(`${rawToken}.${signature}`);
  return new Headers({ cookie: `better-auth.session_token=${signedValue}` });
}

/**
 * Normalizes an unknown BA error into a user-facing NestJS exception.
 */
function mapBaError(error: unknown, context: string): never {
  if (
    error !== null &&
    typeof error === 'object' &&
    'statusCode' in error &&
    'status' in error
  ) {
    const apiErr = error as {
      statusCode: number;
      status: string;
      body?: { message?: string };
    };
    const msg = apiErr.body?.message ?? apiErr.status;
    if (apiErr.statusCode === 401) throw new UnauthorizedException(msg);
    throw new InternalServerErrorException(`${context}: ${msg}`);
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new InternalServerErrorException(`${context}: ${message}`);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * MfaService — Autenticación de Dos Factores con Better Auth twoFactor plugin.
 *
 * Better Auth model (fundamentally different from Supabase MFA):
 * - ONE TOTP per user — no factorId concept.
 * - No challenge step — verify directly with the 6-digit code.
 * - Enroll (enable) and unenroll (disable) both require the user's PASSWORD.
 * - Returns `{ totpURI, backupCodes }` — the client generates the QR image.
 * - AAL is derived from `user.twoFactorEnabled` + `session.twoFactorVerified`.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    @Inject('BETTER_AUTH_INSTANCE')
    private readonly ba: BetterAuthInstance,
  ) {}

  // ---------------------------------------------------------------------------
  // Enroll
  // ---------------------------------------------------------------------------

  /**
   * Enable TOTP 2FA for the authenticated user.
   *
   * BA call: `auth.api.enableTwoFactor({ body: { password }, headers })`
   *
   * @param sessionToken - Opaque BA session token (from `x-session-token` header).
   * @param password     - User's current password (required by BA for security).
   * @returns `{ totpURI, backupCodes }` — client generates QR from `totpURI`.
   */
  async enrollMfa(
    sessionToken: string,
    password: string,
  ): Promise<MfaEnrollResponse> {
    try {
      const headers = buildSessionHeaders(sessionToken);
      const result = await (this.ba.api as any).enableTwoFactor({
        body: { password },
        headers,
      });

      if (!result?.totpURI) {
        throw new InternalServerErrorException(
          'enrollMfa: BA did not return totpURI',
        );
      }

      this.logger.log('TOTP 2FA enrollment completed');
      return {
        totpURI: result.totpURI,
        backupCodes: result.backupCodes ?? [],
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      mapBaError(error, 'enrollMfa');
    }
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  /**
   * Verify a TOTP code.
   * Used both to activate 2FA after enrollment and to satisfy an MFA challenge
   * during login (elevating the session from aal1 to aal2).
   *
   * BA call: `auth.api.verifyTOTP({ body: { code }, headers })`
   *
   * @param sessionToken - Opaque BA session token.
   * @param code         - 6-digit TOTP code from the authenticator app.
   * @returns `{ verified: true }` on success; throws UnauthorizedException on failure.
   */
  async verifyMfa(
    sessionToken: string,
    code: string,
  ): Promise<{ verified: boolean }> {
    try {
      const headers = buildSessionHeaders(sessionToken);
      await (this.ba.api as any).verifyTOTP({
        body: { code },
        headers,
      });

      this.logger.log('TOTP verification successful');
      return { verified: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      // BA returns 401 for invalid code — mapBaError converts it
      if (
        error !== null &&
        typeof error === 'object' &&
        'statusCode' in error &&
        (error as any).statusCode === 401
      ) {
        throw new UnauthorizedException('Invalid MFA code');
      }
      if (error instanceof InternalServerErrorException) throw error;
      mapBaError(error, 'verifyMfa');
    }
  }

  // ---------------------------------------------------------------------------
  // Disable / unenroll
  // ---------------------------------------------------------------------------

  /**
   * Disable TOTP 2FA for the authenticated user.
   *
   * BA call: `auth.api.disableTwoFactor({ body: { password }, headers })`
   *
   * @param sessionToken - Opaque BA session token.
   * @param password     - User's current password (required by BA for security).
   */
  async disableMfa(sessionToken: string, password: string): Promise<void> {
    try {
      const headers = buildSessionHeaders(sessionToken);
      await (this.ba.api as any).disableTwoFactor({
        body: { password },
        headers,
      });

      this.logger.log('TOTP 2FA disabled');
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      mapBaError(error, 'disableMfa');
    }
  }

  // ---------------------------------------------------------------------------
  // Status / AAL
  // ---------------------------------------------------------------------------

  /**
   * Returns whether the user has 2FA enabled.
   *
   * Derived from the session — BA stores `twoFactorEnabled` on the user object
   * returned by `getSession`.
   *
   * @param sessionToken - Opaque BA session token.
   */
  async getMfaStatus(sessionToken: string): Promise<MfaStatus> {
    try {
      const headers = buildSessionHeaders(sessionToken);
      const result = await this.ba.api.getSession({ headers });

      if (!result) {
        throw new UnauthorizedException('Session not found or expired');
      }

      const user = result.user as any;
      return { enabled: !!user?.twoFactorEnabled };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (error instanceof InternalServerErrorException) throw error;
      mapBaError(error, 'getMfaStatus');
    }
  }

  /**
   * Derives the MFA assurance level for the current session.
   *
   * Logic:
   * - aal2 → `user.twoFactorEnabled === true` AND `session.twoFactorVerified === true`
   * - aal1 → everything else
   * - nextLevel → 'aal2' when TOTP is enrolled but this session hasn't verified yet
   *
   * @param sessionToken - Opaque BA session token.
   */
  async getAssuranceLevel(sessionToken: string): Promise<MfaAssuranceLevel> {
    try {
      const headers = buildSessionHeaders(sessionToken);
      const result = await this.ba.api.getSession({ headers });

      if (!result) {
        return { currentLevel: 'aal1', nextLevel: null };
      }

      const user = result.user as any;
      const session = result.session as any;

      const mfaEnrolled = !!user?.twoFactorEnabled;
      const mfaVerified = !!session?.twoFactorVerified;

      if (mfaEnrolled && mfaVerified) {
        return { currentLevel: 'aal2', nextLevel: null };
      }

      if (mfaEnrolled && !mfaVerified) {
        return { currentLevel: 'aal1', nextLevel: 'aal2' };
      }

      return { currentLevel: 'aal1', nextLevel: null };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      // Degrade gracefully — return aal1 on unexpected errors
      this.logger.warn(
        `getAssuranceLevel: unexpected error — ${error instanceof Error ? error.message : String(error)}`,
      );
      return { currentLevel: 'aal1', nextLevel: null };
    }
  }
}
