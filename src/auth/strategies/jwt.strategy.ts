import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  /**
   * Present and `true` when the user has TOTP enrolled but has not yet completed
   * the second factor after password login. Endpoints that require full auth
   * (aal2) should be blocked until this is cleared by POST /auth/mfa/verify.
   */
  mfa_pending?: boolean;
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
    });

    this.logger.log('JWT verification via HS256 (BETTER_AUTH_SECRET)');
  }

  async validate(req: Request, payload: JwtPayload) {
    const token = this.extractToken(req);

    if (token && (await this.tokenBlacklistService.isBlacklisted(token))) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_jwt_revoked_token',
          sub: payload.sub,
        }),
      );
      throw new UnauthorizedException('revoked');
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
      throw new UnauthorizedException('revoked');
    }

    return {
      sub: payload.sub,
      userId: payload.sub,
      user_id: payload.sub,
      email: payload.email,
      mfa_pending: payload.mfa_pending ?? false,
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
