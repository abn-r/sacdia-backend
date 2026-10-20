import { Controller, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActingScope } from '../../auth/acting-for/acting-scope.decorator';
import { SkipMfaCheck } from '../decorators/skip-mfa-check.decorator';
import {
  actingForForbidden,
  actingForHeaderInvalid,
  deviceRevoked,
  deviceSessionExpired,
  supervisedAccessRevoked,
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

  @Post('mfa-verify')
  @SkipMfaCheck()
  mfaVerify() {
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

const teenPrincipal = (
  scopes: string[],
  supervision: 'pending_guardian' | 'active' = 'pending_guardian',
) => ({
  sub: 'teen',
  user_id: 'teen',
  actor_sub: 'teen',
  kind: 'supervised_user',
  acting_for: false,
  supervision,
  scopes,
  mfa_pending: false,
});

const devicePrincipal = (scopes: string[]) => ({
  sub: 'child',
  user_id: 'child',
  actor_sub: 'child',
  kind: 'linked_device',
  acting_for: false,
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

    it('denies a supervised teen on an unscoped route with PRINCIPAL_SCOPE_DENIED (403)', () => {
      try {
        guard.handleRequest(
          null,
          teenPrincipal(['self:read']),
          null,
          contextFor('unscoped'),
        );
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCode.PRINCIPAL_SCOPE_DENIED,
          status: 403,
        });
        expect((error as any).getResponse().details).toEqual({
          required_scope: null,
          kind: 'supervised_user',
          supervision: 'pending_guardian',
        });
      }
    });

    it('denies a linked device that lacks the declared scope and allows one that holds it', () => {
      expect(() =>
        guard.handleRequest(
          null,
          devicePrincipal(['self:read']),
          null,
          contextFor('write'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED }),
      );
      const device = devicePrincipal(['profile:write']);
      expect(guard.handleRequest(null, device, null, contextFor('write'))).toBe(
        device,
      );
    });

    it('lets an aal1 teen reach the @SkipMfaCheck route that completes the second factor, but nothing else', () => {
      const aal1Teen = { ...teenPrincipal(['self:read']), mfa_pending: true };
      expect(
        guard.handleRequest(null, aal1Teen, null, contextFor('mfaVerify')),
      ).toBe(aal1Teen);
      // An aal1 token still cannot use regular routes.
      expect(() =>
        guard.handleRequest(null, aal1Teen, null, contextFor('scoped')),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.GUARD_MFA_REQUIRED }),
      );
    });

    it('lets an aal1 unknown-age account (legacy TOTP, post-registration open) reach the MFA completion route, but nothing else', () => {
      const aal1Newcomer = {
        sub: 'n1',
        user_id: 'n1',
        actor_sub: 'n1',
        kind: 'age_unknown_user',
        acting_for: false,
        scopes: ['self:read'],
        mfa_pending: true,
      };
      expect(
        guard.handleRequest(null, aal1Newcomer, null, contextFor('mfaVerify')),
      ).toBe(aal1Newcomer);
      expect(() =>
        guard.handleRequest(null, aal1Newcomer, null, contextFor('scoped')),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.GUARD_MFA_REQUIRED }),
      );
      // Fully authenticated, the unscoped route is the uniform scope denial.
      expect(() =>
        guard.handleRequest(
          null,
          { ...aal1Newcomer, mfa_pending: false },
          null,
          contextFor('unscoped'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED }),
      );
    });

    it('does not extend the MFA exemption to a device or a guardian acting', () => {
      const aal1Device = {
        ...devicePrincipal(['self:read']),
        mfa_pending: false,
      };
      expect(() =>
        guard.handleRequest(null, aal1Device, null, contextFor('mfaVerify')),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED }),
      );
      expect(() =>
        guard.handleRequest(
          null,
          actingPrincipal(['self:read']),
          null,
          contextFor('mfaVerify'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.ACTING_FOR_SCOPE_DENIED }),
      );
    });

    it('rethrows AUTH_SUPERVISED_ACCESS_REVOKED instead of converting it to GUARD_JWT_UNAUTHORIZED', () => {
      const error = supervisedAccessRevoked();
      let thrown: unknown;
      try {
        guard.handleRequest(error, false, null, contextFor('scoped'));
      } catch (caught) {
        thrown = caught;
      }
      expect(thrown).toBe(error);
      expect((thrown as any).code).toBe(
        ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
      );
      expect((thrown as any).getStatus()).toBe(401);
    });

    it.each([
      ['AUTH_DEVICE_REVOKED', deviceRevoked, ErrorCode.AUTH_DEVICE_REVOKED],
      [
        'AUTH_DEVICE_SESSION_EXPIRED',
        deviceSessionExpired,
        ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
      ],
    ])(
      'rethrows %s so the child app can tell "unlinked" from a plain expired token (3b)',
      (_name, make, code) => {
        const error = make();
        let thrown: unknown;
        try {
          guard.handleRequest(error, false, null, contextFor('scoped'));
        } catch (caught) {
          thrown = caught;
        }
        expect(thrown).toBe(error);
        expect((thrown as any).code).toBe(code);
        expect((thrown as any).getStatus()).toBe(401);
      },
    );

    it('a device principal on a route with NO scope is PRINCIPAL_SCOPE_DENIED, never the acting code', () => {
      expect(() =>
        guard.handleRequest(
          null,
          devicePrincipal(['self:read']),
          null,
          contextFor('unscoped'),
        ),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED }),
      );
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
      teenPrincipal(['self:read']),
      teenPrincipal(['self:read', 'profile:write'], 'active'),
      devicePrincipal(['self:read']),
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

    it('downgrades a supervised teen and a device to anonymous on an unscoped route', () => {
      expect(
        optionalGuard.handleRequest(
          null,
          teenPrincipal(['self:read']),
          null,
          contextFor('unscoped'),
        ),
      ).toBeNull();
      expect(
        optionalGuard.handleRequest(
          null,
          devicePrincipal(['self:read']),
          null,
          contextFor('unscoped'),
        ),
      ).toBeNull();
    });

    it('keeps a teen that holds the declared scope', () => {
      const principal = teenPrincipal(['self:read'], 'active');
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
