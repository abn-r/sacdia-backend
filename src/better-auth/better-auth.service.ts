import { Injectable, NotImplementedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
// Implementation
// ---------------------------------------------------------------------------

@Injectable()
export class BetterAuthService implements IBetterAuthService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject('BETTER_AUTH_INSTANCE')
    private readonly ba: BetterAuthInstance,
  ) {}

  // -- Auth ------------------------------------------------------------------

  createUser(
    _email: string,
    _password: string,
    _name: string,
  ): Promise<BaAuthResult> {
    throw new NotImplementedException(
      'BetterAuthService.createUser — implemented in W3-007',
    );
  }

  signInWithPassword(_email: string, _password: string): Promise<BaAuthResult> {
    throw new NotImplementedException(
      'BetterAuthService.signInWithPassword — implemented in W3-007',
    );
  }

  refreshSession(_sessionToken: string): Promise<BaAuthResult> {
    throw new NotImplementedException(
      'BetterAuthService.refreshSession — implemented in W3-007',
    );
  }

  signOut(_sessionToken: string): Promise<void> {
    throw new NotImplementedException(
      'BetterAuthService.signOut — implemented in W3-007',
    );
  }

  resetPasswordForEmail(_email: string, _redirectTo?: string): Promise<void> {
    throw new NotImplementedException(
      'BetterAuthService.resetPasswordForEmail — implemented in W3-007',
    );
  }

  updatePasswordById(_userId: string, _newPassword: string): Promise<void> {
    throw new NotImplementedException(
      'BetterAuthService.updatePasswordById — implemented in W3-007',
    );
  }

  // -- TOTP / MFA -----------------------------------------------------------

  enrollTotp(
    _sessionToken: string,
    _friendlyName?: string,
  ): Promise<BaTotpEnrollResult> {
    throw new NotImplementedException(
      'BetterAuthService.enrollTotp — implemented in W3-007',
    );
  }

  challengeTotp(_sessionToken: string, _factorId: string): Promise<string> {
    throw new NotImplementedException(
      'BetterAuthService.challengeTotp — implemented in W3-007',
    );
  }

  verifyTotp(
    _sessionToken: string,
    _factorId: string,
    _challengeId: string,
    _code: string,
  ): Promise<{ verified: boolean }> {
    throw new NotImplementedException(
      'BetterAuthService.verifyTotp — implemented in W3-007',
    );
  }

  listTotpFactors(_sessionToken: string): Promise<BaTotpFactor[]> {
    throw new NotImplementedException(
      'BetterAuthService.listTotpFactors — implemented in W3-007',
    );
  }

  unenrollFactor(_sessionToken: string, _factorId: string): Promise<void> {
    throw new NotImplementedException(
      'BetterAuthService.unenrollFactor — implemented in W3-007',
    );
  }

  getAssuranceLevel(_sessionToken: string): Promise<BaAssuranceLevel> {
    throw new NotImplementedException(
      'BetterAuthService.getAssuranceLevel — implemented in W3-007',
    );
  }

  // -- OAuth ----------------------------------------------------------------

  getOAuthUrl(
    _provider: 'google' | 'apple',
    _redirectUri: string,
  ): Promise<BaOAuthUrlResult> {
    throw new NotImplementedException(
      'BetterAuthService.getOAuthUrl — implemented in W3-007',
    );
  }

  handleOAuthCallback(
    _provider: 'google' | 'apple',
    _code: string,
    _state: string,
    _redirectUri: string,
  ): Promise<BaAuthResult> {
    throw new NotImplementedException(
      'BetterAuthService.handleOAuthCallback — implemented in W3-007',
    );
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
