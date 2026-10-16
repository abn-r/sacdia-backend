import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ACTING_SCOPE_KEY } from './acting-scope.decorator';
import { assertActingScope } from './acting-scope.policy';
import {
  ACTING_FOR_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  type ActingForScope,
} from './auth-principal';

/**
 * Snapshot of every route that declares `@ActingScope(...)`.
 *
 * A route that gains or loses a scope fails this spec, so widening what a
 * guardian can do on behalf of a child is always a reviewed, explicit change.
 * Anything not listed here is denied while acting (deny by default).
 */

type AnyFn = (...args: never[]) => unknown;

interface RouteInfo {
  key: string; // "GET /users/:userId"
  method: string;
  fullPath: string;
  controller: AnyFn;
  handler: AnyFn;
  /** What the policy actually enforces: the handler's scope, else the class's. */
  scope: ActingForScope | undefined;
  handlerScope: ActingForScope | undefined;
  classScope: ActingForScope | undefined;
}

const SRC_ROOT = path.resolve(__dirname, '../..');

function listControllerFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listControllerFiles(full, acc);
    } else if (
      entry.name.endsWith('.controller.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function joinPaths(...parts: string[]): string {
  const joined = '/' + parts.filter((p) => p !== '').join('/');
  const normalized = joined.replace(/\/+/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

function collectRoutes(): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const seen = new Set<AnyFn>();
  for (const file of listControllerFiles(SRC_ROOT)) {
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || seen.has(exported)) continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, exported) as
        string | string[] | undefined;
      if (controllerPath === undefined) continue;
      seen.add(exported);
      const bases = Array.isArray(controllerPath)
        ? controllerPath
        : [controllerPath];
      const proto = (exported as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
          string | string[] | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (methodPath === undefined || method === undefined) continue;
        const methodPaths = Array.isArray(methodPath)
          ? methodPath
          : [methodPath];
        const handlerScope = Reflect.getMetadata(ACTING_SCOPE_KEY, handler) as
          ActingForScope | undefined;
        const classScope = Reflect.getMetadata(ACTING_SCOPE_KEY, exported) as
          ActingForScope | undefined;
        // Same resolution as readActingScope (handler wins over class), so a
        // class-level decorator can never hide from the equality check below.
        const scope = handlerScope ?? classScope;
        for (const base of bases) {
          for (const mp of methodPaths) {
            const fullPath = joinPaths(base, mp);
            const verb = RequestMethod[method];
            routes.push({
              key: `${verb} ${fullPath}`,
              method: verb,
              fullPath,
              controller: exported,
              handler,
              scope,
              handlerScope,
              classScope,
            });
          }
        }
      }
    }
  }
  return routes;
}

/** METHOD path => scope. Edit deliberately: every line is a security decision. */
const EXPECTED_SCOPED_ROUTES: Record<string, ActingForScope> = {
  // ---- self:read
  'GET /auth/me': 'self:read',
  'GET /auth/profile/completion-status': 'self:read',
  'GET /dashboard/summary': 'self:read',
  'GET /users/:userId': 'self:read',
  'GET /users/:userId/allergies': 'self:read',
  'GET /users/:userId/diseases': 'self:read',
  'GET /users/:userId/medicines': 'self:read',
  'GET /users/:userId/age': 'self:read',
  'GET /users/:userId/emergency-contacts': 'self:read',
  'GET /users/:userId/emergency-contacts/:contactId': 'self:read',
  'GET /users/:userId/post-registration/status': 'self:read',
  'GET /users/:userId/post-registration/photo-status': 'self:read',
  'GET /users/:userId/classes': 'self:read',
  'GET /users/:userId/classes/:classId/progress': 'self:read',
  'GET /users/:userId/honors': 'self:read',
  'GET /users/:userId/honors/stats': 'self:read',
  'GET /users/:userId/honors/:honorId/requirements/progress': 'self:read',
  'GET /users/:userId/honors/:honorId/requirements/:requirementId/evidence':
    'self:read',
  'GET /qr/member/token': 'self:read',
  'GET /qr/me': 'self:read',
  'GET /qr/me/card': 'self:read',
  'GET /qr/me/card.pdf': 'self:read',
  'GET /notifications/history': 'self:read',
  'GET /notifications/unread-count': 'self:read',
  'PATCH /notifications/read-all': 'self:read',
  'PATCH /notifications/:deliveryId/read': 'self:read',
  'GET /users/me/legal-acceptance': 'self:read',
  // ---- profile:write
  'PATCH /users/:userId': 'profile:write',
  'PUT /users/:userId/allergies': 'profile:write',
  'PUT /users/:userId/diseases': 'profile:write',
  'PUT /users/:userId/medicines': 'profile:write',
  'DELETE /users/:userId/allergies/:allergyId': 'profile:write',
  'DELETE /users/:userId/diseases/:diseaseId': 'profile:write',
  'DELETE /users/:userId/medicines/:medicineId': 'profile:write',
  'POST /users/:userId/profile-picture': 'profile:write',
  'DELETE /users/:userId/profile-picture': 'profile:write',
  'POST /users/:userId/emergency-contacts': 'profile:write',
  'PATCH /users/:userId/emergency-contacts/:contactId': 'profile:write',
  'DELETE /users/:userId/emergency-contacts/:contactId': 'profile:write',
  'PATCH /auth/me/context': 'profile:write',
  // ---- registration:write
  'POST /users/:userId/post-registration/step-1/complete': 'registration:write',
  'POST /users/:userId/post-registration/step-2/complete': 'registration:write',
  'POST /users/:userId/post-registration/step-3/complete': 'registration:write',
  'POST /users/:userId/post-registration/membership-request/cancel':
    'registration:write',
  'POST /users/:userId/membership/annual-enroll': 'registration:write',
  // ---- classes:write
  'POST /users/:userId/classes/enroll': 'classes:write',
  'PATCH /users/:userId/classes/:classId/progress': 'classes:write',
  'POST /users/:userId/classes/:classId/sections/:sectionId/submit':
    'classes:write',
  // ---- evidence:upload
  'POST /users/:userId/classes/:classId/sections/:sectionId/files':
    'evidence:upload',
  'DELETE /users/:userId/classes/:classId/sections/:sectionId/files/:fileId':
    'evidence:upload',
  'POST /users/:userId/honors/:honorId/files': 'evidence:upload',
  'POST /users/:userId/honors/:honorId/requirements/:requirementId/evidence/upload':
    'evidence:upload',
  'POST /users/:userId/honors/:honorId/requirements/:requirementId/evidence/link':
    'evidence:upload',
  'DELETE /users/:userId/honors/:honorId/requirements/:requirementId/evidence/:evidenceId':
    'evidence:upload',
  // ---- honors:write
  'POST /users/:userId/honors': 'honors:write',
  'POST /users/:userId/honors/bulk': 'honors:write',
  'POST /users/:userId/honors/:honorId': 'honors:write',
  'PATCH /users/:userId/honors/:honorId': 'honors:write',
  'DELETE /users/:userId/honors/:honorId': 'honors:write',
  'PATCH /users/:userId/honors/:honorId/requirements/progress/batch':
    'honors:write',
  'PATCH /users/:userId/honors/:honorId/requirements/:requirementId/progress':
    'honors:write',
  // ---- legal:accept
  'POST /users/me/legal-acceptance': 'legal:accept',
};

/**
 * Routes (or families) that MUST NEVER carry a scope: credentials, sessions,
 * MFA, account deletion, data export, push tokens, guardianship management and
 * everything staff/admin/club facing. Each pattern must match at least one
 * discovered route (a renamed route must not silently drop out of the list).
 */
const NEVER_SCOPE: Array<{
  label: string;
  pattern: RegExp;
}> = [
  { label: 'update-password', pattern: /^POST \/auth\/update-password$/ },
  { label: 'account deletion', pattern: /^DELETE \/auth\/me$/ },
  { label: 'sessions', pattern: /^[A-Z]+ \/auth\/sessions(\/|$)/ },
  { label: 'mfa', pattern: /^[A-Z]+ \/auth\/mfa(\/|$)/ },
  { label: 'oauth', pattern: /^[A-Z]+ \/auth\/oauth(\/|$)/ },
  { label: 'data export', pattern: /^[A-Z]+ \/users\/me\/data-export/ },
  { label: 'fcm tokens', pattern: /^[A-Z]+ \/fcm-tokens(\/|$)/ },
  {
    label: 'notification preferences (users/me)',
    pattern: /^[A-Z]+ \/users\/me\/notification-preferences/,
  },
  {
    label: 'notification preferences (notifications)',
    pattern: /^[A-Z]+ \/notifications\/preferences/,
  },
  {
    label: 'guardianship management',
    pattern: /^[A-Z]+ \/guardianships(\/|$)/,
  },
  {
    label: 'director claim codes',
    pattern: /^POST \/club-sections\/:clubSectionId\/dependents\//,
  },
  {
    label: 'legal representative',
    pattern: /^[A-Z]+ \/users\/:userId\/legal-representative/,
  },
  {
    label: 'guardian-only post-registration exit',
    pattern:
      /^POST \/users\/:userId\/post-registration\/step-3\/guardian-only$/,
  },
  {
    label: 'requires-legal-representative',
    pattern: /^GET \/users\/:userId\/requires-legal-representative$/,
  },
  {
    label: 'honor instructor proposal',
    pattern: /^[A-Z]+ \/users\/:userId\/honors\/:honorId\/instructor-proposal/,
  },
  {
    label: 'master honors',
    pattern: /^[A-Z]+ \/users\/:userId\/master-honors/,
  },
  { label: 'certifications', pattern: /^[A-Z]+ \/certifications(\/|$)/ },
  { label: 'admin', pattern: /^[A-Z]+ \/admin(\/|$)/ },
  { label: 'club routes', pattern: /^[A-Z]+ \/clubs(\/|$)/ },
  { label: 'club sections', pattern: /^[A-Z]+ \/club-sections(\/|$)/ },
  {
    label: 'membership requests',
    pattern: /^[A-Z]+ \/club-sections\/.*membership-requests/,
  },
  { label: 'qr scan', pattern: /^POST \/qr\/(validate|scan)$/ },
  {
    label: 'notification senders',
    pattern: /^POST \/notifications\/(send|broadcast|club)/,
  },
  { label: 'legal catalog', pattern: /^GET \/legal\/current$/ },
];

describe('acting-scope metadata snapshot', () => {
  let routes: RouteInfo[];

  beforeAll(() => {
    routes = collectRoutes();
  });

  it('discovers a realistic number of routes (scanner sanity)', () => {
    expect(routes.length).toBeGreaterThan(500);
  });

  it('no controller declares a class-level @ActingScope (every route must opt in individually)', () => {
    const offenders = [
      ...new Set(
        routes
          .filter((route) => route.classScope !== undefined)
          .map((route) => (route.controller as { name: string }).name),
      ),
    ];
    expect(offenders).toEqual([]);
  });

  it('declares exactly the expected scoped routes (nothing gained, nothing lost)', () => {
    const actual: Record<string, ActingForScope> = {};
    for (const route of routes) {
      if (route.scope !== undefined) {
        actual[route.key] = route.scope;
      }
    }
    const sorted = (o: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
      );
    expect(sorted(actual)).toEqual(sorted(EXPECTED_SCOPED_ROUTES));
  });

  it('only uses scopes that exist in the vocabulary', () => {
    for (const scope of Object.values(EXPECTED_SCOPED_ROUTES)) {
      expect(ACTING_FOR_SCOPES).toContain(scope);
    }
  });

  it('every expected scoped route really exists (no stale entries)', () => {
    const keys = new Set(routes.map((r) => r.key));
    for (const key of Object.keys(EXPECTED_SCOPED_ROUTES)) {
      expect(keys.has(key)).toBe(true);
    }
  });

  describe('never-scope denylist', () => {
    it.each(NEVER_SCOPE)('$label matches at least one route', ({ pattern }) => {
      expect(routes.some((r) => pattern.test(r.key))).toBe(true);
    });

    it.each(NEVER_SCOPE)(
      '$label carries no scope and is denied for a verified guardian',
      ({ pattern }) => {
        const reflector = new Reflector();
        for (const route of routes.filter((r) => pattern.test(r.key))) {
          expect(route.scope).toBeUndefined();
          const context = {
            getHandler: () => route.handler,
            getClass: () => route.controller,
          } as never;
          const principal = {
            kind: 'guardian_acting' as const,
            scopes: GUARDIAN_VERIFIED_SCOPES,
          };
          let thrown: unknown;
          try {
            assertActingScope(reflector, context, principal);
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(AppException);
          expect((thrown as AppException).code).toBe(
            ErrorCode.ACTING_FOR_SCOPE_DENIED,
          );
        }
      },
    );
  });

  describe('scope vs grant status', () => {
    it('a pending grant cannot reach classes/honors/evidence routes', () => {
      const reflector = new Reflector();
      const pending = new Set<string>(GUARDIAN_PENDING_SCOPES);
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        const context = {
          getHandler: () => route.handler,
          getClass: () => route.controller,
        } as never;
        const principal = {
          kind: 'guardian_acting' as const,
          scopes: GUARDIAN_PENDING_SCOPES,
        };
        const expectAllowed = pending.has(route.scope as string);
        let allowed = true;
        try {
          assertActingScope(reflector, context, principal);
        } catch {
          allowed = false;
        }
        expect({ route: route.key, allowed }).toEqual({
          route: route.key,
          allowed: expectAllowed,
        });
      }
    });

    it('a verified grant reaches every scoped route', () => {
      const reflector = new Reflector();
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        const context = {
          getHandler: () => route.handler,
          getClass: () => route.controller,
        } as never;
        expect(() =>
          assertActingScope(reflector, context, {
            kind: 'guardian_acting',
            scopes: GUARDIAN_VERIFIED_SCOPES,
          }),
        ).not.toThrow();
      }
    });

    it('an unscoped route is denied even for a verified grant', () => {
      const reflector = new Reflector();
      const unscoped = routes.find((r) => r.scope === undefined);
      expect(unscoped).toBeDefined();
      expect(() =>
        assertActingScope(
          reflector,
          {
            getHandler: () => unscoped!.handler,
            getClass: () => unscoped!.controller,
          } as never,
          { kind: 'guardian_acting', scopes: GUARDIAN_VERIFIED_SCOPES },
        ),
      ).toThrow();
    });
  });
});
