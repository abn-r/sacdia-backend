import {
  Injectable,
  ExecutionContext,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  AppException,
  AppForbiddenException,
  AppUnauthorizedException,
} from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { SKIP_MFA_CHECK_KEY } from './mfa.guard';
import {
  isActingForError,
  isSupervisedAccessError,
} from '../../auth/acting-for/acting-for.errors';
import { assertActingScope } from '../../auth/acting-for/acting-scope.policy';

/** True for the 503 JwtStrategy raises when revocation cannot be verified. */
export function isRevocationCheckUnavailable(
  err: unknown,
): err is AppException {
  return (
    err instanceof AppException &&
    err.getStatus() === HttpStatus.SERVICE_UNAVAILABLE &&
    err.code === ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE
  );
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(protected readonly reflector: Reflector) {
    super();
  }

  // NOTE: deliberately ignores @Public(). A route-level
  // @UseGuards(JwtAuthGuard) must enforce auth even inside a controller
  // marked @Public() at class level (see GlobalJwtAuthGuard).
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // The revocation check could not be performed (Redis down, degraded mode
    // reject / db-session without sid). That is a server-side condition, not
    // an authentication failure: surface the 503 so clients retry instead of
    // logging the user out.
    if (isRevocationCheckUnavailable(err)) {
      const request = context.switchToHttp().getRequest<Request>();
      this.logger.warn(
        JSON.stringify({
          event: 'auth_guard_revocation_check_unavailable',
          method: request?.method,
          url: request?.url,
        }),
      );
      throw err;
    }

    // Acting-for refusals (400/403) are about the acted profile, not about the
    // session: never turn them into a 401, which would log the guardian out.
    if (isActingForError(err)) {
      throw err;
    }

    // A supervised teen whose access was disabled, reset or frozen gets the
    // specific 401 (not the generic one) so the app can explain it.
    if (isSupervisedAccessError(err)) {
      throw err;
    }

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

      throw new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED);
    }

    const skipMfaCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_MFA_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!skipMfaCheck && user.mfa_pending === true) {
      throw new AppForbiddenException(ErrorCode.GUARD_MFA_REQUIRED);
    }

    // A supervised teen (or an unknown-age account with a legacy TOTP) holds
    // an aal1 token until they complete the second factor. The route that
    // completes it (@SkipMfaCheck) is MFA machinery, not part of any scope
    // set, so it must stay reachable.
    if (
      skipMfaCheck &&
      (user.kind === 'supervised_user' || user.kind === 'age_unknown_user') &&
      user.mfa_pending === true
    ) {
      return user;
    }

    // A restricted principal (guardian acting for a dependent, supervised teen,
    // linked device) only reaches routes that declare a scope it holds. Checked here, next to the principal
    // creation, so the global guard and every local re-run always agree.
    assertActingScope(this.reflector, context, user);

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
    if (
      lower.includes('invalid signature') ||
      lower.includes('invalid token')
    ) {
      return 'invalid_signature';
    }
    if (lower.includes('audience') || lower.includes('issuer')) {
      return 'invalid_claims';
    }
    if (lower.includes('malformed')) return 'malformed';

    return 'unauthorized';
  }
}
