import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertActingScope } from './acting-scope.policy';
import {
  ACTING_FOR_SCOPES,
  RELEASED_FROZEN_SCOPES,
  RELEASED_PENDING_SCOPES,
  TEEN_SCOPES,
  TEEN_PENDING_SCOPES,
  DEVICE_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  AGE_UNKNOWN_SCOPES,
  type ActingForScope,
} from './auth-principal';
import { collectRoutes, type RouteInfo } from './route-registry.testing';

/**
 * Server gate of the majority release (Phase 4, design D1): the `released_user`
 * principal is default-deny. This spec enumerates the REAL controller registry
 * and pins the exact allow-list of routes a released adult (pending AND frozen:
 * ruling R1 thaw makes the sets identical) can reach. Everything else is a 403
 * PRINCIPAL_SCOPE_DENIED {kind: 'released_user'}.
 *
 * Batch 4b added POST /users/me/release/email. The adult-claim routes
 * (issue by former guardian / director, public redeem) carry NO scope on
 * purpose: a released principal is denied there like everywhere else.
 */
const RELEASED_ALLOWED_ROUTES: Record<string, ActingForScope[]> = {
  'GET /auth/me': ['self:read', 'release:read'],
  'GET /users/me/legal-acceptance': ['self:read', 'release:read'],
  'POST /users/me/legal-acceptance': ['legal:accept'],
  'POST /users/me/release/email': ['release:email'],
  'POST /auth/verify-email/send': ['self:password', 'release:email'],
  'POST /users/me/data-export': ['data:export'],
  'GET /users/me/data-exports': ['data:export'],
  'GET /users/me/data-exports/:exportId/download': ['data:export'],
  // The own account (delete, sessions, linked providers): account:manage.
  'GET /auth/sessions': ['account:manage'],
  'DELETE /auth/sessions': ['account:manage'],
  'DELETE /auth/sessions/:sessionId': ['account:manage'],
  'DELETE /auth/me': ['account:manage'],
  'GET /auth/oauth/providers': ['account:manage'],
};

/** Scopes that ONLY the released principal holds. */
const RELEASED_ONLY_SCOPES: ActingForScope[] = [
  'release:read',
  'release:email',
  'data:export',
];

const contextOf = (route: RouteInfo) =>
  ({
    getHandler: () => route.handler,
    getClass: () => route.controller,
  }) as never;

const isAllowed = (
  route: RouteInfo,
  scopes: readonly ActingForScope[],
): boolean => {
  try {
    assertActingScope(new Reflector(), contextOf(route), {
      kind: 'released_user',
      scopes,
    });
    return true;
  } catch {
    return false;
  }
};

describe('released_user server gate (allow-list)', () => {
  let routes: RouteInfo[];

  beforeAll(() => {
    routes = collectRoutes();
  });

  it('pending and frozen hold the same scopes (R1 thaw) and never self:read', () => {
    expect([...RELEASED_FROZEN_SCOPES].sort()).toEqual(
      [...RELEASED_PENDING_SCOPES].sort(),
    );
    expect(RELEASED_PENDING_SCOPES).not.toContain('self:read');
    for (const scope of RELEASED_PENDING_SCOPES) {
      expect(ACTING_FOR_SCOPES).toContain(scope);
    }
  });

  it.each([
    ['pending', RELEASED_PENDING_SCOPES],
    ['frozen', RELEASED_FROZEN_SCOPES],
  ] as const)(
    '%s reaches EXACTLY the allow-listed routes (nothing gained, nothing lost)',
    (_phase, scopes) => {
      const reachable = routes
        .filter((route) => isAllowed(route, scopes))
        .map((route) => route.key)
        .sort();
      expect(reachable).toEqual(Object.keys(RELEASED_ALLOWED_ROUTES).sort());
    },
  );

  it('every allow-listed route declares exactly the expected any-of scopes', () => {
    for (const [key, expected] of Object.entries(RELEASED_ALLOWED_ROUTES)) {
      const route = routes.find((r) => r.key === key);
      expect({ key, exists: route !== undefined }).toEqual({
        key,
        exists: true,
      });
      expect([...(route as RouteInfo).scopes].sort()).toEqual(
        [...expected].sort(),
      );
    }
  });

  it('release:* and data:export live ONLY on the allow-listed routes', () => {
    for (const route of routes) {
      const carries = route.scopes.some((scope) =>
        RELEASED_ONLY_SCOPES.includes(scope),
      );
      if (carries) {
        expect(Object.keys(RELEASED_ALLOWED_ROUTES)).toContain(route.key);
      }
    }
  });

  it('no other restricted kind holds a released-only scope', () => {
    for (const set of [
      TEEN_SCOPES,
      TEEN_PENDING_SCOPES,
      DEVICE_SCOPES,
      GUARDIAN_VERIFIED_SCOPES,
      AGE_UNKNOWN_SCOPES,
    ]) {
      for (const scope of RELEASED_ONLY_SCOPES) {
        expect(set).not.toContain(scope);
      }
    }
  });

  it('an unscoped or club/teen route is denied with PRINCIPAL_SCOPE_DENIED {kind: released_user}', () => {
    const denied = routes.filter(
      (route) => !isAllowed(route, RELEASED_PENDING_SCOPES),
    );
    expect(denied.length).toBeGreaterThan(400);
    for (const route of denied.slice(0, 50)) {
      try {
        assertActingScope(new Reflector(), contextOf(route), {
          kind: 'released_user',
          scopes: RELEASED_PENDING_SCOPES,
        });
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).code).toBe(
          ErrorCode.PRINCIPAL_SCOPE_DENIED,
        );
        expect((error as AppException).getResponse()).toMatchObject({
          details: { kind: 'released_user' },
        });
      }
    }
  });

  it.each([
    'GET /dashboard/summary',
    'GET /users/:userId',
    'GET /guardianships/me',
    'POST /fcm-tokens',
  ])('%s is denied for a released adult', (key) => {
    const route = routes.find((r) => r.key === key);
    if (!route) return; // renamed route: covered by the exact-equality test above
    expect(isAllowed(route, RELEASED_PENDING_SCOPES)).toBe(false);
  });
});
