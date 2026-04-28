import {
  Injectable,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppConflictException,
  AppInternalServerErrorException,
  AppNotFoundException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID, randomBytes } from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import type { BetterAuthInstance } from './better-auth.config';
import { maskEmail } from '../common/utils/mask-email.util';
import { EmailService } from '../common/email/email.service';

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
  token: string; // opaque 32-byte session token
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** SACDIA-issued HS256 JWT wrapping a successful auth operation (Option C). */
export interface BaAuthResult {
  user: BaUser;
  session: BaSession;
  /** HS256 JWT signed by SACDIA backend — this is what API consumers use. */
  accessToken: string;
}

/** Returned by enrollTotp — client generates QR from totpURI. */
export interface BaTotpEnrollResult {
  totpURI: string;
  backupCodes: string[];
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
  enrollTotp(userId: string, password: string): Promise<BaTotpEnrollResult>;
  verifyTotp(userId: string, code: string): Promise<{ verified: boolean }>;
  disableTotp(userId: string, password: string): Promise<void>;
  hasTotpEnabled(userId: string): Promise<{ enabled: boolean }>;

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
  signJwt(
    user: Pick<BaUser, 'id' | 'email'>,
    mfaPending?: boolean,
    sessionId?: string,
  ): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Session duration: 7 days in ms */
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Bcrypt cost factor */
const BCRYPT_ROUNDS = 12;

/** Generate a URL-safe random token (32 bytes = 43 base64url chars). */
function generateToken(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(32).toString('base64url');
}

/**
 * Maps a Prisma `users` record to the `BaUser` shape used across the service.
 * Uses our schema field names: user_id, email_verified, user_image, created_at, modified_at.
 */
function mapDbUserToBaUser(dbUser: {
  user_id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  user_image?: string | null;
  created_at: Date;
  modified_at: Date;
}): BaUser {
  return {
    id: dbUser.user_id,
    email: dbUser.email,
    name: dbUser.name ?? '',
    emailVerified: dbUser.email_verified,
    image: dbUser.user_image ?? null,
    createdAt: dbUser.created_at,
    updatedAt: dbUser.modified_at,
  };
}

/**
 * Maps a Prisma `session` record to the `BaSession` shape used across the service.
 */
function mapDbSessionToBaSession(dbSession: {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): BaSession {
  return {
    id: dbSession.id,
    userId: dbSession.userId,
    token: dbSession.token,
    expiresAt: dbSession.expiresAt,
    createdAt: dbSession.createdAt,
    updatedAt: dbSession.updatedAt,
    ipAddress: dbSession.ipAddress ?? null,
    userAgent: dbSession.userAgent ?? null,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

@Injectable()
export class BetterAuthService implements IBetterAuthService {
  private readonly logger = new Logger(BetterAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    // Keep the BA instance injected for OAuth and TOTP (future use)
    @Inject('BETTER_AUTH_INSTANCE')
    private readonly ba: BetterAuthInstance,
    private readonly emailService: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates a new session row in the DB for the given userId.
   * Returns the session record mapped to BaSession.
   */
  private async createSession(userId: string): Promise<BaSession> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
    const dbSession = await this.prisma.session.create({
      data: {
        id: randomUUID(),
        token: generateToken(),
        userId,
        expiresAt,
      },
    });
    return mapDbSessionToBaSession(dbSession);
  }

  // ---------------------------------------------------------------------------
  // Auth methods
  // ---------------------------------------------------------------------------

  /**
   * Creates a new user via direct Prisma writes — bypasses BA's Prisma adapter
   * which does NOT correctly map field names for WRITE operations (e.g. sends
   * `id` instead of `user_id`, `emailVerified` instead of `email_verified`).
   *
   * Flow:
   *   1. Check for duplicate email → ConflictException
   *   2. Hash password with bcrypt (cost 12)
   *   3. Insert `users` row with proper snake_case fields
   *   4. Insert `account` row (credential provider)
   *   5. Insert `session` row
   *   6. Sign SACDIA JWT
   */
  async createUser(
    email: string,
    password: string,
    name: string,
  ): Promise<BaAuthResult> {
    // 1. Duplicate email check
    const existing = await this.prisma.users.findUnique({ where: { email } });
    if (existing) {
      throw new AppConflictException(ErrorCode.AUTH_EMAIL_ALREADY_IN_USE);
    }

    // 2. Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // 3. Create user — use crypto.randomUUID() to generate proper UUID v4
    const userId = randomUUID();
    const dbUser = await this.prisma.users.create({
      data: {
        user_id: userId,
        email,
        name,
        email_verified: false,
      },
    });

    // 4. Create credential account
    await this.prisma.account.create({
      data: {
        id: randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password: hashedPassword,
      },
    });

    // 5. Create session
    const session = await this.createSession(userId);

    const user = mapDbUserToBaUser(dbUser);
    const accessToken = this.signJwt(user, false, session.id);

    this.logger.log(`User created: ${user.id}`);
    return { user, session, accessToken };
  }

  /**
   * Authenticates a user via email+password — direct Prisma lookup.
   *
   * Flow:
   *   1. Find user by email → NotFoundException if missing
   *   2. Find credential account → UnauthorizedException if missing
   *   3. bcrypt.compare → UnauthorizedException if mismatch
   *   4. Create session → sign JWT → return BaAuthResult
   */
  async signInWithPassword(
    email: string,
    password: string,
  ): Promise<BaAuthResult> {
    // 1. Find user
    const dbUser = await this.prisma.users.findUnique({ where: { email } });
    if (!dbUser) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // 2. Find credential account
    const dbAccount = await this.prisma.account.findFirst({
      where: { userId: dbUser.user_id, providerId: 'credential' },
    });
    if (!dbAccount || !dbAccount.password) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // 3. Verify password
    const isValid = await bcrypt.compare(password, dbAccount.password);
    if (!isValid) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // 4. Check MFA enrollment — if TOTP is active, issue a restricted token
    //    with mfa_pending: true. The client must call POST /auth/mfa/verify to
    //    obtain a full aal2 token. MfaGuard blocks protected endpoints while
    //    mfa_pending is true.
    const { enabled: mfaEnabled } = await this.hasTotpEnabled(dbUser.user_id);

    // 5. Create session + sign JWT
    const session = await this.createSession(dbUser.user_id);
    const user = mapDbUserToBaUser(dbUser);
    const accessToken = this.signJwt(user, mfaEnabled, session.id);

    if (mfaEnabled) {
      this.logger.log(
        `User signed in with MFA pending (aal1): ${user.id} — TOTP verification required`,
      );
    } else {
      this.logger.log(`User signed in: ${user.id}`);
    }

    return { user, session, accessToken };
  }

  /**
   * Refreshes a session by looking it up via the opaque session token.
   *
   * Flow (single round-trip for the happy path):
   *   1. UPDATE sessions JOIN users WHERE token=$1 AND expires_at > NOW() RETURNING *
   *      — slides expiry and fetches user data in one query.
   *   2. If no rows returned: check whether the token exists at all to emit the
   *      correct error (not found vs expired). Expired sessions are deleted
   *      fire-and-forget so the error path adds no latency to the caller.
   *   3. Map raw result → BaSession + BaUser → sign SACDIA JWT.
   */
  async refreshSession(sessionToken: string): Promise<BaAuthResult> {
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    // Single round-trip: UPDATE + JOIN users, slide expiry, return all needed fields.
    // The WHERE clause enforces both token match and non-expiry atomically.
    type RefreshRow = {
      // session fields
      id: string;
      token: string;
      expires_at: Date;
      created_at: Date;
      updated_at: Date;
      ip_address: string | null;
      user_agent: string | null;
      user_id: string;
      // user fields (prefixed to avoid collision)
      u_user_id: string;
      u_email: string;
      u_name: string | null;
      u_email_verified: boolean;
      u_user_image: string | null;
      u_created_at: Date;
      u_modified_at: Date;
    };

    const rows = await this.prisma.$queryRaw<RefreshRow[]>`
      UPDATE sessions s
         SET expires_at = ${newExpiresAt},
             updated_at = NOW()
        FROM users u
       WHERE s.token      = ${sessionToken}
         AND s.expires_at > NOW()
         AND u.user_id    = s.user_id
   RETURNING s.id,
             s.token,
             s.expires_at,
             s.created_at,
             s.updated_at,
             s.ip_address,
             s.user_agent,
             s.user_id,
             u.user_id    AS u_user_id,
             u.email      AS u_email,
             u.name       AS u_name,
             u.email_verified  AS u_email_verified,
             u.user_image AS u_user_image,
             u.created_at AS u_created_at,
             u.modified_at AS u_modified_at
    `;

    if (rows.length === 0) {
      // Distinguish "token not found" from "token expired" for correct error message.
      // This secondary query only runs on the error path — no impact on happy-path latency.
      const existing = await this.prisma.session.findFirst({
        where: { token: sessionToken },
        select: { id: true },
      });

      if (!existing) {
        throw new AppUnauthorizedException(ErrorCode.AUTH_SESSION_EXPIRED);
      }

      // Token exists but is expired — clean it up fire-and-forget.
      this.prisma.session
        .deleteMany({ where: { token: sessionToken } })
        .catch((err: unknown) =>
          this.logger.warn(
            `refreshSession: failed to delete expired session — ${err instanceof Error ? err.message : String(err)}`,
          ),
        );

      throw new AppUnauthorizedException(ErrorCode.AUTH_SESSION_EXPIRED);
    }

    const row = rows[0];

    // SECURITY NOTE — JWT blacklisting:
    // refreshSession issues a new HS256 JWT but cannot blacklist the previous one
    // because the old access token is not sent to this endpoint (clients send only
    // the opaque session token). Mitigation: JWTs are short-lived (1h). A proper
    // blacklist would require a Redis store keyed by jti or token hash — defer to
    // a future hardening pass if the 1h window is deemed insufficient.

    const session = mapDbSessionToBaSession({
      id: row.id,
      userId: row.user_id,
      token: row.token,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    });

    const user = mapDbUserToBaUser({
      user_id: row.u_user_id,
      email: row.u_email,
      name: row.u_name,
      email_verified: row.u_email_verified,
      user_image: row.u_user_image,
      created_at: row.u_created_at,
      modified_at: row.u_modified_at,
    });

    const accessToken = this.signJwt(user, false, session.id);

    this.logger.log(`Session refreshed for user: ${user.id}`);
    return { user, session, accessToken };
  }

  /**
   * Revokes a session (sign out) by deleting it from the DB.
   *
   * Best-effort: never throws — a failed revocation does not block the client.
   */
  async signOut(sessionToken: string): Promise<void> {
    try {
      await this.prisma.session.deleteMany({ where: { token: sessionToken } });
      this.logger.log('Session revoked');
    } catch (error) {
      this.logger.warn(
        `signOut: session deletion failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Creates a password-reset verification token.
   *
   * SECURITY: The raw token is NEVER logged — it is a credential equivalent to a
   * temporary password. Only a masked email and expiry are logged.
   *
   * EMAIL_ENABLED guard: if no email transport is configured the endpoint returns
   * ServiceUnavailableException so callers get a clear, actionable error instead of
   * silently losing the token.
   *
   * BA's requestPasswordReset is NOT used here to avoid BA adapter write issues.
   *
   * Always succeeds silently for unknown emails (enumeration-safe).
   */
  async resetPasswordForEmail(
    email: string,
    _redirectTo?: string,
  ): Promise<void> {
    // Guard: email transport must be explicitly enabled.
    if (process.env.EMAIL_ENABLED !== 'true') {
      throw new ServiceUnavailableException(
        'Password reset is temporarily unavailable. Please contact support.',
      );
    }

    const dbUser = await this.prisma.users.findUnique({ where: { email } });
    if (!dbUser) {
      // Silent — do not reveal whether the email exists.
      // Log only masked email to avoid PII in logs.
      this.logger.log(
        `Password reset requested for unknown email: ${maskEmail(email)}`,
      );
      return;
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: email,
        value: token,
        expiresAt,
      },
    });

    // Build deep link — token embedded in URL, never logged separately.
    // The mobile app handles sacdia://reset-password?token=<token> and calls
    // POST /api/v1/auth/password/reset with the token in the body.
    // SECURITY: raw token is NEVER logged.
    const resetUrl = `sacdia://reset-password?token=${token}`;

    // Enqueue email — fire-and-forget from caller's perspective.
    // EMAIL_ENABLED gate is enforced at processor level; no need to check here.
    this.emailService
      .sendPasswordReset({ email, resetUrl })
      .catch((err: Error) => {
        this.logger.warn(
          `Failed to enqueue password reset email for ${maskEmail(email)}: ${err.message}`,
        );
      });

    this.logger.log(
      `Password reset token generated for ${maskEmail(email)} (expires ${expiresAt.toISOString()})`,
    );
  }

  /**
   * Updates a user's password by their userId without requiring the current password.
   *
   * DESIGN NOTE: This is an admin/internal operation. It finds the credential
   * account for the user and updates the hashed password directly.
   */
  async updatePasswordById(userId: string, newPassword: string): Promise<void> {
    const dbAccount = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
    });
    if (!dbAccount) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.account.update({
      where: { id: dbAccount.id },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password updated for user: ${userId}`);
  }

  // ---------------------------------------------------------------------------
  // TOTP / MFA methods
  // ---------------------------------------------------------------------------

  /**
   * TOTP is implemented directly with Prisma + otplib (no BA twoFactor plugin).
   *
   * Storage: verification table with identifier = `totp:{userId}`.
   *   value: JSON string — { secret: string, backupCodes: string[] }
   *   where backupCodes is an array of bcrypt-hashed 8-char codes.
   *   expiresAt: 2099-01-01 (effectively permanent).
   *
   * Password verification uses the credential account row (bcrypt.compare).
   */

  // -- Private TOTP helpers --------------------------------------------------

  private totpIdentifier(userId: string): string {
    return `totp:${userId}`;
  }

  /**
   * Generates 10 random 8-character alphanumeric backup codes.
   * Returns { plain, hashed } — plain shown once to user, hashed stored in DB.
   */
  private async generateBackupCodes(): Promise<{
    plain: string[];
    hashed: string[];
  }> {
    const plain: string[] = [];
    const hashed: string[] = [];

    for (let i = 0; i < 10; i++) {
      // 6 random bytes → base64url → slice to 8 chars (URL-safe alphanumeric)
      const code = randomBytes(6)
        .toString('base64url')
        .slice(0, 8)
        .toUpperCase();
      plain.push(code);
      hashed.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
    }

    return { plain, hashed };
  }

  /**
   * Verifies the user's credential account password.
   * Throws UnauthorizedException if wrong or if no credential account exists.
   */
  private async verifyUserPassword(
    userId: string,
    password: string,
  ): Promise<void> {
    const dbAccount = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
    });
    if (!dbAccount || !dbAccount.password) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    const isValid = await bcrypt.compare(password, dbAccount.password);
    if (!isValid) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }
  }

  // -- Public TOTP methods ---------------------------------------------------

  /**
   * Enrolls TOTP for a user.
   *
   * Flow:
   *   1. Verify password
   *   2. Check not already enrolled (upsert is fine, but we warn)
   *   3. Generate TOTP secret via otplib.authenticator
   *   4. Generate 10 backup codes (plain + hashed)
   *   5. Store { secret, backupCodes: hashed[] } in verification table
   *   6. Return { totpURI, backupCodes: plain[] }
   */
  async enrollTotp(
    userId: string,
    password: string,
  ): Promise<BaTotpEnrollResult> {
    await this.verifyUserPassword(userId, password);

    // Load user email for TOTP URI label
    const dbUser = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { email: true },
    });
    if (!dbUser) {
      throw new AppNotFoundException(ErrorCode.USER_NOT_FOUND);
    }

    const secret = generateSecret();
    const issuer = 'SACDIA';
    const totpURI = generateURI({ label: dbUser.email, issuer, secret });

    const { plain: plainCodes, hashed: hashedCodes } =
      await this.generateBackupCodes();

    const identifier = this.totpIdentifier(userId);
    const value = JSON.stringify({ secret, backupCodes: hashedCodes });
    const expiresAt = new Date('2099-01-01T00:00:00.000Z');
    const now = new Date();

    // Upsert: delete existing record (if any) then insert fresh
    await this.prisma.verification.deleteMany({ where: { identifier } });
    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier,
        value,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });

    this.logger.log(`TOTP enrolled for user: ${userId}`);
    return { totpURI, backupCodes: plainCodes };
  }

  /**
   * Verifies a TOTP code (6-digit from authenticator app).
   *
   * Flow:
   *   1. Load TOTP record from verification table
   *   2. Verify code via otplib.authenticator.verify()
   *   3. Return { verified: boolean }
   *
   * Does NOT check backup codes — see disableTotp for that concern.
   */
  async verifyTotp(
    userId: string,
    code: string,
  ): Promise<{ verified: boolean }> {
    const identifier = this.totpIdentifier(userId);
    const record = await this.prisma.verification.findFirst({
      where: { identifier },
    });

    if (!record) {
      // No TOTP enrolled — cannot verify
      return { verified: false };
    }

    let parsed: { secret: string; backupCodes: string[] };
    try {
      parsed = JSON.parse(record.value);
    } catch {
      throw new AppInternalServerErrorException(
        ErrorCode.AUTH_TOTP_ENROLLMENT_FAILED,
      );
    }

    const result = verifySync({
      token: code,
      secret: parsed.secret,
    });
    const verified = result.valid;

    if (verified) {
      this.logger.log(`TOTP verified for user: ${userId}`);
    }

    return { verified };
  }

  /**
   * Disables TOTP for a user.
   *
   * Flow:
   *   1. Verify password
   *   2. Delete the totp:{userId} record from verification table
   */
  async disableTotp(userId: string, password: string): Promise<void> {
    await this.verifyUserPassword(userId, password);

    const identifier = this.totpIdentifier(userId);
    await this.prisma.verification.deleteMany({ where: { identifier } });

    this.logger.log(`TOTP disabled for user: ${userId}`);
  }

  /**
   * Returns whether the user has TOTP enrolled.
   * Checks for existence of the totp:{userId} record in the verification table.
   */
  async hasTotpEnabled(userId: string): Promise<{ enabled: boolean }> {
    const identifier = this.totpIdentifier(userId);
    const record = await this.prisma.verification.findFirst({
      where: { identifier },
      select: { id: true },
    });
    return { enabled: !!record };
  }

  // ---------------------------------------------------------------------------
  // OAuth methods
  // ---------------------------------------------------------------------------

  /**
   * Generates an OAuth authorization URL for the given provider.
   *
   * BA handles OAuth flows natively — we keep using BA's API here since the
   * adapter write issue only affects user CRUD operations.
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
        throw new AppInternalServerErrorException(
          ErrorCode.AUTH_OAUTH_CALLBACK_FAILED,
        );
      }

      const urlObj = new URL(result.url);
      const state = urlObj.searchParams.get('state') ?? '';

      this.logger.log(`OAuth URL generated for provider: ${provider}`);
      return { url: result.url, state };
    } catch (error) {
      if (error instanceof AppInternalServerErrorException) throw error;
      throw new AppInternalServerErrorException(
        ErrorCode.AUTH_OAUTH_CALLBACK_FAILED,
      );
    }
  }

  /**
   * Handles the OAuth callback after the provider redirects back.
   *
   * NOTE: BA's callbackOAuth is a browser-facing GET endpoint. For a proper
   * server-side OAuth flow, the browser hits BA's callback URL directly and BA
   * sets the session cookie, then redirects to callbackURL where the frontend
   * reads the session token and calls SACDIA.
   */
  async handleOAuthCallback(
    provider: 'google' | 'apple',
    code: string,
    state: string,
    _redirectUri: string,
  ): Promise<BaAuthResult> {
    try {
      const result = await (this.ba.api as any).callbackOAuth({
        query: { code, state },
        method: 'GET',
      });

      if (!result?.token) {
        throw new AppInternalServerErrorException(
          ErrorCode.AUTH_OAUTH_CALLBACK_FAILED,
        );
      }

      // For OAuth, find the session BA created and load the user directly
      const dbSession = await this.prisma.session.findFirst({
        where: { token: result.token },
      });
      if (!dbSession) {
        throw new AppUnauthorizedException(ErrorCode.AUTH_SESSION_EXPIRED);
      }

      const dbUser = await this.prisma.users.findUnique({
        where: { user_id: dbSession.userId },
      });
      if (!dbUser) {
        throw new AppInternalServerErrorException(
          ErrorCode.AUTH_OAUTH_CALLBACK_FAILED,
        );
      }

      const user = mapDbUserToBaUser(dbUser);
      const session = mapDbSessionToBaSession(dbSession);
      const accessToken = this.signJwt(user, false, session.id);

      this.logger.log(
        `OAuth callback handled for provider: ${provider}, user: ${user.id}`,
      );
      return { user, session, accessToken };
    } catch (error) {
      if (
        error instanceof AppInternalServerErrorException ||
        error instanceof AppUnauthorizedException
      ) {
        throw error;
      }
      throw new AppInternalServerErrorException(
        ErrorCode.AUTH_OAUTH_CALLBACK_FAILED,
      );
    }
  }

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------

  /**
   * Signs a SACDIA HS256 JWT for API consumers.
   *
   * Payload: { sub: user.id, email: user.email, [sid], [mfa_pending] }
   * Algorithm: HS256 (via BETTER_AUTH_SECRET in JwtModule config)
   * Expiry: 8h (configured in BetterAuthModule JwtModule.registerAsync)
   *
   * @param user        - User identity fields to embed in the JWT.
   * @param mfaPending  - When `true`, the token carries `mfa_pending: true`,
   *                      indicating the second factor (TOTP) has not been
   *                      verified yet. Protected endpoints should reject these
   *                      tokens via MfaGuard until the user calls
   *                      POST /auth/mfa/verify successfully.
   * @param sessionId   - Optional BA session DB row `id` (UUID). When present,
   *                      enables `is_current` comparison in GET /auth/sessions.
   */
  signJwt(
    user: Pick<BaUser, 'id' | 'email'>,
    mfaPending = false,
    sessionId?: string,
  ): string {
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
    };
    if (sessionId) {
      payload['sid'] = sessionId;
    }
    if (mfaPending) {
      payload['mfa_pending'] = true;
    }
    return this.jwtService.sign(payload);
  }
}
