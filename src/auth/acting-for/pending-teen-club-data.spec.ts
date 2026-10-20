import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertActingScope } from './acting-scope.policy';
import {
  AGE_UNKNOWN_SCOPES,
  DEVICE_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
  principalSeesClubData,
  type ActingForScope,
  type PrincipalKind,
} from './auth-principal';
import { collectRoutes, type RouteInfo } from './route-registry.testing';

/**
 * Ruling (option A): a pending teen (supervised_user not `active`) and an
 * age_unknown_user get NO club data and NO member credential until a guardian
 * is verified, also with an active club assignment from before the deploy.
 *
 * The route-level half of that rule: the credential (QR) and the club-context
 * switch are unreachable for those principals (403 PRINCIPAL_SCOPE_DENIED from
 * the default-deny machinery). The /auth/me half is in auth.service.spec.ts
 * and strip-club-context.spec.ts.
 */

const CREDENTIAL_ROUTES = [
  'GET /qr/me',
  'GET /qr/me/card',
  'GET /qr/me/card.pdf',
  'GET /qr/member/token',
];
const CONTEXT_ROUTES = ['PATCH /auth/me/context'];

const contextOf = (route: RouteInfo) =>
  ({
    getHandler: () => route.handler,
    getClass: () => route.controller,
  }) as never;

const attempt = (
  route: RouteInfo,
  principal: {
    kind: PrincipalKind;
    scopes: readonly ActingForScope[];
    supervision?: 'pending_guardian' | 'active';
  },
): AppException | null => {
  try {
    assertActingScope(new Reflector(), contextOf(route), principal);
    return null;
  } catch (error) {
    return error as AppException;
  }
};

describe('pending teen / unknown age: no club data from QR or context switch', () => {
  let routes: RouteInfo[];
  const find = (key: string): RouteInfo => {
    const route = routes.find((r) => r.key === key);
    expect(route).toBeDefined();
    return route!;
  };

  beforeAll(() => {
    routes = collectRoutes();
  });

  const BLOCKED: Array<{
    label: string;
    kind: PrincipalKind;
    scopes: readonly ActingForScope[];
    supervision?: 'pending_guardian';
  }> = [
    {
      label: 'pending teen',
      kind: 'supervised_user',
      scopes: TEEN_PENDING_SCOPES,
      supervision: 'pending_guardian',
    },
    {
      label: 'unknown age',
      kind: 'age_unknown_user',
      scopes: AGE_UNKNOWN_SCOPES,
    },
  ];

  it('principalSeesClubData is false for both blocked principals', () => {
    expect(
      principalSeesClubData({
        kind: 'supervised_user',
        supervision: 'pending_guardian',
      }),
    ).toBe(false);
    expect(principalSeesClubData({ kind: 'age_unknown_user' })).toBe(false);
  });

  it('principalSeesClubData is true for a linked device: it only authenticates while the pairing guardianship is VERIFIED (the same bar as an active teen)', () => {
    expect(principalSeesClubData({ kind: 'linked_device' })).toBe(true);
    // ...and still true for every principal that has club data today.
    expect(principalSeesClubData({ kind: 'user' })).toBe(true);
    expect(principalSeesClubData({ kind: 'guardian_acting' })).toBe(true);
    expect(
      principalSeesClubData({ kind: 'supervised_user', supervision: 'active' }),
    ).toBe(true);
  });

  describe.each(BLOCKED)(
    '$label (with an active pre-deploy assignment)',
    (principal) => {
      it.each(CREDENTIAL_ROUTES)('%s is 403 PRINCIPAL_SCOPE_DENIED', (key) => {
        const thrown = attempt(find(key), principal);
        expect(thrown).toBeInstanceOf(AppException);
        expect(thrown!.code).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
      });

      it.each(CONTEXT_ROUTES)('%s is 403 PRINCIPAL_SCOPE_DENIED', (key) => {
        const thrown = attempt(find(key), principal);
        expect(thrown).toBeInstanceOf(AppException);
        expect(thrown!.code).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
      });
    },
  );

  it('a verified, active teen keeps the full credential and the context switch', () => {
    for (const key of [...CREDENTIAL_ROUTES, ...CONTEXT_ROUTES]) {
      expect(
        attempt(find(key), {
          kind: 'supervised_user',
          scopes: TEEN_SCOPES,
          supervision: 'active',
        }),
      ).toBeNull();
    }
  });

  it('a guardian acting (pending or verified) and a device keep the credential, as before Phase 3', () => {
    for (const key of CREDENTIAL_ROUTES) {
      for (const scopes of [
        GUARDIAN_PENDING_SCOPES,
        GUARDIAN_VERIFIED_SCOPES,
      ]) {
        expect(
          attempt(find(key), { kind: 'guardian_acting', scopes }),
        ).toBeNull();
      }
      expect(
        attempt(find(key), { kind: 'linked_device', scopes: DEVICE_SCOPES }),
      ).toBeNull();
    }
  });

  it('a device never switches the club context', () => {
    const thrown = attempt(find('PATCH /auth/me/context'), {
      kind: 'linked_device',
      scopes: DEVICE_SCOPES,
    });
    expect(thrown!.code).toBe(ErrorCode.PRINCIPAL_SCOPE_DENIED);
  });
});
