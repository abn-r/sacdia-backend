import { Injectable, Logger } from '@nestjs/common';
import {
  AppServiceUnavailableException,
  AppUnauthorizedException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveAuthBlacklistDegradedMode,
  type AuthBlacklistDegradedMode,
} from '../../config/redis-degraded.config';
import {
  ACCESS_JWT_AUDIENCE,
  ACCESS_JWT_ISSUER,
  QR_MEMBER_AUDIENCE,
  isAccessJwtClaims,
  jwtAudienceIncludes,
} from '../../common/constants/jwt-audiences';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  /**
   * Access JWTs require iss=https://api.sacdia.app and aud=sacdia:access.
   * QR member tokens set aud=sacdia:qr-member and must not authenticate API routes.
   */
  iss?: string;
  aud?: string | string[];
  /**
   * Present and `true` when the user has TOTP enrolled but has not yet completed
   * the second factor after password login. Endpoints that require full auth
   * (aal2) should be blocked until this is cleared by POST /auth/mfa/verify.
   */
  mfa_pending?: boolean;
  /**
   * BA session DB row `id` (UUID). Embedded since 2026-04 to enable `is_current`
   * comparison in GET /auth/sessions without an extra DB round-trip.
   * Absent in tokens issued before this change or via MFA verify endpoint.
   */
  sid?: string;
  iat?: number;
  exp?: number;
}

/** At most one degraded-mode warning per window; the breaker logs the outage. */
const DEGRADED_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly degradedMode: AuthBlacklistDegradedMode;
  private lastDegradedLogAt = 0;

  constructor(
    configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: configService.getOrThrow<string>('BETTER_AUTH_SECRET'),
      algorithms: ['HS256'],
      issuer: ACCESS_JWT_ISSUER,
      audience: ACCESS_JWT_AUDIENCE,
    });

    this.degradedMode = resolveAuthBlacklistDegradedMode(
      configService.get('AUTH_BLACKLIST_DEGRADED_MODE'),
    );
    this.logger.log(
      `JWT verification via HS256 (BETTER_AUTH_SECRET); revocation-check degraded mode: ${this.degradedMode}`,
    );
  }

  async validate(req: Request, payload: JwtPayload) {
    if (jwtAudienceIncludes(payload.aud, QR_MEMBER_AUDIENCE)) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_qr_audience_rejected',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    if (!isAccessJwtClaims(payload)) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_access_claims_rejected',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    const token = this.extractToken(req);

    let revocationCheckUnavailable = false;

    if (token) {
      const tokenStatus = await this.tokenBlacklistService.checkToken(token);
      if (tokenStatus === 'revoked') {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_jwt_revoked_token',
            sub: payload.sub,
          }),
        );
        throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
      }
      revocationCheckUnavailable = tokenStatus === 'unavailable';
    }

    // Skip the second lookup when the cache is already known to be down.
    if (!revocationCheckUnavailable && payload.sub && payload.iat) {
      const userStatus = await this.tokenBlacklistService.checkUserTokens(
        payload.sub,
        payload.iat,
      );
      if (userStatus === 'revoked') {
        this.logger.warn(
          JSON.stringify({
            event: 'auth_jwt_user_blacklisted',
            sub: payload.sub,
          }),
        );
        throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
      }
      revocationCheckUnavailable = userStatus === 'unavailable';
    }

    if (revocationCheckUnavailable) {
      await this.applyDegradedMode(payload);
    }

    return {
      sub: payload.sub,
      userId: payload.sub,
      user_id: payload.sub,
      email: payload.email,
      mfa_pending: payload.mfa_pending ?? false,
      sid: payload.sid ?? null,
    };
  }

  /**
   * The revocation cache (Redis) could not be consulted. Apply the configured
   * AUTH_BLACKLIST_DEGRADED_MODE:
   * - db-session: verify the Better Auth session row named by `sid` (every
   *   server-side revocation path deletes it). No `sid` => behave like reject.
   * - reject: fail closed with 503.
   * - allow: accept the token (availability over revocation) and warn.
   */
  private async applyDegradedMode(payload: JwtPayload): Promise<void> {
    this.logDegraded(payload);

    if (this.degradedMode === 'allow') return;

    if (this.degradedMode === 'db-session' && payload.sid) {
      await this.assertSessionActive(payload.sid, payload.sub);
      return;
    }

    throw new AppServiceUnavailableException(
      ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
    );
  }

  private async assertSessionActive(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    let session: { id: string } | null;
    try {
      session = await this.prisma.session.findFirst({
        where: { id: sessionId, userId, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
    } catch (error) {
      // Neither Redis nor the database can vouch for the token.
      this.logger.error(
        JSON.stringify({
          event: 'auth_jwt_session_lookup_failed',
          sub: userId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }

    if (!session) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_session_missing_degraded',
          sub: userId,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }
  }

  private logDegraded(payload: JwtPayload): void {
    const now = Date.now();
    if (now - this.lastDegradedLogAt < DEGRADED_LOG_INTERVAL_MS) return;
    this.lastDegradedLogAt = now;
    this.logger.warn(
      JSON.stringify({
        event: 'auth_jwt_revocation_check_unavailable',
        mode: this.degradedMode,
        hasSid: Boolean(payload.sid),
      }),
    );
  }

  private extractToken(req: Request): string | null {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice('Bearer '.length).trim();
  }
}
