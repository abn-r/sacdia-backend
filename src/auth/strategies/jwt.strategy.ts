import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import type { Request } from 'express';
import { TokenBlacklistService } from '../../common/services/token-blacklist.service';

export interface JwtPayload {
  sub: string; // user_id
  email: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private readonly tokenBlacklistService: TokenBlacklistService,
  ) {
    const supabaseUrl = configService.get<string>('SUPABASE_URL');
    const jwtSecret = configService.get<string>('SUPABASE_JWT_SECRET');

    if (!supabaseUrl && !jwtSecret) {
      throw new Error(
        'Either SUPABASE_URL (for JWKS) or SUPABASE_JWT_SECRET (legacy) is required.',
      );
    }

    const jwksUri = supabaseUrl
      ? `${supabaseUrl}/auth/v1/.well-known/jwks.json`
      : null;

    const strategyOptions: Record<string, unknown> = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
    };

    if (jwksUri) {
      // JWKS (ES256) with HS256 fallback for transition period
      strategyOptions.secretOrKeyProvider = passportJwtSecret({
        jwksUri,
        cache: true,
        cacheMaxAge: 600_000, // 10 min
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        handleSigningKeyError: (err, cb) => {
          // Fallback to legacy HS256 if JWKS verification fails
          if (jwtSecret) {
            (cb as (err: Error | null, key?: string) => void)(null, jwtSecret);
          } else {
            cb(err);
          }
        },
      });
      strategyOptions.algorithms = ['ES256', 'HS256'];
    } else {
      strategyOptions.secretOrKey = jwtSecret;
      strategyOptions.algorithms = ['HS256'];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(strategyOptions as any);

    if (jwksUri) {
      this.logger.log(`JWT verification via JWKS: ${jwksUri}`);
    } else {
      this.logger.warn('JWT verification via legacy HS256 shared secret');
    }
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
