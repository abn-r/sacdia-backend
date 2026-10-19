import { Controller, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActingScope } from '../../auth/acting-for/acting-scope.decorator';
import {
  actingForForbidden,
  actingForHeaderInvalid,
} from '../../auth/acting-for/acting-for.errors';
import { ErrorCode } from '../errors/error-codes';
import { AppUnauthorizedException } from '../errors/app.exception';
import { GlobalJwtAuthGuard } from './global-jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

@Controller('probe')
class ProbeController {
  @Get('scoped')
  @ActingScope('self:read')
  scoped() {
    return 'ok';
  }

  @Post('write')
  @ActingScope('profile:write')
  write() {
    return 'ok';
  }

  @Get('unscoped')
  unscoped() {
    return 'ok';
  }
}

const contextFor = (method: keyof ProbeController) =>
  ({
    getHandler: () => ProbeController.prototype[method],
    getClass: () => ProbeController,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/v1/probe' }),
    }),
  }) as any;

const userPrincipal = {
  sub: 'u1',
  user_id: 'u1',
  kind: 'user',
  scopes: null,
  mfa_pending: false,
};

const actingPrincipal = (scopes: string[]) => ({
  sub: 'dep',
  user_id: 'dep',
  actor_sub: 'guardian',
  kind: 'guardian_acting',
  acting_for: true,
  scopes,
  mfa_pending: false,
});

describe('acting-for scope enforcement in the passport guards', () => {
  const reflector = new Reflector();
  const jwtGuard = new JwtAuthGuard(reflector);
  const globalGuard = new GlobalJwtAuthGuard(reflector);
  const optionalGuard = new OptionalJwtAuthGuard(reflector);

  describe.each([
    ['JwtAuthGuard (route-level)', jwtGuard],
    ['GlobalJwtAuthGuard (APP_GUARD)', globalGuard],
  ])('%s', (_name, guard) => {
    it('lets a plain user through regardless of scope metadata', () => {
      const user = guard.handleRequest(
        null,
        userPrincipal,
        null,
        contextFor('unscoped'),
      );
      expect(user).toBe(userPrincipal);
    });

    it('denies an acting principal on a route with NO scope metadata (403)', () => {
      expect(() =>
        guard.handleRequest(
          null,
          actingPrincipal(['self:read', 'profile:write']),
          null,
          contextFor('unscoped'),
        ),
      ).toThrow(
        expect.objectContaining({
          code: ErrorCode.ACTING_FOR_SCOPE_DENIED,
          status: 403,
        }),
      );
    });

    it('denies an acting principal that lacks the declared scope', () => {
      expect(() =>
        guard.handleRequest(
          null,
          actingPrincipal(['self:read']),
          null,
          contextFor('write'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.ACTING_FOR_SCOPE_DENIED }),
      );
    });

    it('allows an acting principal that holds the declared scope', () => {
      const principal = actingPrincipal(['self:read']);
      expect(
        guard.handleRequest(null, principal, null, contextFor('scoped')),
      ).toBe(principal);
    });

    it('rethrows acting-for errors untouched instead of converting them to 401', () => {
      for (const error of [actingForForbidden(), actingForHeaderInvalid()]) {
        let thrown: unknown;
        try {
          guard.handleRequest(error, false, null, contextFor('scoped'));
        } catch (caught) {
          thrown = caught;
        }
        expect(thrown).toBe(error);
      }
    });

    it('still maps ordinary strategy failures to GUARD_JWT_UNAUTHORIZED', () => {
      expect(() =>
        guard.handleRequest(
          new AppUnauthorizedException(ErrorCode.GUARD_JWT_UNAUTHORIZED),
          false,
          null,
          contextFor('scoped'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.GUARD_JWT_UNAUTHORIZED }),
      );
    });
  });

  it('the local and the global guard agree on every principal/route pair', () => {
    const principals = [
      userPrincipal,
      actingPrincipal(['self:read']),
      actingPrincipal(['self:read', 'profile:write']),
      actingPrincipal([]),
    ];
    const methods: Array<keyof ProbeController> = [
      'scoped',
      'write',
      'unscoped',
    ];

    for (const principal of principals) {
      for (const method of methods) {
        const outcome = (guard: JwtAuthGuard) => {
          try {
            guard.handleRequest(null, principal, null, contextFor(method));
            return 'allowed';
          } catch (error) {
            return (error as { code?: string }).code;
          }
        };
        expect(outcome(jwtGuard)).toBe(outcome(globalGuard));
      }
    }
  });

  describe('OptionalJwtAuthGuard', () => {
    it('attaches a plain user', () => {
      expect(
        optionalGuard.handleRequest(
          null,
          userPrincipal,
          null,
          contextFor('unscoped'),
        ),
      ).toBe(userPrincipal);
    });

    it('downgrades an acting principal to anonymous on a route with no scope', () => {
      expect(
        optionalGuard.handleRequest(
          null,
          actingPrincipal(['self:read']),
          null,
          contextFor('unscoped'),
        ),
      ).toBeNull();
    });

    it('downgrades an acting principal that lacks the declared scope', () => {
      expect(
        optionalGuard.handleRequest(
          null,
          actingPrincipal(['self:read']),
          null,
          contextFor('write'),
        ),
      ).toBeNull();
    });

    it('keeps an acting principal that holds the declared scope', () => {
      const principal = actingPrincipal(['self:read']);
      expect(
        optionalGuard.handleRequest(
          null,
          principal,
          null,
          contextFor('scoped'),
        ),
      ).toBe(principal);
    });

    it('never downgrades acting-for errors to anonymous', () => {
      for (const error of [actingForForbidden(), actingForHeaderInvalid()]) {
        expect(() =>
          optionalGuard.handleRequest(
            error,
            false,
            null,
            contextFor('unscoped'),
          ),
        ).toThrow(error);
      }
    });
  });
});
