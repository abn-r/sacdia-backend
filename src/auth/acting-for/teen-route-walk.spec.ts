import 'reflect-metadata';
import { UseGuards, Controller, Get } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  PERMISSIONS_KEY,
  RequirePermissions,
  type PermissionRequirement,
} from '../../common/decorators/permissions.decorator';
import {
  SKIP_PERMISSIONS_KEY,
  SkipPermissions,
} from '../../common/decorators/skip-permissions.decorator';
import {
  AUTHORIZATION_RESOURCE_KEY,
  type AuthorizationResourceMetadata,
} from '../../common/decorators/authorization-resource.decorator';
import { GLOBAL_ROLES_KEY } from '../../common/decorators/global-roles.decorator';
import { CLUB_ROLES_KEY } from '../../common/guards/club-roles.guard';
import { ACTING_SCOPE_KEY } from './acting-scope.decorator';
import { assertActingScope } from './acting-scope.policy';
import {
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
  type ActingForScope,
} from './auth-principal';
import {
  collectRoutes,
  type AnyFn,
  type RouteInfo,
} from './route-registry.testing';

/**
 * THE teen route walk (mitigation of the top Phase 3 risk: 403 storms).
 *
 * It enumerates every route of the real controller registry, works out which
 * ones a plain club MEMBER can reach (by the permissions the real seed grants to
 * the `member` and `user` roles, by @SkipPermissions on non-admin routes, or by
 * the owner bypass), and demands that EACH of them is classified:
 *   - tagged with a scope a supervised teen holds (TEEN_SCOPES), or
 *   - listed in TEEN_DENIED with a reason, or
 *   - never-scope by design (credentials, sessions, MFA, ...).
 * A new member-reachable route cannot ship untagged without this spec failing
 * and listing it, so the teen app never silently breaks (or silently widens).
 */

const SEED = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/seeds/role-permissions.seed.sql'),
  'utf8',
);

/** role_name (lowercase) => permission names granted by the seed. */
export function parseRolePermissions(sql: string): Map<string, Set<string>> {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const grants = new Map<string, Set<string>>();
  for (const statement of withoutComments.split(';')) {
    if (!/INSERT INTO role_permissions/i.test(statement)) continue;
    // Skip "copy the permissions of another role" statements (director-lf, ...).
    if (/\bsrc\.role_name\b/.test(statement)) continue;

    const whereIndex = statement.search(/\bWHERE\b/i);
    if (whereIndex < 0) continue;
    const where = statement.slice(whereIndex);

    const roleNames = new Set<string>();
    for (const match of where.matchAll(/r\.role_name\s*=\s*'([^']+)'/g)) {
      roleNames.add(match[1]);
    }
    for (const match of where.matchAll(/r\.role_name\s+IN\s*\(([^)]*)\)/g)) {
      for (const name of match[1].matchAll(/'([^']+)'/g)) {
        roleNames.add(name[1]);
      }
    }

    const permissions = new Set<string>();
    for (const match of where.matchAll(/p\.permission_name\s*=\s*'([^']+)'/g)) {
      permissions.add(match[1]);
    }
    for (const match of where.matchAll(
      /p\.permission_name\s+IN\s*\(([^)]*)\)/g,
    )) {
      for (const name of match[1].matchAll(/'([^']+)'/g)) {
        permissions.add(name[1]);
      }
    }
    if (permissions.size === 0) continue;

    for (const role of roleNames) {
      const set = grants.get(role) ?? new Set<string>();
      for (const permission of permissions) set.add(permission);
      grants.set(role, set);
    }
  }
  return grants;
}

const ROLE_GRANTS = parseRolePermissions(SEED);
/** A teen holds the base `user` role and the CLUB `member` role. */
const TEEN_PERMISSIONS = new Set<string>([
  ...(ROLE_GRANTS.get('user') ?? []),
  ...(ROLE_GRANTS.get('member') ?? []),
]);

const reflector = new Reflector();

const readMeta = <T>(key: string, route: RouteInfo): T | undefined =>
  reflector.getAllAndOverride<T | undefined>(key, [
    route.handler as never,
    route.controller as never,
  ]);

export type Reach = 'rbac' | 'skip-permissions' | 'owner-resource';

/** Why a plain member can reach the route, or null when it cannot. */
export function memberReach(
  route: RouteInfo,
  permissions: ReadonlySet<string> = TEEN_PERMISSIONS,
): Reach | null {
  if (readMeta<boolean>(IS_PUBLIC_KEY, route)) return null; // anonymous routes: teens are downgraded
  if (route.key.split(' ')[1].startsWith('/admin')) return null;

  const globalRoles = readMeta<string[]>(GLOBAL_ROLES_KEY, route);
  if (globalRoles && !globalRoles.includes('user')) return null;
  const clubRoles = readMeta<string[]>(CLUB_ROLES_KEY, route);
  if (clubRoles && !clubRoles.includes('member')) return null;

  const resource = readMeta<AuthorizationResourceMetadata>(
    AUTHORIZATION_RESOURCE_KEY,
    route,
  );
  if (resource?.type === 'user' && resource.ownerParam) {
    return 'owner-resource';
  }

  const requirement = readMeta<PermissionRequirement>(PERMISSIONS_KEY, route);
  if (requirement) {
    const held = requirement.permissions.filter((p) => permissions.has(p));
    const satisfied =
      requirement.mode === 'any'
        ? held.length > 0
        : held.length === requirement.permissions.length;
    return satisfied ? 'rbac' : null;
  }

  if (readMeta<boolean>(SKIP_PERMISSIONS_KEY, route)) return 'skip-permissions';
  return null;
}

const TEEN_SCOPE_SET = new Set<string>([
  ...TEEN_SCOPES,
  ...TEEN_PENDING_SCOPES,
]);

/**
 * Member-reachable routes a teen deliberately does NOT get (path => reason).
 * Teens that also hold a STAFF club role only get the member surface (a
 * documented limitation).
 */
const TEEN_DENIED: Record<string, string> = {
  // ---- Club changes are handled by the guardian
  'POST /requests/transfers':
    'transfers are requested by the guardian, not by the minor',
  // ---- Staff dashboards and rosters
  'GET /clubs/:clubId/overview': 'staff dashboard of the club',
  'GET /clubs/:clubId/history': 'staff view of the club history',
  'GET /clubs/:clubId/sections/:sectionId/classes/progress-scope':
    'staff view of the class progress of the whole section',
  'GET /clubs/:clubId/sections/:sectionId/classes/:classId/members-progress':
    'staff view: progress of every member of a class',
  'GET /clubs/:clubId/sections/:sectionId/enrollments':
    'staff roster of the section enrollments',
  'GET /clubs/:clubId/sections/:sectionId/enrollments/current':
    'staff roster of the section enrollments',
  'GET /validation/pending': 'review queue of the validators (staff)',
  'GET /member-rankings': 'ranking board of the whole club (staff view)',
  'GET /member-rankings/:enrollmentId/breakdown':
    'score breakdown of another member (staff view)',
  'GET /coordination/me/scope': 'coordinator territory (staff only)',
  'GET /instructor-candidates': 'staff tool to pick honor instructors',
  // ---- The signed consent form is the guardian's to upload
  'POST /users/:userId/post-registration/step-3/consent-evidence':
    'guardian-only (consent:evidence): the guardian acting uploads the signed form; a teen never does',
  // ---- Guias Mayores are adults
  'GET /users/:userId/master-honors': 'master honors belong to adult leaders',
  'GET /users/:userId/master-honors/:masterHonorId':
    'master honors belong to adult leaders',
  'GET /users/:userId/master-honors/roadmap':
    'master honors belong to adult leaders',
  // ---- Camporees: members do not hold camporees:read; judges and staff only
  'GET /camporee-events/:eventId/rubrics': 'judging tool (judges and staff)',
  'GET /camporee-events/:eventId/scoring-targets':
    'judging tool (judges and staff)',
  'GET /camporee-events/:eventId/sections/:clubSectionId/score':
    'judging tool (judges and staff)',
  'POST /camporee-events/:eventId/sections/:clubSectionId/scores':
    'judging tool (judges and staff)',
  'GET /camporee-judges/me/assignments': 'judging tool (judges and staff)',
  'GET /camporees/:camporeeId/clubs': 'camporee administration (staff)',
  'GET /camporees/:camporeeId/members': 'camporee administration (staff)',
  'GET /camporees/:camporeeId/members/:memberId/payments':
    'camporee payments (staff)',
  'GET /camporees/:camporeeId/payments': 'camporee payments (staff)',
  'GET /camporees/union/:camporeeId/clubs': 'camporee administration (union)',
  'GET /camporees/union/:camporeeId/members': 'camporee administration (union)',
  'GET /camporees/union/:camporeeId/members/:memberId/payments':
    'camporee payments (union)',
  'GET /camporees/union/:camporeeId/payments': 'camporee payments (union)',
  // ---- Certificate imports and investiture workflow: coordinators and authorizers
  'DELETE /certificate-bulk-imports/:batchId':
    'certificate import tool (staff)',
  'DELETE /certificate-bulk-imports/:batchId/files/:fileId':
    'certificate import tool (staff)',
  'DELETE /certificate-bulk-imports/:batchId/items/:itemId':
    'certificate import tool (staff)',
  'GET /certificate-bulk-imports': 'certificate import tool (staff)',
  'GET /certificate-bulk-imports/:batchId': 'certificate import tool (staff)',
  'GET /certificate-bulk-imports/:batchId/files/:fileId/download':
    'certificate import tool (staff)',
  'GET /certificate-bulk-imports/catalog/classes':
    'certificate import tool (staff)',
  'PATCH /certificate-bulk-imports/:batchId/items/:itemId':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports': 'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/files/:fileId/confirm':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/files/presign':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/items':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/items/:itemId/resubmit':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/process-ocr':
    'certificate import tool (staff)',
  'POST /certificate-bulk-imports/:batchId/submit':
    'certificate import tool (staff)',
  'GET /certificate-import-institutional-requests':
    'certificate import tool (staff)',
  'GET /certificate-import-institutional-requests/:requestId':
    'certificate import tool (staff)',
  'POST /certificate-import-institutional-requests':
    'certificate import tool (staff)',
  'DELETE /investiture-requests/:requestId/people/:personId':
    'investiture authorization workflow (authorizers)',
  'GET /investiture-history':
    'investiture authorization workflow (authorizers)',
  'GET /investiture-requests':
    'investiture authorization workflow (authorizers)',
  'GET /investiture-requests/:requestId':
    'investiture authorization workflow (authorizers)',
  'PATCH /investiture-requests/:requestId/dates':
    'investiture authorization workflow (authorizers)',
  'POST /investiture-requests/:requestId/people':
    'investiture authorization workflow (authorizers)',
  'POST /investiture-requests/:requestId/resolutions':
    'investiture authorization workflow (authorizers)',
  'GET /investiture/pending': 'retired legacy investiture pipeline',
  'POST /enrollments/:enrollmentId/investiture':
    'retired legacy investiture pipeline',
  'POST /enrollments/:enrollmentId/submit-for-validation':
    'retired legacy investiture pipeline',
  'POST /enrollments/:enrollmentId/validate':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/club-approve':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/coordinator-approve':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/field-approve':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/invest':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/reject':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/:enrollmentId/submit':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/bulk-approve':
    'retired legacy investiture pipeline',
  'POST /investiture/enrollments/bulk-reject':
    'retired legacy investiture pipeline',
  // ---- Free-text channel to staff
  'POST /support/reports':
    'support reports are free text to staff; not part of the supervised teen shell (revisit in QA)',
};

/**
 * Member-reachable routes a teen never reaches by design (credentials,
 * sessions, MFA, deletion, export, legacy tokens, ...). Same families as
 * NEVER_SCOPE of the metadata snapshot, plus its AGE_UNKNOWN_ONLY block:
 * account deletion and sessions carry `account:manage`, a scope held only by
 * the unknown-age principal (never by a teen, see the assertion below).
 */
const NEVER_SCOPE_FAMILIES: RegExp[] = [
  /^DELETE \/auth\/me$/,
  /^[A-Z]+ \/auth\/(sessions|mfa|oauth)(\/|$)/,
  /^[A-Z]+ \/users\/me\/data-export/,
  /^[A-Z]+ \/fcm-tokens(\/|$)/,
  /^[A-Z]+ \/notifications\/preferences/,
  /^[A-Z]+ \/guardianships(\/|$)/,
  /^[A-Z]+ \/users\/:userId\/legal-representative/,
  /^POST \/users\/:userId\/post-registration\/step-3\/guardian-only$/,
  /^GET \/users\/:userId\/requires-legal-representative$/,
  /^[A-Z]+ \/certifications(\/|$)/,
  /^[A-Z]+ \/club-sections(\/|$)/,
  /^POST \/qr\/(validate|scan)$/,
  /^POST \/notifications\/(send|broadcast|club)/,
  /^GET \/legal\/current$/,
];

export type Classification =
  'tagged-for-teen' | 'denied' | 'never-scope' | 'unclassified';

export function classify(
  route: RouteInfo,
  denied: Record<string, string> = TEEN_DENIED,
): Classification {
  if (route.scope !== undefined && TEEN_SCOPE_SET.has(route.scope)) {
    return 'tagged-for-teen';
  }
  if (denied[route.key] !== undefined) return 'denied';
  if (NEVER_SCOPE_FAMILIES.some((pattern) => pattern.test(route.key))) {
    return 'never-scope';
  }
  return 'unclassified';
}

export function listUnclassified(
  routes: RouteInfo[],
  denied: Record<string, string> = TEEN_DENIED,
): string[] {
  return routes
    .filter((route) => memberReach(route) !== null)
    .filter((route) => classify(route, denied) === 'unclassified')
    .map((route) => route.key)
    .sort();
}

/**
 * Routes the Flutter teen flows use (kept in sync with the app). Each MUST be
 * allowed for a verified teen (and the ones marked pending, for a pending one).
 */
const TEEN_APP_FLOW: Array<{ key: string; pending: boolean }> = [
  { key: 'GET /auth/me', pending: true },
  { key: 'GET /auth/profile/completion-status', pending: true },
  { key: 'PATCH /auth/me/context', pending: true },
  { key: 'POST /auth/update-password', pending: true },
  { key: 'GET /users/:userId', pending: true },
  { key: 'PATCH /users/:userId', pending: true },
  { key: 'GET /users/:userId/post-registration/status', pending: true },
  {
    key: 'POST /users/:userId/post-registration/step-1/complete',
    pending: true,
  },
  {
    key: 'POST /users/:userId/post-registration/step-2/complete',
    pending: true,
  },
  {
    key: 'POST /users/:userId/post-registration/step-3/complete',
    pending: true,
  },
  { key: 'GET /clubs', pending: true },
  { key: 'GET /clubs/:clubId/sections', pending: true },
  { key: 'POST /users/me/legal-acceptance', pending: true },
  { key: 'GET /users/me/legal-acceptance', pending: true },
  { key: 'POST /users/me/fcm-tokens', pending: true },
  { key: 'DELETE /users/me/fcm-tokens/:tokenId', pending: true },
  { key: 'GET /users/me/notification-preferences', pending: true },
  { key: 'PATCH /users/me/notification-preferences', pending: true },
  { key: 'GET /notifications/history', pending: true },
  { key: 'GET /notifications/unread-count', pending: true },
  { key: 'GET /users/:userId/allergies', pending: true },
  { key: 'PUT /users/:userId/allergies', pending: true },
  { key: 'GET /users/:userId/emergency-contacts', pending: true },
  { key: 'GET /users/:userId/classes', pending: true },
  { key: 'POST /users/:userId/classes/enroll', pending: false },
  { key: 'GET /users/:userId/classes/:classId/progress', pending: true },
  { key: 'PATCH /users/:userId/classes/:classId/progress', pending: false },
  {
    key: 'POST /users/:userId/classes/:classId/sections/:sectionId/files',
    pending: false,
  },
  {
    key: 'POST /users/:userId/classes/:classId/sections/:sectionId/submit',
    pending: false,
  },
  { key: 'GET /users/:userId/honors', pending: true },
  { key: 'POST /users/:userId/honors', pending: false },
  { key: 'GET /dashboard/summary', pending: true },
  { key: 'GET /qr/me', pending: true },
  { key: 'GET /clubs/:clubId', pending: false },
  { key: 'GET /clubs/:clubId/activities', pending: false },
  { key: 'GET /activities/:activityId', pending: false },
  { key: 'PUT /activities/:activityId/rsvp', pending: false },
  { key: 'GET /clubs/:clubId/units', pending: false },
  { key: 'GET /member-rankings/me', pending: false },
  { key: 'GET /achievements/me', pending: false },
  { key: 'GET /resources', pending: false },
  { key: 'GET /requests/transfers', pending: false },
];

const principalOf = (
  scopes: readonly ActingForScope[],
): { kind: 'supervised_user'; scopes: readonly ActingForScope[] } => ({
  kind: 'supervised_user',
  scopes,
});

const allowedFor = (
  route: RouteInfo,
  scopes: readonly ActingForScope[],
): boolean => {
  try {
    assertActingScope(
      reflector,
      {
        getHandler: () => route.handler,
        getClass: () => route.controller,
      } as never,
      principalOf(scopes),
    );
    return true;
  } catch {
    return false;
  }
};

describe('teen route walk', () => {
  let routes: RouteInfo[];

  beforeAll(() => {
    routes = collectRoutes();
  });

  describe('seed parsing', () => {
    it('reads the real member and user grants from the seed', () => {
      const member = ROLE_GRANTS.get('member') ?? new Set<string>();
      const user = ROLE_GRANTS.get('user') ?? new Set<string>();
      expect(member.size).toBeGreaterThan(15);
      expect(user.size).toBeGreaterThan(5);
      // Spot-check values that exist in the seed today.
      expect(member.has('classes:read')).toBe(true);
      expect(user.has('catalogs:read')).toBe(true);
      // A staff permission must not leak into the member set.
      expect(member.has('club_members:approve')).toBe(false);
    });

    it('includes the resources block (resources:read for member and user)', () => {
      expect(TEEN_PERMISSIONS.has('resources:read')).toBe(true);
      expect(TEEN_PERMISSIONS.has('resource_categories:read')).toBe(true);
    });

    it('does not copy permissions of other roles into member (director-lf copies assistant-lf)', () => {
      expect(
        (ROLE_GRANTS.get('director-lf') ?? new Set<string>()).has(
          'attendance:approve_late',
        ),
      ).toBe(true);
      expect(TEEN_PERMISSIONS.has('attendance:approve_late')).toBe(false);
    });
  });

  it('every member-reachable route is classified (tagged for teens, denied with a reason, or never-scope)', () => {
    const unclassified = listUnclassified(routes);
    // On failure this prints the full list so the author can tag or deny each.
    expect(unclassified).toEqual([]);
  });

  it('a reachable route tagged for teens really is allowed to a teen holding that scope', () => {
    const tagged = routes.filter(
      (r) => memberReach(r) !== null && classify(r) === 'tagged-for-teen',
    );
    expect(tagged.length).toBeGreaterThan(80);
    for (const route of tagged) {
      const scope = route.scope as ActingForScope;
      const allowedForSomeTeen =
        allowedFor(route, TEEN_SCOPES) ||
        allowedFor(route, TEEN_PENDING_SCOPES);
      expect({ route: route.key, scope, allowedForSomeTeen }).toEqual({
        route: route.key,
        scope,
        allowedForSomeTeen: true,
      });
    }
  });

  it('TEEN_DENIED entries exist, carry a reason and are NOT tagged with a teen scope', () => {
    const keys = new Set(routes.map((r) => r.key));
    for (const [key, reason] of Object.entries(TEEN_DENIED)) {
      expect({ key, exists: keys.has(key) }).toEqual({ key, exists: true });
      expect(reason.trim().length).toBeGreaterThan(8);
      const route = routes.find((r) => r.key === key)!;
      expect({ key, scope: route.scope }).toEqual({
        key,
        scope:
          route.scope !== undefined && TEEN_SCOPE_SET.has(route.scope)
            ? 'MUST-NOT-BE-TEEN-SCOPE'
            : route.scope,
      });
    }
  });

  it('denied routes really answer 403 to an active teen', () => {
    for (const key of Object.keys(TEEN_DENIED)) {
      const route = routes.find((r) => r.key === key)!;
      expect({ key, allowed: allowedFor(route, TEEN_SCOPES) }).toEqual({
        key,
        allowed: false,
      });
    }
  });

  it('the account routes (account:manage) stay out of every teen scope set', () => {
    const accountRoutes = routes.filter((r) => r.scope === 'account:manage');
    expect(accountRoutes.map((r) => r.key).sort()).toEqual([
      'DELETE /auth/me',
      'DELETE /auth/sessions',
      'DELETE /auth/sessions/:sessionId',
      'GET /auth/sessions',
    ]);
    for (const route of accountRoutes) {
      expect(classify(route)).toBe('never-scope');
      expect(allowedFor(route, TEEN_SCOPES)).toBe(false);
      expect(allowedFor(route, TEEN_PENDING_SCOPES)).toBe(false);
    }
  });

  describe('the app teen flows', () => {
    it.each(TEEN_APP_FLOW)(
      '$key is allowed for a verified teen (pending: $pending)',
      ({ key, pending }) => {
        const route = routes.find((r) => r.key === key);
        expect({ key, exists: route !== undefined }).toEqual({
          key,
          exists: true,
        });
        expect(allowedFor(route!, TEEN_SCOPES)).toBe(true);
        expect(allowedFor(route!, TEEN_PENDING_SCOPES)).toBe(pending);
      },
    );
  });

  describe('self-check (the walk really detects a new untagged route)', () => {
    @Controller('walk-probe')
    class ProbeController {
      @Get('member-visible')
      @RequirePermissions('classes:read')
      memberVisible() {
        return 'ok';
      }

      @Get('staff-only')
      @RequirePermissions('club_members:approve')
      staffOnly() {
        return 'ok';
      }

      @Get('skip')
      @SkipPermissions()
      skip() {
        return 'ok';
      }
    }

    const probeRoutes = (): RouteInfo[] =>
      ['memberVisible', 'staffOnly', 'skip'].map((name) => {
        const handler = (
          ProbeController.prototype as unknown as Record<string, AnyFn>
        )[name];
        return {
          key: `GET /walk-probe/${name}`,
          method: 'GET',
          fullPath: `/walk-probe/${name}`,
          controller: ProbeController as unknown as AnyFn,
          handler,
          scope: Reflect.getMetadata(ACTING_SCOPE_KEY, handler),
          handlerScope: undefined,
          classScope: undefined,
        };
      });

    it('flags an injected controller route that a member can reach and nobody classified', () => {
      const unclassified = listUnclassified(probeRoutes());
      expect(unclassified).toEqual([
        'GET /walk-probe/memberVisible',
        'GET /walk-probe/skip',
      ]);
    });

    it('stops flagging a route once it is denied with a reason', () => {
      const unclassified = listUnclassified(probeRoutes(), {
        'GET /walk-probe/memberVisible': 'staff view, not for teens',
        'GET /walk-probe/skip': 'internal probe',
      });
      expect(unclassified).toEqual([]);
    });

    it('does not flag a route a member cannot reach (staff-only permission)', () => {
      expect(
        memberReach(probeRoutes().find((r) => r.key.endsWith('staffOnly'))!),
      ).toBeNull();
    });

    it('stops flagging a route once it carries a teen scope', () => {
      @Controller('walk-probe-tagged')
      class TaggedController {
        @Get('x')
        @RequirePermissions('classes:read')
        @UseGuards()
        x() {
          return 'ok';
        }
      }
      Reflect.defineMetadata(
        ACTING_SCOPE_KEY,
        'member:read',
        TaggedController.prototype.x,
      );
      const route: RouteInfo = {
        key: 'GET /walk-probe-tagged/x',
        method: 'GET',
        fullPath: '/walk-probe-tagged/x',
        controller: TaggedController as unknown as AnyFn,
        handler: TaggedController.prototype.x as unknown as AnyFn,
        scope: 'member:read',
        handlerScope: 'member:read',
        classScope: undefined,
      };
      expect(listUnclassified([route])).toEqual([]);
    });
  });
});
