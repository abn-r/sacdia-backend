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
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { BetterAuthInstance } from './better-auth.config';

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
      throw new ConflictException('Email already in use');
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
    const accessToken = this.signJwt(user);

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
      throw new UnauthorizedException('Invalid credentials');
    }

    // 2. Find credential account
    const dbAccount = await this.prisma.account.findFirst({
      where: { userId: dbUser.user_id, providerId: 'credential' },
    });
    if (!dbAccount || !dbAccount.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Verify password
    const isValid = await bcrypt.compare(password, dbAccount.password);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 4. Create session + sign JWT
    const session = await this.createSession(dbUser.user_id);
    const user = mapDbUserToBaUser(dbUser);
    const accessToken = this.signJwt(user);

    this.logger.log(`User signed in: ${user.id}`);
    return { user, session, accessToken };
  }

  /**
   * Refreshes a session by looking it up via the opaque session token.
   *
   * Flow:
   *   1. Find session by token → UnauthorizedException if missing
   *   2. Check expiry → delete + UnauthorizedException if expired
   *   3. Slide expiry forward by SESSION_DURATION_MS
   *   4. Load user → sign new SACDIA JWT
   */
  async refreshSession(sessionToken: string): Promise<BaAuthResult> {
    // 1. Find session
    const dbSession = await this.prisma.session.findFirst({
      where: { token: sessionToken },
    });
    if (!dbSession) {
      throw new UnauthorizedException('Session not found or expired');
    }

    // 2. Check expiry
    if (dbSession.expiresAt < new Date()) {
      await this.prisma.session.deleteMany({ where: { token: sessionToken } });
      throw new UnauthorizedException('Session expired');
    }

    // 3. Slide expiry
    const newExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    const updatedSession = await this.prisma.session.update({
      where: { id: dbSession.id },
      data: { expiresAt: newExpiresAt },
    });

    // 4. Load user
    const dbUser = await this.prisma.users.findUnique({
      where: { user_id: dbSession.userId },
    });
    if (!dbUser) {
      throw new InternalServerErrorException(
        'refreshSession: user not found for session',
      );
    }

    const user = mapDbUserToBaUser(dbUser);
    const session = mapDbSessionToBaSession(updatedSession);
    const accessToken = this.signJwt(user);

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
   * Creates a password-reset verification token and logs it.
   *
   * In production this should send an email with the token.
   * BA's requestPasswordReset is NOT used here to avoid BA adapter write issues.
   *
   * Always succeeds silently for unknown emails (enumeration-safe).
   */
  async resetPasswordForEmail(
    email: string,
    _redirectTo?: string,
  ): Promise<void> {
    const dbUser = await this.prisma.users.findUnique({ where: { email } });
    if (!dbUser) {
      // Silent — do not reveal whether the email exists
      this.logger.log(`Password reset requested for unknown email: ${email}`);
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

    // TODO(production): send email with token. For now, log it.
    this.logger.log(
      `Password reset token for ${email}: ${token} (expires ${expiresAt.toISOString()})`,
    );
  }

  /**
   * Updates a user's password by their userId without requiring the current password.
   *
   * DESIGN NOTE: This is an admin/internal operation. It finds the credential
   * account for the user and updates the hashed password directly.
   */
  async updatePasswordById(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const dbAccount = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
    });
    if (!dbAccount) {
      throw new NotFoundException(
        `updatePasswordById: no credential account for user ${userId}`,
      );
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
   * NOTE ON TOTP PLUGIN API MISMATCH:
   *
   * The `twoFactor()` plugin provides:
   *   - `auth.api.enableTwoFactor({ body: { password, issuer? }, headers })`
   *   - `auth.api.getTOTPURI({ body: { password }, headers })`
   *   - `auth.api.verifyTOTP({ body: { code, trustDevice? }, headers })`
   *   - `auth.api.disableTwoFactor({ body: { password }, headers })`
   *
   * The service interface uses Supabase-style MFA concepts (factorId, challengeId)
   * that do NOT exist in BA's twoFactor plugin. These methods remain as stubs
   * pending interface redesign.
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

  challengeTotp(
    _sessionToken: string,
    _factorId: string,
  ): Promise<string> {
    throw new NotImplementedException(
      'challengeTotp: BA twoFactor has no challenge step. Call verifyTotp() directly.',
    );
  }

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

  async listTotpFactors(_sessionToken: string): Promise<BaTotpFactor[]> {
    throw new NotImplementedException(
      'listTotpFactors: BA twoFactor supports one TOTP per user, no list endpoint.' +
        ' Check user.twoFactorEnabled via getSession.',
    );
  }

  async unenrollFactor(
    _sessionToken: string,
    _factorId: string,
  ): Promise<void> {
    throw new NotImplementedException(
      'unenrollFactor: interface redesign required. BA uses disableTwoFactor' +
        '({ body: { password } }) — requires password, factorId is not used.',
    );
  }

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
        throw new InternalServerErrorException(
          `getOAuthUrl: BA did not return a URL for provider ${provider}`,
        );
      }

      const urlObj = new URL(result.url);
      const state = urlObj.searchParams.get('state') ?? '';

      this.logger.log(`OAuth URL generated for provider: ${provider}`);
      return { url: result.url, state };
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      const message =
        error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`getOAuthUrl: ${message}`);
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
        throw new InternalServerErrorException(
          `handleOAuthCallback: no token in BA response for provider ${provider}`,
        );
      }

      // For OAuth, find the session BA created and load the user directly
      const dbSession = await this.prisma.session.findFirst({
        where: { token: result.token },
      });
      if (!dbSession) {
        throw new UnauthorizedException(
          'handleOAuthCallback: session not found after OAuth callback',
        );
      }

      const dbUser = await this.prisma.users.findUnique({
        where: { user_id: dbSession.userId },
      });
      if (!dbUser) {
        throw new InternalServerErrorException(
          'handleOAuthCallback: user not found for OAuth session',
        );
      }

      const user = mapDbUserToBaUser(dbUser);
      const session = mapDbSessionToBaSession(dbSession);
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
      const message =
        error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`handleOAuthCallback: ${message}`);
    }
  }

  // -- JWT (Option C core — IMPLEMENTED) ------------------------------------

  /**
   * Signs a SACDIA HS256 JWT for API consumers.
   *
   * Payload: { sub: user.id, email: user.email }
   * Algorithm: HS256 (via BETTER_AUTH_SECRET in JwtModule config)
   * Expiry: 1h (configured in BetterAuthModule JwtModule.registerAsync)
   */
  signJwt(user: Pick<BaUser, 'id' | 'email'>): string {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }
}
