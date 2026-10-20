import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../common/errors/error-codes';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { InstitutionalHierarchyService } from '../common/services/institutional-hierarchy.service';
import { MembershipRequestsController } from '../membership-requests/membership-requests.controller';
import { PrismaService } from '../prisma/prisma.service';

/**
 * T3c-B11 + coordinator-consent-verify. Design section 13 assumed that a GLOBAL
 * coordinator holding `consent:verify` resolves `club_assignment` resources
 * INSIDE their territory and is denied outside it, so coordinators can be the
 * independent verifier of a director-created minor.
 *
 * Originally that failed: `validateInstanceScope` only accepted
 * `canManageClub` (role-first union / local-field / division territory, which
 * coordinators do not have) or the caller's active club section.
 *
 * Now: a route opts in with `@AuthorizationResource({ ..., coordinatorSections:
 * true })` and, there only, a coordinator passes when a coordinator ROLE carries
 * the required permission AND the canonical coordinator scope
 * (coordinator_assignments GENERAL / ZONE / SECTION -> club_section_ids) covers
 * the resource's section. `canManageClub` and `resolveActorTerritoryScope` are
 * NOT broadened: they gate club management, finances, director designation...
 * and a coordinator's authority is per SECTION (a ZONE assignment covers one
 * club type), never per club.
 */

const SECTION_ID = 22;
const MAIN_CLUB_ID = 10;
const OTHER_MAIN_CLUB_ID = 11;
const ASSIGNMENT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '99999999-9999-4999-8999-999999999999';

const HOME_TERRITORY = { local_field: 50, union: 70, division: 1 } as const;
const OTHER_TERRITORY = { local_field: 51, union: 71, division: 2 } as const;

type Territory = { local_field: number; union: number; division: number };

const globalScope = (territory: Territory) => ({
  division: { id: territory.division },
  union: { id: territory.union },
  local_field: { id: territory.local_field },
});

/** A resolved profile with ONE global role and no club assignment. */
function globalRoleProfile(
  roleName: string,
  permissions: string[],
  territory: Territory,
) {
  return {
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: roleName,
            permissions,
            scope: globalScope(territory),
          },
        ],
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions,
        scope: { global: globalScope(territory), club: null },
      },
    },
  };
}

/** A resolved profile with an ACTIVE club assignment (a CLUB role). */
function clubRoleProfile(
  roleName: string,
  permissions: string[],
  clubId: number,
  sectionId: number,
) {
  const club = { club_id: clubId, club_name: 'Club Amanecer' };
  const section = { club_section_id: sectionId, club_type_id: 2 };
  return {
    authorization: {
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: 'assignment-1',
            role_name: roleName,
            permissions,
            operational: true,
            club,
            section,
            scope: {},
            status: 'active',
          },
        ],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: 'assignment-1' },
      effective: {
        permissions,
        scope: {
          global: {},
          club: {
            assignment_id: 'assignment-1',
            role_name: roleName,
            club,
            section,
          },
        },
      },
    },
  };
}

type CoordinatorAssignment = {
  local_field_id: number;
  assignment_type: 'GENERAL' | 'ZONE' | 'SECTION';
  zone_id: number | null;
  club_type_id: number | null;
  club_section_id: number | null;
};

const sectionAssignment = (clubSectionId: number): CoordinatorAssignment => ({
  local_field_id: HOME_TERRITORY.local_field,
  assignment_type: 'SECTION',
  zone_id: null,
  club_type_id: null,
  club_section_id: clubSectionId,
});

const generalAssignment = (): CoordinatorAssignment => ({
  local_field_id: HOME_TERRITORY.local_field,
  assignment_type: 'GENERAL',
  zone_id: null,
  club_type_id: null,
  club_section_id: null,
});

type CoordinatorData = {
  assignments?: CoordinatorAssignment[];
  /** What a GENERAL / ZONE assignment expands to (club_sections.findMany). */
  expandedSectionIds?: number[];
};

function setup(
  profile: unknown,
  clubTerritory: Territory = HOME_TERRITORY,
  coordinator: CoordinatorData = {},
) {
  const hierarchy = {
    resolveCurrent: jest.fn().mockResolvedValue({
      division_id: clubTerritory.division,
      union_id: clubTerritory.union,
      local_field_id: clubTerritory.local_field,
      club_id: MAIN_CLUB_ID,
      as_of: new Date(),
      source: 'current',
      precision: 'club',
    }),
  };
  const prisma = {
    club_role_assignments: {
      findUnique: jest.fn().mockResolvedValue({
        club_section_id: SECTION_ID,
        club_sections: {
          club_section_id: SECTION_ID,
          main_club_id: MAIN_CLUB_ID,
          club_type_id: 2,
        },
      }),
    },
    coordinator_assignments: {
      findMany: jest.fn().mockResolvedValue(coordinator.assignments ?? []),
    },
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        club_section_id: SECTION_ID,
        main_club_id: MAIN_CLUB_ID,
        club_type_id: 2,
      }),
      findMany: jest.fn().mockResolvedValue(
        (coordinator.expandedSectionIds ?? []).map((club_section_id) => ({
          club_section_id,
        })),
      ),
      count: jest.fn().mockResolvedValue(1),
    },
    coordination_zone_districts: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  // The REAL authorization context: only the profile loader is replaced. The
  // territory decision (canManageClub -> canAccessHierarchyScope) is production code.
  const authorizationContext = new AuthorizationContextService(
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest
    .spyOn(authorizationContext, 'resolveUserAuthorization')
    .mockResolvedValue(profile);
  const guard = new PermissionsGuard(
    new Reflector(),
    authorizationContext,
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
  );
  return { guard, prisma, hierarchy };
}

type Handler = keyof MembershipRequestsController;

/** The context of a REAL controller handler: its real PERMISSIONS_KEY and resource. */
function handlerContext(
  handler: Handler = 'verifyConsent',
  request: Record<string, unknown> = newRequest(),
): ExecutionContext {
  return {
    getHandler: () => MembershipRequestsController.prototype[handler],
    getClass: () => MembershipRequestsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function newRequest(): Record<string, unknown> {
  return {
    user: { sub: USER_ID },
    params: { clubSectionId: String(SECTION_ID), assignmentId: ASSIGNMENT_ID },
    query: {},
    body: {},
  };
}

const decide = async (
  guard: PermissionsGuard,
  handler: Handler = 'verifyConsent',
) => {
  try {
    return { allowed: await guard.canActivate(handlerContext(handler)) };
  } catch (error) {
    return { allowed: false, code: (error as { code?: string }).code };
  }
};

describe('PermissionsGuard on verify-consent with consent:verify (T3c-B11)', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('GLOBAL coordinators resolve their ASSIGNED sections (coordinator_assignments)', () => {
    const COORDINATOR_ROLES = [
      'coordinator',
      'zone-coordinator',
      'general-coordinator',
    ];

    it.each(COORDINATOR_ROLES)(
      '%s holding consent:verify PASSES on a section covered by a SECTION assignment',
      async (role) => {
        const { guard, prisma } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          { assignments: [sectionAssignment(SECTION_ID)] },
        );

        expect(await decide(guard)).toEqual({ allowed: true });
        expect(prisma.coordinator_assignments.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ user_id: USER_ID, active: true }),
          }),
        );
      },
    );

    it.each(COORDINATOR_ROLES)(
      '%s PASSES through a GENERAL assignment whose local field contains the section',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          {
            assignments: [generalAssignment()],
            expandedSectionIds: [21, SECTION_ID],
          },
        );

        expect(await decide(guard)).toEqual({ allowed: true });
      },
    );

    it.each(COORDINATOR_ROLES)(
      '%s is DENIED on a section outside their assignments, even in their home territory',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          {
            assignments: [sectionAssignment(99), generalAssignment()],
            expandedSectionIds: [21, 30],
          },
        );

        expect(await decide(guard)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it.each(COORDINATOR_ROLES)(
      '%s without any active assignment is DENIED (the role alone is not a territory)',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
        );

        expect(await decide(guard)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it('the coordinator ROLE must carry the permission: a direct consent:verify grant does not open the assigned sections', async () => {
      const profile = globalRoleProfile(
        'coordinator',
        ['clubs:read'],
        HOME_TERRITORY,
      );
      profile.authorization.grants.direct_permissions = [
        'consent:verify',
      ] as never;
      const { guard, prisma } = setup(profile, HOME_TERRITORY, {
        assignments: [sectionAssignment(SECTION_ID)],
      });

      expect(await decide(guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
      expect(prisma.coordinator_assignments.findMany).not.toHaveBeenCalled();
    });

    it('routes that did NOT opt in stay closed: a coordinator holding club_members:approve cannot approve inside an assigned section', async () => {
      const { guard, prisma } = setup(
        globalRoleProfile(
          'general-coordinator',
          ['club_members:approve', 'consent:verify'],
          HOME_TERRITORY,
        ),
        HOME_TERRITORY,
        { assignments: [sectionAssignment(SECTION_ID)] },
      );

      for (const handler of ['approve', 'reject'] as const) {
        expect(await decide(guard, handler)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      }
      expect(prisma.coordinator_assignments.findMany).not.toHaveBeenCalled();
    });

    it.each(COORDINATOR_ROLES)(
      '%s still does not manage the club (canManageClub is NOT broadened)',
      async (role) => {
        const { guard } = setup(
          globalRoleProfile(role, ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
        );
        const authorizationContext = (
          guard as unknown as {
            authorizationContext: AuthorizationContextService;
          }
        ).authorizationContext;

        expect(
          await authorizationContext.canManageClub(USER_ID, MAIN_CLUB_ID),
        ).toBe(false);
      },
    );
  });

  describe('roles whose territory the guard DOES resolve', () => {
    it('assistant-lf resolves the club inside their local field and is denied outside it', async () => {
      const permissions = ['club_members:approve'];
      const inside = setup(
        globalRoleProfile('assistant-lf', permissions, HOME_TERRITORY),
        HOME_TERRITORY,
      );
      const outside = setup(
        globalRoleProfile('assistant-lf', permissions, HOME_TERRITORY),
        OTHER_TERRITORY,
      );

      expect(await decide(inside.guard)).toEqual({ allowed: true });
      expect(await decide(outside.guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it('an admin with a configured territory resolves the club inside it only', async () => {
      const permissions = ['consent:verify', 'club_members:approve'];
      const inside = setup(
        globalRoleProfile('admin', permissions, HOME_TERRITORY),
        HOME_TERRITORY,
      );
      const outside = setup(
        globalRoleProfile('admin', permissions, HOME_TERRITORY),
        OTHER_TERRITORY,
      );

      expect(await decide(inside.guard)).toEqual({ allowed: true });
      expect(await decide(outside.guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
      });
    });

    it.each([
      'director',
      'deputy-director',
      'secretary',
      'secretary-treasurer',
    ])(
      'CLUB %s holding consent:verify verifies in their own section',
      async (role) => {
        const { guard } = setup(
          clubRoleProfile(role, ['consent:verify'], MAIN_CLUB_ID, SECTION_ID),
        );

        expect(await decide(guard)).toEqual({ allowed: true });
      },
    );

    it('a CLUB role is denied in another section or another club', async () => {
      const otherSection = setup(
        clubRoleProfile('secretary', ['consent:verify'], MAIN_CLUB_ID, 99),
      );
      const otherClub = setup(
        clubRoleProfile(
          'secretary',
          ['consent:verify'],
          OTHER_MAIN_CLUB_ID,
          SECTION_ID,
        ),
      );

      for (const { guard } of [otherSection, otherClub]) {
        expect(await decide(guard)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      }
    });

    it('a member without either permission is denied before any scope check', async () => {
      const { guard, prisma } = setup(
        clubRoleProfile('member', ['classes:read'], MAIN_CLUB_ID, SECTION_ID),
      );

      expect(await decide(guard)).toEqual({
        allowed: false,
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      expect(prisma.club_role_assignments.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('verify-only reviewers reach the list and the consent form, never approve', () => {
    const REVIEW_ROUTES = [
      'listPending',
      'getConsentEvidence',
      'uploadConsentEvidence',
      'verifyConsent',
    ] as const;

    const reviewers = () => [
      {
        label: 'CLUB secretary (own section)',
        ...setup(
          clubRoleProfile(
            'secretary',
            ['consent:verify'],
            MAIN_CLUB_ID,
            SECTION_ID,
          ),
        ),
      },
      {
        label: 'GLOBAL coordinator (assigned section)',
        ...setup(
          globalRoleProfile('coordinator', ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          { assignments: [sectionAssignment(SECTION_ID)] },
        ),
      },
    ];

    it.each(REVIEW_ROUTES)(
      '%s lets every verify-only reviewer in',
      async (route) => {
        for (const { label, guard } of reviewers()) {
          expect({ label, ...(await decide(guard, route)) }).toEqual({
            label,
            allowed: true,
          });
        }
      },
    );

    it.each(['approve', 'reject'] as const)(
      '%s denies every verify-only reviewer before any scope check',
      async (route) => {
        for (const { label, guard } of reviewers()) {
          expect({ label, ...(await decide(guard, route)) }).toEqual({
            label,
            allowed: false,
            code: ErrorCode.GUARD_PERMISSION_DENIED,
          });
        }
      },
    );

    it.each([
      'listPending',
      'getConsentEvidence',
      'uploadConsentEvidence',
    ] as const)(
      '%s denies a coordinator outside their assigned sections',
      async (route) => {
        const { guard } = setup(
          globalRoleProfile('coordinator', ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          { assignments: [sectionAssignment(99)] },
        );

        expect(await decide(guard, route)).toEqual({
          allowed: false,
          code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
        });
      },
    );

    it('verify-consent with approve:true is 403 MR_APPROVE_PERMISSION_REQUIRED for a coordinator the guard let in', async () => {
      const { guard } = setup(
        globalRoleProfile('coordinator', ['consent:verify'], HOME_TERRITORY),
        HOME_TERRITORY,
        { assignments: [sectionAssignment(SECTION_ID)] },
      );
      const request = newRequest();
      expect(
        await guard.canActivate(handlerContext('verifyConsent', request)),
      ).toBe(true);
      const verification = { verify: jest.fn() };
      const controller = new MembershipRequestsController(
        {} as never,
        {} as never,
        verification as never,
      );

      const error = await controller
        .verifyConsent(
          SECTION_ID,
          ASSIGNMENT_ID,
          { confirm_paper_form_reviewed: true, approve: true },
          { sub: USER_ID },
          request as never,
        )
        .then(
          () => undefined,
          (e: { code?: string }) => e,
        );

      expect(error?.code).toBe(ErrorCode.MR_APPROVE_PERMISSION_REQUIRED);
      expect(verification.verify).not.toHaveBeenCalled();
    });
  });

  describe('the guard marks requests it let in ONLY through the coordinator path (the list is filtered for them)', () => {
    const run = async (
      guard: PermissionsGuard,
      handler: Handler,
      request: Record<string, unknown>,
    ) => {
      try {
        return await guard.canActivate(handlerContext(handler, request));
      } catch {
        return false;
      }
    };

    it.each(['listPending', 'getConsentEvidence'] as const)(
      '%s: a coordinator inside their assignment gets coordinatorSectionGrant = true',
      async (handler) => {
        const { guard } = setup(
          globalRoleProfile('coordinator', ['consent:verify'], HOME_TERRITORY),
          HOME_TERRITORY,
          { assignments: [sectionAssignment(SECTION_ID)] },
        );
        const request = newRequest();

        expect(await run(guard, handler, request)).toBe(true);
        expect(request.coordinatorSectionGrant).toBe(true);
      },
    );

    it('a club role reaching its own section is NOT marked', async () => {
      const { guard } = setup(
        clubRoleProfile(
          'secretary',
          ['consent:verify'],
          MAIN_CLUB_ID,
          SECTION_ID,
        ),
      );
      const request = newRequest();

      expect(await run(guard, 'listPending', request)).toBe(true);
      expect(request.coordinatorSectionGrant).toBeUndefined();
    });

    it('a territory manager (canManageClub) is NOT marked', async () => {
      const { guard } = setup(
        globalRoleProfile(
          'admin',
          ['club_members:approve', 'consent:verify'],
          HOME_TERRITORY,
        ),
      );
      const request = newRequest();

      expect(await run(guard, 'listPending', request)).toBe(true);
      expect(request.coordinatorSectionGrant).toBeUndefined();
    });

    it('a denied coordinator is not marked', async () => {
      const { guard } = setup(
        globalRoleProfile('coordinator', ['consent:verify'], HOME_TERRITORY),
        HOME_TERRITORY,
        { assignments: [sectionAssignment(99)] },
      );
      const request = newRequest();

      expect(await run(guard, 'listPending', request)).toBe(false);
      expect(request.coordinatorSectionGrant).toBeUndefined();
    });
  });

  describe('the seed grants coordinators consent:verify', () => {
    const readSql = (migration: string): string =>
      readFileSync(
        join(__dirname, `../../prisma/migrations/${migration}/migration.sql`),
        'utf8',
      )
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    it.each(['coordinator', 'zone-coordinator', 'general-coordinator'])(
      'the B11 seed (20261022130000) still does not name %s; 20261023120000 grants it consent:verify',
      (role) => {
        expect(readSql('20261022130000_seed_family_permissions')).not.toContain(
          `'${role}'`,
        );
        const grant = readSql(
          '20261023120000_grant_consent_verify_to_coordinators',
        );
        expect(grant).toContain(`'${role}'`);
        expect(grant).toContain("p.permission_name = 'consent:verify'");
      },
    );
  });
});
