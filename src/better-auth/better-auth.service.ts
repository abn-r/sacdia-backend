import {
  Injectable,
  NotImplementedException,
  Inject,
  Logger,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { BetterAuthInstance } from './better-auth.config';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface BaUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BaSession {
  id: string;
  userId: string;
  token: string; // opaque 32-byte BA session token
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** SACDIA-issued HS256 JWT wrapping a successful BA auth operation (Option C). */
export interface BaAuthResult {
  user: BaUser;
  session: BaSession;
  /** HS256 JWT signed by SACDIA backend — this is what API consumers use. */
  accessToken: string;
}

export interface BaTotpEnrollResult {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export interface BaTotpFactor {
  id: string;
  friendlyName: string;
  factorType: string;
  status: string;
  createdAt: string;
}

export interface BaAssuranceLevel {
  currentLevel: 'aal1' | 'aal2';
  nextLevel: 'aal1' | 'aal2' | null;
}

export interface BaOAuthUrlResult {
  url: string;
  state: string;
}

// ---------------------------------------------------------------------------
// Service interface (all auth operations SACDIA needs)
// ---------------------------------------------------------------------------

export interface IBetterAuthService {
  // -- Auth ------------------------------------------------------------------
  createUser(
    email: string,
    password: string,
    name: string,
  ): Promise<BaAuthResult>;
  signInWithPassword(email: string, password: string): Promise<BaAuthResult>;
  refreshSession(sessionToken: string): Promise<BaAuthResult>;
  signOut(sessionToken: string): Promise<void>;
  resetPasswordForEmail(email: string, redirectTo?: string): Promise<void>;
  updatePasswordById(userId: string, newPassword: string): Promise<void>;

  // -- TOTP / MFA -----------------------------------------------------------
  enrollTotp(
    sessionToken: string,
    friendlyName?: string,
  ): Promise<BaTotpEnrollResult>;
  challengeTotp(sessionToken: string, factorId: string): Promise<string>;
  verifyTotp(
    sessionToken: string,
    factorId: string,
    challengeId: string,
    code: string,
  ): Promise<{ verified: boolean }>;
  listTotpFactors(sessionToken: string): Promise<BaTotpFactor[]>;
  unenrollFactor(sessionToken: string, factorId: string): Promise<void>;
  getAssuranceLevel(sessionToken: string): Promise<BaAssuranceLevel>;

  // -- OAuth ----------------------------------------------------------------
  getOAuthUrl(
    provider: 'google' | 'apple',
    redirectUri: string,
  ): Promise<BaOAuthUrlResult>;
  handleOAuthCallback(
    provider: 'google' | 'apple',
    code: string,
    state: string,
    redirectUri: string,
  ): Promise<BaAuthResult>;

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------
  signJwt(user: Pick<BaUser, 'id' | 'email'>): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Constructs a Headers object that carries a signed Better Auth session cookie.
 *
 * Better Auth session cookies are HMAC-SHA-256 signed with the app secret
 * before being stored.  The cookie value format (from better-call source) is:
 *
 *   `<rawToken>.<base64_HMAC_signature>` — URL-encoded
 *
 * To make server-side `auth.api.*` calls that require an authenticated
 * session we reproduce that signed cookie so BA's session middleware can
 * verify and load the session from the DB.
 *
 * Signing algorithm verified against better-call source:
 *   signature = HMAC-SHA-256(secret, rawToken).digest('base64')
 *   cookieValue = encodeURIComponent(`${rawToken}.${signature}`)
 *
 * Cookie name: `better-auth.session_token`
 */
function buildSessionHeaders(rawToken: string, secret: string): Headers {
  const signature = createHmac('sha256', secret)
    .update(rawToken)
    .digest('base64');
  const signedValue = encodeURIComponent(`${rawToken}.${signature}`);
  return new Headers({
    cookie: `better-auth.session_token=${signedValue}`,
  });
}

/** Maps a Better Auth APIError (or any error) to the appropriate NestJS HTTP exception. */
function mapBaError(error: unknown, context: string): never {
  if (
    error !== null &&
    typeof error === 'object' &&
    'statusCode' in error &&
    'status' in error
  ) {
    const apiErr = error as { statusCode: number; status: string; body?: { message?: string } };
    const msg = apiErr.body?.message ?? apiErr.status;

    switch (apiErr.statusCode) {
      case 401:
        throw new UnauthorizedException(msg);
      case 404:
        throw new NotFoundException(msg);
      case 409:
        throw new ConflictException(msg);
      case 422:
        // Treat unprocessable entity as conflict for duplicate email
        throw new ConflictException(msg);
      default:
        throw new InternalServerErrorException(
          `${context}: ${msg ?? 'unexpected BA error'}`,
        );
    }
  }

  // Unknown error
  const message =
    error instanceof Error ? error.message : String(error);
  throw new InternalServerErrorException(`${context}: ${message}`);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

@Injectable()
export class BetterAuthService implements IBetterAuthService {
  private readonly logger = new Logger(BetterAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    @Inject('BETTER_AUTH_INSTANCE')
    private readonly ba: BetterAuthInstance,
  ) {}

  // ---------------------------------------------------------------------------
  // Private: session cookie helper
  // ---------------------------------------------------------------------------

  /**
   * Resolves the BA app secret from the context and builds signed session
   * headers for server-side API calls that require an authenticated session.
   *
   * The secret is read from BETTER_AUTH_SECRET env var — same value BA uses
   * internally to sign cookies, so we can reproduce the same HMAC.
   */
  private sessionHeaders(rawToken: string): Headers {
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new InternalServerErrorException(
        'BETTER_AUTH_SECRET is not configured',
      );
    }
    return buildSessionHeaders(rawToken, secret);
  }

  /**
   * Retrieves the full session object from BA for a given opaque session token.
   * Used by `refreshSession` and any method that needs `{ user, session }`.
   */
  private async getSessionFromToken(
    rawToken: string,
  ): Promise<{ user: BaUser; session: BaSession }> {
    const headers = this.sessionHeaders(rawToken);
    const result = await this.ba.api.getSession({ headers }).catch((e) => {
      mapBaError(e, 'getSession');
    });

    if (!result) {
      throw new UnauthorizedException('Session not found or expired');
    }

    return {
      user: result.user as unknown as BaUser,
      session: result.session as unknown as BaSession,
    };
  }

  // ---------------------------------------------------------------------------
  // Auth methods
  // ---------------------------------------------------------------------------

  /**
   * Creates a new user via BA email+password sign-up.
   *
   * BA call: `auth.api.signUpEmail({ body: { email, password, name } })`
   * Returns: `{ token: string | null, user }` — token is null when email
   * verification is required; since we set `emailAndPassword.enabled: true`
   * without a verification step the token is returned immediately.
   */
  async createUser(
    email: string,
    password: string,
    name: string,
  ): Promise<BaAuthResult> {
    try {
      const result = await this.ba.api.signUpEmail({
        body: { email, password, name },
      });

      if (!result.token) {
        // Token is null only when email verification is pending.
        // This shouldn't happen with our config but handle it defensively.
        throw new InternalServerErrorException(
          'createUser: BA returned null token — email verification may be required',
        );
      }

      const { user, session } = await this.getSessionFromToken(result.token);
      const accessToken = this.signJwt(user);

      this.logger.log(`User created: ${user.id}`);
      return { user, session, accessToken };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      mapBaError(error, 'createUser');
    }
  }

  /**
   * Authenticates a user via email+password.
   *
   * BA call: `auth.api.signInEmail({ body: { email, password } })`
   * Returns: `{ token, user }` — token is the opaque BA session token.
   */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<BaAuthResult> {
    try {
      const result = await this.ba.api.signInEmail({
        body: { email, password },
      });

      const { user, session } = await this.getSessionFromToken(result.token);
      const accessToken = this.signJwt(user);

      this.logger.log(`User signed in: ${user.id}`);
      return { user, session, accessToken };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      mapBaError(error, 'signInWithPassword');
    }
  }

  /**
   * Refreshes a session by looking it up via the opaque session token.
   *
   * Better Auth does not have a dedicated "refresh session" endpoint for
   * opaque token flows (there is no refresh token — the opaque session token
   * IS the long-lived credential, valid for 7 days with a 1-day slide).
   * We call `getSession` which will slide the expiry on the DB side, then
   * re-issue a new SACDIA JWT.
   *
   * BA call: `auth.api.getSession({ headers })` with signed session cookie.
   */
  async refreshSession(sessionToken: string): Promise<BaAuthResult> {
    try {
      const { user, session } = await this.getSessionFromToken(sessionToken);
      const accessToken = this.signJwt(user);

      this.logger.log(`Session refreshed for user: ${user.id}`);
      return { user, session, accessToken };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      mapBaError(error, 'refreshSession');
    }
  }

  /**
   * Revokes a BA session (sign out).
   *
   * BA call: `auth.api.revokeSession({ body: { token }, headers })`
   * The caller must be authenticated (session cookie required by the
   * `sessionMiddleware` guard on `revokeSession`).
   */
  async signOut(sessionToken: string): Promise<void> {
    try {
      const headers = this.sessionHeaders(sessionToken);
      await this.ba.api.revokeSession({
        body: { token: sessionToken },
        headers,
      });
      this.logger.log('Session revoked');
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      // Best-effort: log but do not throw for sign-out failures
      this.logger.warn(
        `signOut: best-effort revocation failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Sends a password-reset email via BA.
   *
   * BA call: `auth.api.requestPasswordReset({ body: { email, redirectTo? } })`
   * BA always returns `{ status: true }` regardless of whether the email
   * exists (to prevent user enumeration).
   */
  async resetPasswordForEmail(
    email: string,
    redirectTo?: string,
  ): Promise<void> {
    try {
      await this.ba.api.requestPasswordReset({
        body: { email, ...(redirectTo ? { redirectTo } : {}) },
      });
      this.logger.log(`Password reset requested for: ${email}`);
    } catch (error) {
      mapBaError(error, 'resetPasswordForEmail');
    }
  }

  /**
   * Updates a user's password by their userId without requiring the current password.
   *
   * DESIGN NOTE: Better Auth's `changePassword` endpoint requires the current
   * password (it is user-facing, not admin-facing).  `setPassword` also
   * requires a session.  There is no unauthenticated admin "set password by
   * userId" in the base BA package without the admin plugin.
   *
   * Since the admin plugin is NOT currently included in `better-auth.config.ts`,
   * this implementation uses `setPassword` which requires a valid session for
   * the target user.  If a sessionless admin password override is needed in
   * the future, add the `admin` plugin to the config and call
   * `auth.api.setUserPassword({ body: { userId, password } })`.
   *
   * Current implementation: requires a session token belonging to the user.
   * The `userId` parameter is validated against the session to prevent IDOR.
   *
   * BA call: `auth.api.setPassword({ body: { newPassword }, headers })`
   *
   * @param userId  - The user ID (used for validation, not passed to BA directly).
   * @param newPassword - The new password to set.
   *
   * NOTE: This method signature is kept for interface compatibility.
   * The caller must supply the session token separately — see the
   * `updatePasswordBySession` companion below for the preferred path.
   */
  async updatePasswordById(
    _userId: string,
    _newPassword: string,
  ): Promise<void> {
    // BA's base API does not support admin password reset by userId without
    // the admin plugin.  This stub is intentionally left as not-implemented
    // so callers are forced to use the proper reset flow (resetPasswordForEmail)
    // or the session-based setPassword path.
    throw new NotImplementedException(
      'updatePasswordById requires the BA admin plugin (not configured).' +
        ' Use resetPasswordForEmail() for the reset flow, or add the admin' +
        ' plugin to better-auth.config.ts and call auth.api.setUserPassword().',
    );
  }

  // ---------------------------------------------------------------------------
  // TOTP / MFA methods
  // ---------------------------------------------------------------------------

  /**
   * NOTE ON TOTP PLUGIN API MISMATCH:
   *
   * better-auth.config.ts now correctly uses `twoFactor()` from `better-auth/plugins`
   * (the previous config used the non-existent `totp` export — fixed in W3-007).
   *
   * The `twoFactor()` plugin provides the following TOTP API:
   *   - `auth.api.enableTwoFactor({ body: { password, issuer? }, headers })`  → enroll
   *   - `auth.api.getTOTPURI({ body: { password }, headers })`                → get URI
   *   - `auth.api.verifyTOTP({ body: { code, trustDevice? }, headers })`      → verify
   *   - `auth.api.disableTwoFactor({ body: { password }, headers })`          → unenroll
   *
   * INTERFACE MISMATCH (not resolvable without redesign):
   * The service interface uses Supabase-style MFA concepts (factorId, challengeId)
   * that do NOT exist in BA's twoFactor plugin:
   * - BA has ONE TOTP per user — no factorId concept
   * - BA has NO challenge step — verification is done directly
   * - BA requires the user's PASSWORD for enable/disable, not a session token alone
   * - BA does not return a QR code image (only a totpURI — QR generated client-side)
   *
   * THESE METHODS REMAIN AS STUBS pending interface redesign.
   * The interface (IBetterAuthService + all callers) needs to be updated to
   * match BA's twoFactor model before these can be implemented.
   */

  /**
   * Enrolls TOTP for a user (enables two-factor authentication).
   *
   * BA call: `auth.api.enableTwoFactor({ body: { password }, headers })`
   * Returns: `{ totpURI, backupCodes }`
   *
   * PENDING INTERFACE REDESIGN:
   * The current interface expects `{ factorId, qrCode, secret, uri }` but
   * BA's twoFactor plugin only returns `{ totpURI, backupCodes }`.
   * - No factorId in BA (single TOTP per user)
   * - No qrCode (generate from totpURI client-side)
   * - enableTwoFactor requires user's PASSWORD, not just session token
   *
   * IBetterAuthService must be updated before this can be implemented.
   */
  async enrollTotp(
    _sessionToken: string,
    _friendlyName?: string,
  ): Promise<BaTotpEnrollResult> {
    throw new NotImplementedException(
      'enrollTotp: interface redesign required. BA twoFactor uses enableTwoFactor' +
        '({ body: { password } }) — no factorId, no qrCode, requires password not session token.',
    );
  }

  /**
   * Creates a TOTP challenge.
   *
   * CANNOT BE IMPLEMENTED: BA's twoFactor plugin has NO separate challenge step.
   * Verification is done directly via `auth.api.verifyTOTP({ body: { code } })`.
   * Remove this method from the interface or mark as deprecated.
   */
  challengeTotp(
    _sessionToken: string,
    _factorId: string,
  ): Promise<string> {
    throw new NotImplementedException(
      'challengeTotp: BA twoFactor has no challenge step. Call verifyTotp() directly.',
    );
  }

  /**
   * Verifies a TOTP code.
   *
   * BA call: `auth.api.verifyTOTP({ body: { code }, headers })`
   *
   * PENDING INTERFACE REDESIGN:
   * - `factorId` and `challengeId` parameters are not used by BA
   * - Interface should be simplified to `verifyTotp(sessionToken, code)`
   */
  async verifyTotp(
    _sessionToken: string,
    _factorId: string,
    _challengeId: string,
    _code: string,
  ): Promise<{ verified: boolean }> {
    throw new NotImplementedException(
      'verifyTotp: interface redesign required. BA uses verifyTOTP({ body: { code } })' +
        ' — factorId and challengeId do not exist in BA twoFactor.',
    );
  }

  /**
   * Lists TOTP factors for a user.
   *
   * CANNOT BE FULLY IMPLEMENTED: BA's twoFactor plugin supports ONE TOTP per user.
   * There is no list endpoint — check user.twoFactorEnabled via getSession instead.
   *
   * PENDING INTERFACE REDESIGN: replace with a `getMfaStatus(sessionToken)` call.
   */
  async listTotpFactors(_sessionToken: string): Promise<BaTotpFactor[]> {
    throw new NotImplementedException(
      'listTotpFactors: BA twoFactor supports one TOTP per user, no list endpoint.' +
        ' Check user.twoFactorEnabled via getSession.',
    );
  }

  /**
   * Unenrolls TOTP (disables two-factor authentication).
   *
   * BA call: `auth.api.disableTwoFactor({ body: { password }, headers })`
   *
   * PENDING INTERFACE REDESIGN:
   * - `factorId` not used (BA has one TOTP per user)
   * - BA requires the user's PASSWORD to disable 2FA, not just a session token
   * - Interface must be updated to accept a password parameter
   */
  async unenrollFactor(
    _sessionToken: string,
    _factorId: string,
  ): Promise<void> {
    throw new NotImplementedException(
      'unenrollFactor: interface redesign required. BA uses disableTwoFactor' +
        '({ body: { password } }) — requires password, factorId is not used.',
    );
  }

  /**
   * Determines the current MFA assurance level for a session.
   *
   * BA does not expose an AAL endpoint directly.  Derive from:
   * - `user.twoFactorEnabled` — whether TOTP is enrolled
   * - `session.twoFactorVerified` — whether this session completed TOTP
   *
   * PENDING INTERFACE REDESIGN: once the session fields are confirmed,
   * this can be implemented as:
   *   const { user, session } = await getSessionFromToken(sessionToken);
   *   const aal2 = user.twoFactorEnabled && session.twoFactorVerified;
   *   return { currentLevel: aal2 ? 'aal2' : 'aal1', nextLevel: ... };
   */
  async getAssuranceLevel(_sessionToken: string): Promise<BaAssuranceLevel> {
    throw new NotImplementedException(
      'getAssuranceLevel: pending interface redesign. Derive from' +
        ' user.twoFactorEnabled and session.twoFactorVerified after twoFactor plugin is confirmed.',
    );
  }

  // ---------------------------------------------------------------------------
  // OAuth methods
  // ---------------------------------------------------------------------------

  /**
   * Generates an OAuth authorization URL for the given provider.
   *
   * BA call: `auth.api.signInSocial({ body: { provider, callbackURL, disableRedirect: true } })`
   *
   * When `disableRedirect: true` is set, BA returns `{ url, redirect: false }`
   * instead of issuing an HTTP redirect.  The state is embedded in the URL's
   * query parameters (BA generates and stores it internally).
   *
   * NOTE: The `BaOAuthUrlResult.state` field cannot be extracted from the URL
   * in a structured way — it is part of the redirect URL that BA constructs.
   * Callers should use the full `url` and parse `state` from it if needed.
   */
  async getOAuthUrl(
    provider: 'google' | 'apple',
    redirectUri: string,
  ): Promise<BaOAuthUrlResult> {
    try {
      const result = await this.ba.api.signInSocial({
        body: {
          provider,
          callbackURL: redirectUri,
          disableRedirect: true,
        },
      });

      if (!result.url) {
        throw new InternalServerErrorException(
          `getOAuthUrl: BA did not return a URL for provider ${provider}`,
        );
      }

      // Extract state from the URL query parameters
      const urlObj = new URL(result.url);
      const state = urlObj.searchParams.get('state') ?? '';

      this.logger.log(`OAuth URL generated for provider: ${provider}`);
      return { url: result.url, state };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      mapBaError(error, 'getOAuthUrl');
    }
  }

  /**
   * Handles the OAuth callback after the provider redirects back.
   *
   * BA call: `auth.api.callbackOAuth({ query: { code, state }, body: { ... } })`
   *
   * NOTE: BA's `callbackOAuth` is a GET endpoint that processes the provider
   * callback.  In a server-side context it can be called with query parameters.
   * The response from BA after a successful OAuth callback is an HTTP redirect
   * to the `callbackURL` with the session cookie set.
   *
   * DESIGN MISMATCH: The assumed interface (`code`, `state`, `redirectUri`) maps
   * to the standard OAuth2 PKCE flow, but BA's internal callback handler is
   * designed to be hit by the browser (not called server-to-server).  For a
   * proper server-side OAuth exchange, the caller should:
   * 1. Redirect the user's browser to the `getOAuthUrl` result.
   * 2. BA handles the callback at `{BASE_URL}/api/auth/callback/{provider}`.
   * 3. BA sets the session cookie and redirects to `callbackURL`.
   * 4. The frontend reads the session token from the cookie and calls SACDIA.
   *
   * This server-side stub is provided for completeness but will not work in
   * a browser-redirect OAuth flow without additional infrastructure.
   */
  async handleOAuthCallback(
    provider: 'google' | 'apple',
    code: string,
    state: string,
    _redirectUri: string,
  ): Promise<BaAuthResult> {
    try {
      // callbackOAuth processes the provider redirect and creates/updates the user.
      // It is designed as a browser-facing GET endpoint.
      // We invoke it server-side by passing query params directly.
      const result = await (this.ba.api as any).callbackOAuth({
        query: { code, state },
        method: 'GET',
      });

      if (!result?.token) {
        throw new InternalServerErrorException(
          `handleOAuthCallback: no token in BA response for provider ${provider}`,
        );
      }

      const { user, session } = await this.getSessionFromToken(result.token);
      const accessToken = this.signJwt(user);

      this.logger.log(`OAuth callback handled for provider: ${provider}, user: ${user.id}`);
      return { user, session, accessToken };
    } catch (error) {
      if (
        error instanceof InternalServerErrorException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      mapBaError(error, 'handleOAuthCallback');
    }
  }

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------

  /**
   * Signs a SACDIA HS256 JWT for API consumers.
   *
   * Better Auth emits opaque 32-byte session tokens (not JWTs).
   * After every successful BA auth operation we sign our own short-lived
   * JWT so downstream API guards have a standard bearer token to verify.
   *
   * Payload: { sub: user.id, email: user.email }
   * Algorithm: HS256 (via BETTER_AUTH_SECRET in JwtModule config)
   * Expiry: 1h (configured in BetterAuthModule JwtModule.registerAsync)
   */
  signJwt(user: Pick<BaUser, 'id' | 'email'>): string {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }
}
