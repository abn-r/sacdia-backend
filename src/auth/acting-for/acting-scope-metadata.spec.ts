import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertActingScope } from './acting-scope.policy';
import {
  ACTING_FOR_SCOPES,
  AGE_UNKNOWN_SCOPES,
  DEVICE_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
  type ActingForScope,
  type PrincipalKind,
} from './auth-principal';
import { collectRoutes, type RouteInfo } from './route-registry.testing';

/**
 * Snapshot of every route that declares `@ActingScope(...)`.
 *
 * A route that gains or loses a scope fails this spec, so widening what a
 * guardian, a supervised teen or a device can do is always a reviewed,
 * explicit change. Anything not listed here is denied to every non-`user`
 * kind (deny by default).
 *
 * Per-kind reachability (guardian pending/verified, teen pending/active) is
 * asserted against the REAL controller registry, so a set can never silently
 * grow a route. The device column is added in sub-phase 3b.
 */

/** METHOD path => scope. Edit deliberately: every line is a security decision. */
const EXPECTED_SCOPED_ROUTES: Record<string, ActingForScope> = {
  // ---- self:read
  'GET /auth/me': 'self:read',
  'GET /auth/profile/completion-status': 'self:read',
  'GET /dashboard/summary': 'self:read',
  'GET /users/:userId': 'self:read',
  'GET /users/:userId/age': 'self:read',
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
  // The teen's own supervision (status, guardians, clock). Adults get status null.
  'GET /users/me/supervision': 'self:read',
  // ---- health:read (retagged from self:read in Phase 3: a child's phone must
  // not read health or emergency-contact data; guardians and teens hold both)
  'GET /users/:userId/allergies': 'health:read',
  'GET /users/:userId/diseases': 'health:read',
  'GET /users/:userId/medicines': 'health:read',
  'GET /users/:userId/emergency-contacts': 'health:read',
  'GET /users/:userId/emergency-contacts/:contactId': 'health:read',
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
  // The signed consent form of the child, uploaded by the guardian ACTING for it.
  // Guardians only: teens and devices hold no `consent:evidence`.
  'POST /users/:userId/post-registration/step-3/consent-evidence':
    'consent:evidence',
  // Post-registration step 3 club picker (read-only reference data). Scoped as
  // registration:write, not self:read, so a linked device (self:read +
  // evidence:upload) cannot browse clubs: only someone finishing the
  // registration can. The other /clubs reads are teen-only (member:read).
  'GET /clubs': 'registration:write',
  'GET /clubs/:clubId/sections': 'registration:write',
  // ---- classes:write
  'POST /users/:userId/classes/enroll': 'classes:write',
  'PATCH /users/:userId/classes/:classId/progress': 'classes:write',
  // ---- evidence:submit (retagged from classes:write: the device can submit a
  // section without being able to enroll or patch progress)
  'POST /users/:userId/classes/:classId/sections/:sectionId/submit':
    'evidence:submit',
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

  // ======== Phase 3: scopes held by teens (and, where noted, the device) ========
  // ---- agenda:read (teen + linked device; the device payload drops attendees in 3b)
  'GET /clubs/:clubId/activities': 'agenda:read',
  'GET /activities/:activityId': 'agenda:read',
  'GET /activity-series/:seriesId': 'agenda:read',
  // ---- member:read (teen only)
  'GET /clubs/:clubId': 'member:read',
  'GET /clubs/:clubId/sections/:sectionId': 'member:read',
  'GET /clubs/:clubId/leadership': 'member:read',
  'GET /activities/:activityId/rsvp': 'member:read',
  'GET /activities/:activityId/attendance': 'member:read',
  'GET /clubs/:clubId/units': 'member:read',
  'GET /clubs/:clubId/units/:unitId': 'member:read',
  'GET /clubs/:clubId/units/:unitId/weekly-records': 'member:read',
  'GET /clubs/:clubId/sections/:sectionId/member-of-month': 'member:read',
  'GET /clubs/:clubId/sections/:sectionId/member-of-month/history':
    'member:read',
  'GET /member-rankings/me': 'member:read',
  'GET /achievements/me': 'member:read',
  'GET /achievements/categories': 'member:read',
  'GET /achievements': 'member:read',
  'GET /achievements/:achievementId': 'member:read',
  'GET /resources/me': 'member:read',
  'GET /resources/me/:id': 'member:read',
  'GET /resources/me/:id/signed-url': 'member:read',
  'GET /resources': 'member:read',
  'GET /resources/:id': 'member:read',
  'GET /resources/:id/signed-url': 'member:read',
  'GET /resource-categories': 'member:read',
  'GET /resource-categories/:id': 'member:read',
  'GET /validation/:entityType/:entityId/history': 'member:read',
  'GET /validation/eligibility/:userId': 'member:read',
  'GET /requests/transfers': 'member:read',
  'GET /requests/transfers/:requestId': 'member:read',
  'GET /requests/assignments': 'member:read',
  'GET /requests/assignments/:requestId': 'member:read',
  'GET /investiture/enrollments/:enrollmentId/history': 'member:read',
  'GET /enrollments/:enrollmentId/investiture-history': 'member:read',
  'GET /divisions/scoring-categories': 'member:read',
  'GET /unions/:unionId/scoring-categories': 'member:read',
  'GET /local-fields/:fieldId/scoring-categories': 'member:read',
  // ---- member:write (teen only)
  'PUT /activities/:activityId/rsvp': 'member:write',
  'POST /validation/submit': 'member:write',
  'POST /users/:userId/honors/:honorId/instructor-proposal': 'member:write',
  'DELETE /users/:userId/honors/:honorId/instructor-proposal': 'member:write',
  // ---- self:password (teen only; credentials are never reachable while acting)
  'POST /auth/update-password': 'self:password',
  'POST /auth/verify-email/send': 'self:password',
  // ---- self:preferences (teen only)
  'GET /users/me/notification-preferences': 'self:preferences',
  'PATCH /users/me/notification-preferences': 'self:preferences',
  // ---- guardian_link:issue (a pending teen links a guardian; never a guardian/device)
  'POST /users/me/guardian-link-codes': 'guardian_link:issue',
  'POST /users/me/guardian-links/:guardianshipId/revoke': 'guardian_link:issue',
  // ---- push:register (teen + linked device; own token only)
  'POST /users/me/fcm-tokens': 'push:register',
  'DELETE /users/me/fcm-tokens/:tokenId': 'push:register',

  // ======== Unknown age (NULL birthday, post-registration open) ========
  // ---- account:manage (age_unknown_user ONLY: an adult who signs up with
  // Google/Apple must be able to see and close sessions and delete the
  // account before step 2; teens, guardians acting and devices never hold it)
  'GET /auth/sessions': 'account:manage',
  'DELETE /auth/sessions': 'account:manage',
  'DELETE /auth/sessions/:sessionId': 'account:manage',
  'DELETE /auth/me': 'account:manage',
};

/**
 * Who may hold each scope. This is the `teen` column of the snapshot:
 *  - 'pending':      a teen without a verified guardian AND one with a verified guardian
 *  - 'pending_only': only a teen still without a verified guardian (issuing a link code)
 *  - 'active':       only a teen with a verified guardian
 *  - 'none':    never a teen
 * It is asserted against TEEN_PENDING_SCOPES / TEEN_SCOPES and against every
 * route of the real registry.
 */
const TEEN_ACCESS: Record<
  ActingForScope,
  'pending' | 'pending_only' | 'active' | 'none'
> = {
  'self:read': 'pending',
  'health:read': 'pending',
  'profile:write': 'pending',
  'registration:write': 'pending',
  'legal:accept': 'pending',
  'guardian_link:issue': 'pending_only',
  'self:password': 'pending',
  'self:preferences': 'pending',
  'push:register': 'pending',
  'classes:write': 'active',
  'evidence:submit': 'active',
  'honors:write': 'active',
  'evidence:upload': 'active',
  'member:read': 'active',
  'member:write': 'active',
  'agenda:read': 'active',
  'consent:evidence': 'none',
  'account:manage': 'none',
};

/** Scopes only a supervised teen holds: never a guardian, never a device. */
const TEEN_ONLY_SCOPES: ActingForScope[] = [
  'member:read',
  'member:write',
  'self:password',
  'self:preferences',
  'guardian_link:issue',
];

/**
 * Routes (or families) that MUST NEVER carry a scope, so no non-`user` kind
 * (guardian acting, supervised teen, linked device) can ever reach them:
 * credentials recovery, sessions, MFA, OAuth linking, account deletion, data
 * export, legacy push-token endpoints, guardianship management and everything
 * staff/admin facing. Each pattern must match at least one discovered route (a
 * renamed route must not silently drop out of the list).
 *
 * Removed from this list in Phase 3 because they are now tagged TEEN-ONLY
 * (see TEEN_ONLY_SCOPES and the NOT_FOR_GUARDIAN_OR_DEVICE block): update-password,
 * users/me notification preferences, the honor instructor proposal and the
 * member-app club reads.
 *
 * Removed for the unknown-age principal: account deletion and sessions now
 * carry `account:manage`, held by `age_unknown_user` ONLY (see
 * AGE_UNKNOWN_ONLY). They stay denied to every guardian, teen and device.
 */
const NEVER_SCOPE: Array<{
  label: string;
  pattern: RegExp;
}> = [
  { label: 'mfa', pattern: /^[A-Z]+ \/auth\/mfa(\/|$)/ },
  { label: 'oauth', pattern: /^[A-Z]+ \/auth\/oauth(\/|$)/ },
  { label: 'data export', pattern: /^[A-Z]+ \/users\/me\/data-export/ },
  { label: 'fcm tokens', pattern: /^[A-Z]+ \/fcm-tokens(\/|$)/ },
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
    label: 'master honors',
    pattern: /^[A-Z]+ \/users\/:userId\/master-honors/,
  },
  { label: 'certifications', pattern: /^[A-Z]+ \/certifications(\/|$)/ },
  { label: 'admin', pattern: /^[A-Z]+ \/admin(\/|$)/ },
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
  {
    // Staff-only club mutations stay unreachable for every kind. The teen-only
    // member-app reads (member:read / agenda:read) and the two step-3 pickers
    // are tagged and therefore excluded here.
    label: 'club write routes',
    pattern: /^(POST|PUT|PATCH|DELETE) \/clubs(\/|$)/,
  },
  {
    label: 'club staff reads (overview, history, finances, reports, rosters)',
    pattern:
      /^GET \/clubs\/:clubId\/(overview|history|finances|annual-reports|quarterly-reports|investiture-authorizers|sections\/:sectionId\/(members|enrollments|classes|class-counselor-assignments|director-designation))/,
  },
];

/**
 * Routes reachable by the unknown-age principal ONLY (own account management).
 * Each pattern must match a route; each matched route carries exactly
 * `account:manage` and is denied to guardians, teens and devices.
 */
const AGE_UNKNOWN_ONLY: Array<{ label: string; pattern: RegExp }> = [
  { label: 'account deletion', pattern: /^DELETE \/auth\/me$/ },
  { label: 'sessions', pattern: /^[A-Z]+ \/auth\/sessions(\/|$)/ },
];

/** Routes that must carry no scope for ANY non-`user` kind (the teen included). */
const PRINCIPALS: Array<{
  label: string;
  kind: PrincipalKind;
  scopes: readonly ActingForScope[];
  expectedCode: ErrorCode;
}> = [
  {
    label: 'guardian verified',
    kind: 'guardian_acting',
    scopes: GUARDIAN_VERIFIED_SCOPES,
    expectedCode: ErrorCode.ACTING_FOR_SCOPE_DENIED,
  },
  {
    label: 'teen pending',
    kind: 'supervised_user',
    scopes: TEEN_PENDING_SCOPES,
    expectedCode: ErrorCode.PRINCIPAL_SCOPE_DENIED,
  },
  {
    label: 'teen active',
    kind: 'supervised_user',
    scopes: TEEN_SCOPES,
    expectedCode: ErrorCode.PRINCIPAL_SCOPE_DENIED,
  },
  {
    label: 'linked device',
    kind: 'linked_device',
    scopes: DEVICE_SCOPES,
    expectedCode: ErrorCode.PRINCIPAL_SCOPE_DENIED,
  },
  {
    label: 'unknown age',
    kind: 'age_unknown_user',
    scopes: AGE_UNKNOWN_SCOPES,
    expectedCode: ErrorCode.PRINCIPAL_SCOPE_DENIED,
  },
];

const contextOf = (route: RouteInfo) =>
  ({
    getHandler: () => route.handler,
    getClass: () => route.controller,
  }) as never;

const isAllowed = (
  route: RouteInfo,
  principal: { kind: PrincipalKind; scopes: readonly ActingForScope[] },
): boolean => {
  try {
    assertActingScope(new Reflector(), contextOf(route), principal);
    return true;
  } catch {
    return false;
  }
};

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
      '$label carries no scope and is denied for every restricted kind (guardian, teen pending/active, device, unknown age)',
      ({ pattern }) => {
        for (const route of routes.filter((r) => pattern.test(r.key))) {
          expect({ route: route.key, scope: route.scope }).toEqual({
            route: route.key,
            scope: undefined,
          });
          for (const principal of PRINCIPALS) {
            let thrown: unknown;
            try {
              assertActingScope(new Reflector(), contextOf(route), principal);
            } catch (error) {
              thrown = error;
            }
            expect(thrown).toBeInstanceOf(AppException);
            expect((thrown as AppException).code).toBe(principal.expectedCode);
          }
        }
      },
    );

    it('a handle teen can never reach email-add, oauth-link, mfa, sessions, delete or export routes', () => {
      const credentialFamily =
        /^[A-Z]+ \/(auth\/(oauth|mfa|sessions)(\/|$)|users\/me\/data-export)|^DELETE \/auth\/me$/;
      const matched = routes.filter((r) => credentialFamily.test(r.key));
      expect(matched.length).toBeGreaterThan(5);
      for (const route of matched) {
        expect(
          isAllowed(route, { kind: 'supervised_user', scopes: TEEN_SCOPES }),
        ).toBe(false);
        expect(
          isAllowed(route, {
            kind: 'supervised_user',
            scopes: TEEN_PENDING_SCOPES,
          }),
        ).toBe(false);
      }
    });
  });

  describe('scope vs grant status (guardian)', () => {
    it('a pending grant reaches exactly the routes whose scope is in the pending set', () => {
      const pending = new Set<string>(GUARDIAN_PENDING_SCOPES);
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        expect({
          route: route.key,
          allowed: isAllowed(route, {
            kind: 'guardian_acting',
            scopes: GUARDIAN_PENDING_SCOPES,
          }),
        }).toEqual({
          route: route.key,
          allowed: pending.has(route.scope as string),
        });
      }
    });

    it('a verified grant reaches exactly the routes whose scope is in the verified set', () => {
      const verified = new Set<string>(GUARDIAN_VERIFIED_SCOPES);
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        expect({
          route: route.key,
          allowed: isAllowed(route, {
            kind: 'guardian_acting',
            scopes: GUARDIAN_VERIFIED_SCOPES,
          }),
        }).toEqual({
          route: route.key,
          allowed: verified.has(route.scope as string),
        });
      }
    });

    it('every Phase 2 guardian route is still reachable by a verified guardian (no Phase 2 regression)', () => {
      // The Phase 2 snapshot minus the two retags (health:read / evidence:submit)
      // are still inside GUARDIAN_VERIFIED_SCOPES.
      const phase2Scopes = new Set<ActingForScope>([
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'classes:write',
        'evidence:submit',
        'honors:write',
        'evidence:upload',
        'legal:accept',
      ]);
      const phase2Routes = routes.filter(
        (r) => r.scope !== undefined && phase2Scopes.has(r.scope),
      );
      expect(phase2Routes.length).toBeGreaterThan(60);
      for (const route of phase2Routes) {
        expect(
          isAllowed(route, {
            kind: 'guardian_acting',
            scopes: GUARDIAN_VERIFIED_SCOPES,
          }),
        ).toBe(true);
      }
    });

    it('an unscoped route is denied even for a verified grant', () => {
      const unscoped = routes.find((r) => r.scope === undefined);
      expect(unscoped).toBeDefined();
      expect(
        isAllowed(unscoped!, {
          kind: 'guardian_acting',
          scopes: GUARDIAN_VERIFIED_SCOPES,
        }),
      ).toBe(false);
    });
  });

  describe('teen column (supervised_user reachability against the real registry)', () => {
    it('TEEN_ACCESS agrees with the two teen scope sets', () => {
      for (const scope of ACTING_FOR_SCOPES) {
        const inPending = (TEEN_PENDING_SCOPES as readonly string[]).includes(
          scope,
        );
        const inActive = (TEEN_SCOPES as readonly string[]).includes(scope);
        const expected = TEEN_ACCESS[scope];
        expect({ scope, inPending, inActive }).toEqual({
          scope,
          inPending: expected === 'pending' || expected === 'pending_only',
          inActive: expected === 'pending' || expected === 'active',
        });
      }
    });

    it('a pending teen reaches exactly the routes tagged "pending" or "pending_only"', () => {
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        expect({
          route: route.key,
          allowed: isAllowed(route, {
            kind: 'supervised_user',
            scopes: TEEN_PENDING_SCOPES,
          }),
        }).toEqual({
          route: route.key,
          allowed: ['pending', 'pending_only'].includes(
            TEEN_ACCESS[route.scope as ActingForScope],
          ),
        });
      }
    });

    it('an active teen reaches every route tagged "pending" or "active", never a pending-only or guardian-only one', () => {
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        const access = TEEN_ACCESS[route.scope as ActingForScope];
        expect({
          route: route.key,
          allowed: isAllowed(route, {
            kind: 'supervised_user',
            scopes: TEEN_SCOPES,
          }),
        }).toEqual({
          route: route.key,
          allowed: access === 'pending' || access === 'active',
        });
      }
    });

    it('a pending teen reaches NO club data, member list, unit or activity route', () => {
      const clubData =
        /^[A-Z]+ \/(clubs\/:clubId(\/(?!sections$)|$)|activities|activity-series|member-rankings|achievements|resources|requests)/;
      for (const route of routes.filter((r) => clubData.test(r.key))) {
        expect({
          route: route.key,
          allowed: isAllowed(route, {
            kind: 'supervised_user',
            scopes: TEEN_PENDING_SCOPES,
          }),
        }).toEqual({ route: route.key, allowed: false });
      }
    });

    it('a pending teen can still finish post-registration (steps 1-3 and the club pickers)', () => {
      for (const key of [
        'POST /users/:userId/post-registration/step-1/complete',
        'POST /users/:userId/post-registration/step-2/complete',
        'POST /users/:userId/post-registration/step-3/complete',
        'GET /clubs',
        'GET /clubs/:clubId/sections',
        'POST /auth/update-password',
        'POST /users/me/legal-acceptance',
        'POST /users/me/fcm-tokens',
        'GET /users/me/notification-preferences',
      ]) {
        const route = routes.find((r) => r.key === key);
        expect(route).toBeDefined();
        expect(
          isAllowed(route!, {
            kind: 'supervised_user',
            scopes: TEEN_PENDING_SCOPES,
          }),
        ).toBe(true);
      }
    });
  });

  describe('AGE_UNKNOWN_ONLY (own account management)', () => {
    it.each(AGE_UNKNOWN_ONLY)(
      '$label matches at least one route',
      ({ pattern }) => {
        expect(routes.some((r) => pattern.test(r.key))).toBe(true);
      },
    );

    it.each(AGE_UNKNOWN_ONLY)(
      '$label carries account:manage and is denied to guardians, teens and devices',
      ({ pattern }) => {
        for (const route of routes.filter((r) => pattern.test(r.key))) {
          expect({ route: route.key, scope: route.scope }).toEqual({
            route: route.key,
            scope: 'account:manage',
          });
          for (const principal of PRINCIPALS.filter(
            (p) => p.kind !== 'age_unknown_user',
          )) {
            let thrown: unknown;
            try {
              assertActingScope(new Reflector(), contextOf(route), principal);
            } catch (error) {
              thrown = error;
            }
            expect(thrown).toBeInstanceOf(AppException);
            expect((thrown as AppException).code).toBe(principal.expectedCode);
          }
          expect(
            isAllowed(route, {
              kind: 'age_unknown_user',
              scopes: AGE_UNKNOWN_SCOPES,
            }),
          ).toBe(true);
        }
      },
    );

    it('account:manage is carried by exactly the AGE_UNKNOWN_ONLY routes', () => {
      const tagged = routes
        .filter((r) => r.scope === 'account:manage')
        .map((r) => r.key)
        .sort();
      const listed = routes
        .filter((r) => AGE_UNKNOWN_ONLY.some((f) => f.pattern.test(r.key)))
        .map((r) => r.key)
        .sort();
      expect(tagged).toEqual(listed);
    });
  });

  describe('unknown-age column (age_unknown_user reachability against the real registry)', () => {
    const newcomer = {
      kind: 'age_unknown_user' as const,
      scopes: AGE_UNKNOWN_SCOPES,
    };

    it('reaches exactly the routes whose scope is in AGE_UNKNOWN_SCOPES', () => {
      const held = new Set<string>(AGE_UNKNOWN_SCOPES);
      for (const route of routes.filter((r) => r.scope !== undefined)) {
        expect({
          route: route.key,
          allowed: isAllowed(route, newcomer),
        }).toEqual({ route: route.key, allowed: held.has(route.scope!) });
      }
    });

    it('never reaches an unscoped route', () => {
      for (const route of routes.filter((r) => r.scope === undefined)) {
        expect({
          route: route.key,
          allowed: isAllowed(route, newcomer),
        }).toEqual({ route: route.key, allowed: false });
      }
    });

    it('can finish the post-registration, accept the legal terms, register push and manage the own account', () => {
      for (const key of [
        'GET /auth/me',
        'GET /auth/profile/completion-status',
        'GET /users/:userId',
        'PATCH /users/:userId',
        'POST /users/:userId/profile-picture',
        'GET /users/:userId/post-registration/status',
        'GET /users/:userId/post-registration/photo-status',
        'POST /users/:userId/post-registration/step-1/complete',
        'POST /users/:userId/post-registration/step-2/complete',
        'POST /users/:userId/post-registration/step-3/complete',
        'POST /users/:userId/post-registration/membership-request/cancel',
        'GET /clubs',
        'GET /clubs/:clubId/sections',
        'GET /users/:userId/allergies',
        'PUT /users/:userId/allergies',
        'GET /users/:userId/emergency-contacts',
        'POST /users/:userId/emergency-contacts',
        'GET /users/me/legal-acceptance',
        'POST /users/me/legal-acceptance',
        'POST /users/me/fcm-tokens',
        'DELETE /users/me/fcm-tokens/:tokenId',
        'POST /auth/update-password',
        'GET /auth/sessions',
        'DELETE /auth/sessions',
        'DELETE /auth/sessions/:sessionId',
        'DELETE /auth/me',
      ]) {
        const route = routes.find((r) => r.key === key);
        expect({ key, exists: route !== undefined }).toEqual({
          key,
          exists: true,
        });
        expect({ key, allowed: isAllowed(route!, newcomer) }).toEqual({
          key,
          allowed: true,
        });
      }
    });

    it('reaches no club data, guardian tool, link code, preference or guardian-only exit', () => {
      for (const key of [
        'GET /clubs/:clubId',
        'GET /clubs/:clubId/units',
        'GET /clubs/:clubId/activities',
        'GET /member-rankings/me',
        'GET /resources',
        'POST /users/:userId/classes/enroll',
        'POST /users/:userId/honors',
        'POST /users/me/guardian-link-codes',
        'GET /users/me/notification-preferences',
        'POST /users/:userId/post-registration/step-3/guardian-only',
        'POST /users/:userId/post-registration/step-3/consent-evidence',
        'GET /guardianships/me/dependents',
        'POST /support/reports',
      ]) {
        const route = routes.find((r) => r.key === key);
        expect({ key, exists: route !== undefined }).toEqual({
          key,
          exists: true,
        });
        expect({ key, allowed: isAllowed(route!, newcomer) }).toEqual({
          key,
          allowed: false,
        });
      }
    });
  });

  describe('NOT_FOR_GUARDIAN_OR_DEVICE (teen-only scopes)', () => {
    it('the teen-only scopes are in neither guardian set nor the device set', () => {
      for (const scope of TEEN_ONLY_SCOPES) {
        expect(GUARDIAN_PENDING_SCOPES).not.toContain(scope);
        expect(GUARDIAN_VERIFIED_SCOPES).not.toContain(scope);
        expect(DEVICE_SCOPES).not.toContain(scope);
      }
      // agenda:read and push:register are shared with the device by design,
      // but never with a guardian acting.
      for (const scope of ['agenda:read', 'push:register'] as const) {
        expect(GUARDIAN_PENDING_SCOPES).not.toContain(scope);
        expect(GUARDIAN_VERIFIED_SCOPES).not.toContain(scope);
      }
    });

    it('no route carrying a teen-only scope is reachable by a guardian acting or a device', () => {
      const teenOnlyRoutes = routes.filter(
        (r) => r.scope && TEEN_ONLY_SCOPES.includes(r.scope),
      );
      expect(teenOnlyRoutes.length).toBeGreaterThan(30);
      for (const route of teenOnlyRoutes) {
        for (const scopes of [
          GUARDIAN_PENDING_SCOPES,
          GUARDIAN_VERIFIED_SCOPES,
        ]) {
          expect(isAllowed(route, { kind: 'guardian_acting', scopes })).toBe(
            false,
          );
        }
        expect(
          isAllowed(route, { kind: 'linked_device', scopes: DEVICE_SCOPES }),
        ).toBe(false);
      }
    });

    it('the device reaches no /clubs route other than the club agenda', () => {
      const clubRoutes = routes.filter(
        (r) =>
          /^[A-Z]+ \/clubs(\/|$)/.test(r.key) &&
          isAllowed(r, { kind: 'linked_device', scopes: DEVICE_SCOPES }),
      );
      expect(clubRoutes.map((r) => r.key)).toEqual([
        'GET /clubs/:clubId/activities',
      ]);
    });

    it('the device cannot read health data, change the password, accept legal terms or touch profiles', () => {
      for (const key of [
        'GET /users/:userId/allergies',
        'GET /users/:userId/emergency-contacts',
        'POST /auth/update-password',
        'POST /users/me/legal-acceptance',
        'PATCH /users/:userId',
        'POST /users/:userId/classes/enroll',
        'POST /users/:userId/honors',
      ]) {
        const route = routes.find((r) => r.key === key);
        expect(route).toBeDefined();
        expect(
          isAllowed(route!, { kind: 'linked_device', scopes: DEVICE_SCOPES }),
        ).toBe(false);
      }
    });
  });
});
