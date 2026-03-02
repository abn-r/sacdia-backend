import {
  Injectable,
  ExecutionContext,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
  ) {
    if (err || !user) {
      const request = context.switchToHttp().getRequest<Request>();
      const reason = this.resolveReason(err, info);

      this.logger.warn(
        JSON.stringify({
          event: 'auth_guard_unauthorized',
          method: request?.method,
          url: request?.url,
          reason,
        }),
      );

      throw new UnauthorizedException('Unauthorized');
    }

    return user;
  }

  private resolveReason(err: any, info: any): string {
    const raw =
      (info?.message as string) ||
      (info?.name as string) ||
      (err?.message as string) ||
      '';
    const lower = raw.toLowerCase();

    if (lower.includes('no auth token')) return 'missing';
    if (lower.includes('revoked')) return 'revoked';
    if (lower.includes('expired')) return 'expired';
    if (lower.includes('invalid signature') || lower.includes('invalid token')) {
      return 'invalid_signature';
    }
    if (lower.includes('malformed')) return 'malformed';

    return 'unauthorized';
  }
}
