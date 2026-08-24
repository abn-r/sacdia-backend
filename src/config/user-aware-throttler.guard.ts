import { Reflector } from '@nestjs/core';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_JWT_AUDIENCE,
  ACCESS_JWT_ISSUER,
} from '../common/constants/jwt-audiences';
import { resolveClientIp } from './client-ip';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions()
    options: ThrottlerModuleOptions,
    @InjectThrottlerStorage()
    storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(
    req: Record<string, any>,
  ): Promise<string> {
    const userId = this.extractUserId(req?.user);
    if (userId) {
      return `user:${userId}`;
    }

    const authorization = this.extractAuthorizationHeader(req);
    const token = this.extractBearerToken(authorization);

    if (token) {
      const userIdFromToken = await this.extractSubFromVerifiedToken(token);
      if (userIdFromToken) {
        return `user:${userIdFromToken}`;
      }
    }

    const ip = this.extractIp(req);

    return `ip:${ip}`;
  }

  private async extractSubFromVerifiedToken(
    token: string,
  ): Promise<string | undefined> {
    const secret = this.configService.get<string>('BETTER_AUTH_SECRET')?.trim();

    if (!secret) {
      return undefined;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret,
        algorithms: ['HS256'],
        issuer: ACCESS_JWT_ISSUER,
        audience: ACCESS_JWT_AUDIENCE,
      });

      if (
        payload &&
        typeof payload === 'object' &&
        typeof payload.sub === 'string' &&
        payload.sub.trim().length > 0
      ) {
        return payload.sub;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  private extractUserId(user?: Record<string, unknown>): string | undefined {
    if (!user) {
      return undefined;
    }

    const userId = user.sub ?? user.user_id;

    if (typeof userId === 'string' && userId.trim().length > 0) {
      return userId;
    }

    return undefined;
  }

  private extractAuthorizationHeader(
    req: Record<string, any>,
  ): string | undefined {
    const headers = req?.headers;
    if (!headers || typeof headers !== 'object') {
      return undefined;
    }

    const authorization = headers.authorization;

    if (Array.isArray(authorization)) {
      return authorization[0];
    }

    if (typeof authorization === 'string') {
      return authorization;
    }

    return undefined;
  }

  private extractBearerToken(authorization?: string): string | undefined {
    if (!authorization) {
      return undefined;
    }

    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return undefined;
    }

    return bearerMatch[1]?.trim();
  }

  private extractIp(req: Record<string, any>): string {
    return resolveClientIp(req);
  }
}
