import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppBadRequestException,
  AppForbiddenException,
  AppInternalServerErrorException,
  AppNotFoundException,
  AppUnauthorizedException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { randomUUID, randomBytes } from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { PrismaService } from '../prisma/prisma.service';
import { maskEmail } from '../common/utils/mask-email.util';
import { EmailService } from '../common/email/email.service';
import {
  accessJwtClaims,
  deviceJwtClaims,
} from '../common/constants/jwt-audiences';
import { SupervisedPrincipalResolver } from '../auth/supervised/supervised-principal.resolver';
import { FamilyFeatureFlagsService } from '../guardianships/family-feature-flags.service';
import {
  deviceRevoked,
  deviceSessionExpired,
} from '../auth/acting-for/acting-for.errors';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface BaUser {
  id: string;
  /** Null for dependent profiles (family profiles): they have no account email. */
  email: string | null;
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

// ---------------------------------------------------------------------------
// Service interface (all auth operations SACDIA needs)
// ---------------------------------------------------------------------------

/**
 * Request metadata stored on the session row so GET /auth/sessions can show
 * the device and IP. Both fields are optional: internal callers (admin invite)
 * have no client request.
 */
export interface SessionRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * The linked device a session token belongs to, when it is a device session
 * (3b). A device session is recognised ONLY by its `linked_devices` row.
 */
export interface LinkedDeviceSessionInfo {
  sessionId: string;
  linkedDeviceId: string;
  dependentUserId: string;
  revokedAt: Date | null;
  absoluteExpiresAt: Date;
}

/** Device access tokens live one hour (FP3-43); the module default of 8h does not apply. */
export const DEVICE_JWT_TTL = '1h';

/** A device session slides 30 days at a time, never past its absolute cap (FP3-46). */
export const DEVICE_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface IBetterAuthService {
  // -- Auth ------------------------------------------------------------------
  createUser(
    email: string,
    password: string,
    name: string,
    context?: SessionRequestContext,
  ): Promise<BaAuthResult>;
  /**
   * Password login by identifier: an email (contains '@') or a login handle.
   * Uniform 401 for every failure before the password verifies; the supervised
   * login state (frozen / disabled) is revealed only after it does.
   */
  signInWithIdentifier(
    identifier: string,
    password: string,
    context?: SessionRequestContext,
  ): Promise<BaAuthResult>;
  /** @deprecated email-only alias of {@link signInWithIdentifier}. */
  signInWithPassword(
    email: string,
    password: string,
    context?: SessionRequestContext,
  ): Promise<BaAuthResult>;
  /**
   * Creates an opaque session for an already-authenticated user: 7 days by
   * default, or `options.durationMs` (a linked device pairs for 30 days). With
   * `options.tx` the row is written in the caller's transaction (pairing).
   */
  createSession(
    userId: string,
    context?: SessionRequestContext,
    options?: { durationMs?: number; tx?: Prisma.TransactionClient },
  ): Promise<BaSession>;
  /**
   * Who owns a LIVE session token, without touching the session (no slide, no
   * cleanup). Lets the refresh path decide about the principal BEFORE it
   * extends the row. Null when the token is unknown or expired.
   */
  getSessionOwnerId(sessionToken: string): Promise<string | null>;
  /**
   * The linked device whose session this token is, even when the device was
   * revoked (the row is what tells a device session from a user one). Null for
   * a user session or an unknown token. Read-only.
   */
  findLinkedDeviceOfSession(
    sessionToken: string,
  ): Promise<LinkedDeviceSessionInfo | null>;
  /**
   * `known.device` lets a caller that already looked the device up (AuthService
   * runs the device gate first) skip the second lookup; `null` means "looked,
   * it is a user session".
   */
  refreshSession(
    sessionToken: string,
    known?: { device: LinkedDeviceSessionInfo | null },
  ): Promise<BaAuthResult>;
  signOut(sessionToken: string): Promise<void>;
  resetPasswordForEmail(email: string, redirectTo?: string): Promise<void>;
  resetPasswordWithToken(
    token: string,
    newPassword: string,
  ): Promise<{ userId: string }>;
  updatePasswordById(userId: string, newPassword: string): Promise<void>;
  updateOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;

  // -- TOTP / MFA -----------------------------------------------------------
  enrollTotp(userId: string, password: string): Promise<BaTotpEnrollResult>;
  verifyTotp(userId: string, code: string): Promise<{ verified: boolean }>;
  disableTotp(userId: string, password: string): Promise<void>;
  hasTotpEnabled(userId: string): Promise<{ enabled: boolean }>;
  markMfaSessionAssured(userId: string, sessionId: string): Promise<void>;

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------
  signJwt(
    user: Pick<BaUser, 'id' | 'email'>,
    mfaPending?: boolean,
    sessionId?: string,
  ): string;
  /** Signs the 1 h device JWT (aud sacdia:device) of a paired phone. */
  signDeviceJwt(device: {
    dependentUserId: string;
    sessionId: string;
    linkedDeviceId: string;
  }): string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Session duration: 7 days in ms */
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Bcrypt cost factor */
const BCRYPT_ROUNDS = 12;

/**
 * A valid bcrypt hash (cost 12) of a throwaway value. Login compares the
 * submitted password against it whenever there is no real hash to compare
 * (unknown email, unknown or unusable handle, no credential, flag off), so every
 * failure costs the same CPU and timing does not reveal whether an account
 * exists. Never matches anything: the password it came from is not recorded.
 */
export const DUMMY_BCRYPT_HASH =
  '$2b$12$VEzbMLXeQB2uCqe9wamzsuaTRHu4NPwtsxjXG5SBeu31k9umfJemm';

/**
 * Stand-in user id for the credential lookup of an unknown login identifier
 * (timing parity with a wrong password). A valid UUID, so the uuid column
 * accepts it, that no user ever gets.
 */
const NO_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Server-generated handle format (lowercase, 6-40 chars). */
const LOGIN_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{5,39}$/;

/** Generate a URL-safe random token (32 bytes = 43 base64url chars). */
function generateToken(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(32).toString('base64url');
}

/** Namespaces reset tokens so they cannot satisfy email-verify lookups. */
export const PASSWORD_RESET_IDENTIFIER_PREFIX = 'password-reset:';

/**
 * Base URL of the admin web app that hosts the reset page, or null when
 * ADMIN_PANEL_URL is missing or not an http(s) URL. Trailing slashes removed.
 */
export function passwordResetPageBase(
  adminPanelUrl: string | undefined,
): string | null {
  const raw = adminPanelUrl?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

export function passwordResetIdentifier(email: string): string {
  return `${PASSWORD_RESET_IDENTIFIER_PREFIX}${email}`;
}

/** `verification.identifier` of a user's TOTP secret and backup codes. */
export function totpIdentifier(userId: string): string {
  return `totp:${userId}`;
}

/**
 * Maps a Prisma `users` record to the `BaUser` shape used across the service.
 * Uses our schema field names: user_id, email_verified, user_image, created_at, modified_at.
 */
function mapDbUserToBaUser(dbUser: {
  user_id: string;
  email: string | null;
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
    private readonly emailService: EmailService,
    private readonly supervisedResolver: SupervisedPrincipalResolver,
    private readonly familyFlags: FamilyFeatureFlagsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Creates a new session row in the DB for the given userId.
   * Returns the session record mapped to BaSession.
   */
  async createSession(
    userId: string,
    context?: SessionRequestContext,
    options?: { durationMs?: number; tx?: Prisma.TransactionClient },
  ): Promise<BaSession> {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (options?.durationMs ?? SESSION_DURATION_MS),
    );
    const dbSession = await (options?.tx ?? this.prisma).session.create({
      data: {
        id: randomUUID(),
        token: generateToken(),
        userId,
        expiresAt,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
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
   *   1. Duplicate email → dummy bcrypt + AUTH_INVALID_CREDENTIALS (same as login)
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
    context?: SessionRequestContext,
  ): Promise<BaAuthResult> {
    // Public register must not say "email already in use". Same code as login
    // plus dummy hash so the timing matches a real create. Admin invite still
    // uses AUTH_EMAIL_ALREADY_IN_USE on its own preflight.
    const existing = await this.prisma.users.findUnique({ where: { email } });
    if (existing) {
      await bcrypt.hash(password, BCRYPT_ROUNDS);
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const userId = randomUUID();
    let dbUser;
    try {
      dbUser = await this.prisma.users.create({
        data: {
          user_id: userId,
          email,
          name,
          email_verified: false,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
      }
      throw error;
    }

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
    const session = await this.createSession(userId, context);

    const user = mapDbUserToBaUser(dbUser);
    const accessToken = this.signJwt(user, false, session.id);

    this.logger.log(`User created: ${user.id}`);
    return { user, session, accessToken };
  }

  /**
   * Finds the account a login identifier points at. An identifier with '@' is
   * an email; anything else is a login handle (case-insensitive). A handle only
   * resolves while FAMILY_TEEN_LOGIN_ENABLED is on and when it is well formed;
   * otherwise it resolves to nobody, exactly like an unknown one.
   */
  private async findUserForLogin(identifier: string) {
    const trimmed = identifier.trim();
    if (trimmed.includes('@')) {
      return this.prisma.users.findUnique({ where: { email: trimmed } });
    }

    const handle = trimmed.toLowerCase();
    if (
      !this.familyFlags.isEnabled('teen_login') ||
      !LOGIN_HANDLE_PATTERN.test(handle)
    ) {
      return null;
    }
    const login = await this.prisma.supervised_logins.findFirst({
      where: { login_handle: handle },
      select: { user: true },
    });
    return login?.user ?? null;
  }

  /**
   * Authenticates a user by identifier (email or login handle) + password —
   * direct Prisma lookup.
   *
   * Flow:
   *   1. Resolve the user by email or handle
   *   2. Find the credential account
   *   3. ALWAYS run one bcrypt.compare (against a dummy hash when there is no
   *      user / credential), so unknown, no-credential, wrong-password and
   *      flag-off cases cost the same and fail with the SAME 401
   *   4. Only after a CORRECT password: a frozen account answers 403
   *      AUTH_ACCOUNT_FROZEN and a disabled supervised login 403
   *      AUTH_SUPERVISED_LOGIN_DISABLED (nothing is learned without the password)
   *   5. Create session → sign JWT → return BaAuthResult
   */
  async signInWithIdentifier(
    identifier: string,
    password: string,
    context?: SessionRequestContext,
  ): Promise<BaAuthResult> {
    // 1. Find user
    const dbUser = await this.findUserForLogin(identifier);

    // 2. Find credential account. ALWAYS one lookup, against the nil UUID when
    //    there is no user: skipping it made an unknown identifier a whole DB
    //    round-trip faster than a wrong password (timing oracle). The nil UUID
    //    never belongs to a user, and the result is ignored without a user.
    const dbAccount = await this.prisma.account.findFirst({
      where: {
        userId: dbUser?.user_id ?? NO_USER_ID,
        providerId: 'credential',
      },
    });
    const storedHash = dbUser ? (dbAccount?.password ?? null) : null;

    // 3. Verify password. One compare on EVERY path (timing oracle fix).
    const isValid = await bcrypt.compare(
      password,
      storedHash ?? DUMMY_BCRYPT_HASH,
    );
    if (!dbUser || !storedHash || !isValid) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // 4. The password is right: now it is safe to say why access is blocked.
    //    The resolver turns an adult (age of majority) into "not blocked", so a
    //    handle login keeps working after the teen grows up.
    const supervised = await this.supervisedResolver.resolve(dbUser.user_id);
    if (
      supervised.state === 'blocked' &&
      supervised.cause === 'teen_login_disabled'
    ) {
      // A handle account while FAMILY_TEEN_LOGIN_ENABLED is off: the same
      // uniform 401 as an unknown handle (FP3-08), never a 403 that would
      // confirm the account. Normally unreachable (the handle lookup already
      // resolves to nobody); this covers a flag flip between the two reads.
      throw new AppUnauthorizedException(ErrorCode.AUTH_INVALID_CREDENTIALS);
    }
    if (supervised.state === 'blocked') {
      throw new AppForbiddenException(
        supervised.cause === 'frozen'
          ? ErrorCode.AUTH_ACCOUNT_FROZEN
          : ErrorCode.AUTH_SUPERVISED_LOGIN_DISABLED,
      );
    }

    // 5. Check MFA enrollment — if TOTP is active, issue a restricted token
    //    with mfa_pending: true. The client must call POST /auth/mfa/verify to
    //    obtain a full aal2 token. JwtAuthGuard blocks protected endpoints while
    //    mfa_pending is true unless @SkipMfaCheck() is present.
    const { enabled: mfaEnabled } = await this.hasTotpEnabled(dbUser.user_id);

    // 6. Create session + sign JWT
    const session = await this.createSession(dbUser.user_id, context);
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

  /** @deprecated email-only alias of {@link signInWithIdentifier}. */
  signInWithPassword(
    email: string,
    password: string,
    context?: SessionRequestContext,
  ): Promise<BaAuthResult> {
    return this.signInWithIdentifier(email, password, context);
  }

  async findLinkedDeviceOfSession(
    sessionToken: string,
  ): Promise<LinkedDeviceSessionInfo | null> {
    // No relation between sessions and linked_devices (ADR-4): join by hand.
    const rows = await this.prisma.$queryRaw<
      Array<{
        session_id: string;
        linked_device_id: string;
        dependent_user_id: string;
        revoked_at: Date | null;
        absolute_expires_at: Date;
      }>
    >`
      SELECT s.id AS session_id,
             ld.linked_device_id,
             ld.dependent_user_id,
             ld.revoked_at,
             ld.absolute_expires_at
        FROM sessions s
        JOIN linked_devices ld ON ld.session_id = s.id
       WHERE s.token = ${sessionToken}
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      linkedDeviceId: row.linked_device_id,
      dependentUserId: row.dependent_user_id,
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
      absoluteExpiresAt: new Date(row.absolute_expires_at),
    };
  }

  async getSessionOwnerId(sessionToken: string): Promise<string | null> {
    const session = await this.prisma.session.findFirst({
      where: { token: sessionToken, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    return session?.userId ?? null;
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
  async refreshSession(
    sessionToken: string,
    known?: { device: LinkedDeviceSessionInfo | null },
  ): Promise<BaAuthResult> {
    // A device session is told apart by its linked_devices row, and only that
    // row decides the lifetime and the kind of JWT: a device session slides 30
    // days capped at its absolute expiry and signs ONLY a device JWT; a user
    // session slides 7 days and signs ONLY an access JWT. A revoked or capped
    // device NEVER falls through to the user path (it would mint an access JWT
    // for a child).
    const device =
      known !== undefined
        ? known.device
        : await this.findLinkedDeviceOfSession(sessionToken);
    const nowMs = Date.now();
    let newExpiresAt = new Date(nowMs + SESSION_DURATION_MS);
    if (device) {
      if (device.revokedAt) {
        throw deviceRevoked();
      }
      if (device.absoluteExpiresAt.getTime() <= nowMs) {
        throw deviceSessionExpired();
      }
      newExpiresAt = new Date(
        Math.min(
          nowMs + DEVICE_SESSION_DURATION_MS,
          device.absoluteExpiresAt.getTime(),
        ),
      );
    }

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

    // Access-JWT rotation lives in AuthService.refreshSession: if the client
    // presented Authorization: Bearer with this user's access JWT, that token
    // is blacklisted after this new JWT is issued. This method only slides the
    // BA session and signs the replacement. Without a presented access JWT the
    // previous one remains valid until exp (≤8h).

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

    if (device) {
      // No MFA on a device, and never an access JWT.
      const deviceToken = this.signDeviceJwt({
        dependentUserId: user.id,
        sessionId: session.id,
        linkedDeviceId: device.linkedDeviceId,
      });
      this.logger.log(`Device session refreshed for dependent: ${user.id}`);
      return { user, session, accessToken: deviceToken };
    }

    const { enabled: mfaEnabled } = await this.hasTotpEnabled(user.id);
    const sessionAssured = mfaEnabled
      ? await this.hasMfaSessionAssurance(user.id, session.id)
      : false;
    const accessToken = this.signJwt(
      user,
      mfaEnabled && !sessionAssured,
      session.id,
    );

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

    // The link opens the admin web page that sets the new password. Without
    // ADMIN_PANEL_URL the email would carry a dead link, so fail like a
    // disabled transport instead of creating a token nobody can use.
    const resetPageBase = passwordResetPageBase(process.env.ADMIN_PANEL_URL);
    if (!resetPageBase) {
      this.logger.error(
        'Password reset link not sent: ADMIN_PANEL_URL is missing or invalid',
      );
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
    const identifier = passwordResetIdentifier(email);

    await this.prisma.verification.deleteMany({ where: { identifier } });
    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier,
        value: token,
        expiresAt,
      },
    });

    // https link to the admin page ({ADMIN_PANEL_URL}/reset-password), which
    // calls POST /api/v1/auth/password/reset with the token in the body. A
    // custom-scheme deep link had no handler and is stripped by most mail
    // clients. SECURITY: raw token is NEVER logged.
    const resetUrl = `${resetPageBase}/reset-password?token=${encodeURIComponent(token)}`;

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
   * Consumes a password-reset token and updates the credential hash.
   * Does not create a credential account for OAuth-only users.
   * Does not issue a session or JWT — caller must revoke existing sessions.
   */
  async resetPasswordWithToken(
    token: string,
    newPassword: string,
  ): Promise<{ userId: string }> {
    const verification = await this.prisma.verification.findFirst({
      where: {
        value: token,
        identifier: { startsWith: PASSWORD_RESET_IDENTIFIER_PREFIX },
      },
    });

    if (!verification) {
      throw new AppBadRequestException(
        ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID,
      );
    }

    if (verification.expiresAt < new Date()) {
      await this.prisma.verification.delete({
        where: { id: verification.id },
      });
      throw new AppBadRequestException(
        ErrorCode.AUTH_PASSWORD_RESET_TOKEN_EXPIRED,
      );
    }

    const email = verification.identifier.slice(
      PASSWORD_RESET_IDENTIFIER_PREFIX.length,
    );
    const dbUser = email
      ? await this.prisma.users.findUnique({ where: { email } })
      : null;
    const dbAccount = dbUser
      ? await this.prisma.account.findFirst({
          where: { userId: dbUser.user_id, providerId: 'credential' },
        })
      : null;

    if (!dbUser || !dbAccount) {
      await this.prisma.verification.deleteMany({
        where: { identifier: verification.identifier },
      });
      throw new AppBadRequestException(
        ErrorCode.AUTH_PASSWORD_RESET_TOKEN_INVALID,
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction([
      this.prisma.account.update({
        where: { id: dbAccount.id },
        data: { password: hashedPassword },
      }),
      this.prisma.verification.deleteMany({
        where: { identifier: verification.identifier },
      }),
    ]);

    this.logger.log(
      `Password reset confirmed for ${maskEmail(email)} (user ${dbUser.user_id})`,
    );

    return { userId: dbUser.user_id };
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

  async updateOwnPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.verifyUserPassword(userId, currentPassword);
    await this.updatePasswordById(userId, newPassword);
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

  private mfaSessionIdentifier(sessionId: string): string {
    return `mfa-session:${sessionId}`;
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
    // Dependent profiles (no email) never enroll TOTP; the user id keeps the label non-empty.
    const totpURI = generateURI({
      label: dbUser.email ?? userId,
      issuer,
      secret,
    });

    const { plain: plainCodes, hashed: hashedCodes } =
      await this.generateBackupCodes();

    const identifier = totpIdentifier(userId);
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
    const identifier = totpIdentifier(userId);
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

    const identifier = totpIdentifier(userId);
    await this.prisma.verification.deleteMany({ where: { identifier } });

    this.logger.log(`TOTP disabled for user: ${userId}`);
  }

  /**
   * Returns whether the user has TOTP enrolled.
   * Checks for existence of the totp:{userId} record in the verification table.
   */
  async hasTotpEnabled(userId: string): Promise<{ enabled: boolean }> {
    const identifier = totpIdentifier(userId);
    const record = await this.prisma.verification.findFirst({
      where: { identifier },
      select: { id: true },
    });
    return { enabled: !!record };
  }

  async markMfaSessionAssured(
    userId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        userId,
        expiresAt: { gt: new Date() },
      },
      select: { expiresAt: true },
    });

    if (!session) {
      throw new AppUnauthorizedException(ErrorCode.AUTH_SESSION_EXPIRED);
    }

    const now = new Date();
    await this.prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier: this.mfaSessionIdentifier(sessionId),
        value: userId,
        expiresAt: session.expiresAt,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  private async hasMfaSessionAssurance(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    const record = await this.prisma.verification.findFirst({
      where: {
        identifier: this.mfaSessionIdentifier(sessionId),
        value: userId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    return !!record;
  }

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------

  /**
   * Signs a SACDIA HS256 JWT for API consumers.
   *
   * Payload: { sub, email, iss, aud, [sid], [mfa_pending] }
   * Algorithm: HS256 (via BETTER_AUTH_SECRET in JwtModule config)
   * Expiry: 8h (configured in BetterAuthModule JwtModule.registerAsync)
   * Claims: iss=https://api.sacdia.app aud=sacdia:access (required by JwtStrategy)
   *
   * @param user        - User identity fields to embed in the JWT.
   * @param mfaPending  - When `true`, the token carries `mfa_pending: true`,
   *                      indicating the second factor (TOTP) has not been
   *                      verified yet. Protected endpoints should reject these
   *                      tokens via JwtAuthGuard until the user calls
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
      ...accessJwtClaims(),
    };
    if (sessionId) {
      payload['sid'] = sessionId;
    }
    if (mfaPending) {
      payload['mfa_pending'] = true;
    }
    return this.jwtService.sign(payload);
  }

  /**
   * Signs the device JWT of a paired phone: HS256, iss=https://api.sacdia.app,
   * aud EXACTLY the string `sacdia:device`, `sub` the dependent, `sid` the
   * device session, `dev` the linked device id, 1 hour (overriding the module's
   * 8h default). No email, no `mfa_pending`; a random `jti` keeps every token
   * distinct. What the token may do is never in
   * the token: the gate re-checks the device on every request.
   */
  signDeviceJwt(device: {
    dependentUserId: string;
    sessionId: string;
    linkedDeviceId: string;
  }): string {
    return this.jwtService.sign(
      {
        sub: device.dependentUserId,
        sid: device.sessionId,
        dev: device.linkedDeviceId,
        ...deviceJwtClaims(),
        // Unique per token: two tokens signed in the same second would be the
        // same string, and a refresh blacklists the PRESENTED token.
        jti: randomUUID(),
      },
      { expiresIn: DEVICE_JWT_TTL },
    );
  }
}
