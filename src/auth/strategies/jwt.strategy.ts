import { Injectable, Logger } from '@nestjs/common';
import { AppUnauthorizedException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';
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

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
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

    this.logger.log('JWT verification via HS256 (BETTER_AUTH_SECRET)');
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

    if (token && (await this.tokenBlacklistService.isBlacklisted(token))) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_revoked_token',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    if (
      payload.sub &&
      payload.iat &&
      (await this.tokenBlacklistService.isUserBlacklisted(
        payload.sub,
        payload.iat,
      ))
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_user_blacklisted',
          sub: payload.sub,
        }),
      );
      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
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

  private extractToken(req: Request): string | null {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.slice('Bearer '.length).trim();
  }
}
