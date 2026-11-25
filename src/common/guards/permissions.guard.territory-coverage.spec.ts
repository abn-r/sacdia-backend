import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthorizationContextService } from '../services/authorization-context.service';
import type { ResolvedAuthorizationProfile } from '../services/authorization-context.service';
import type { InstitutionalHierarchyService } from '../services/institutional-hierarchy.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode } from '../errors/error-codes';
import { clubAssignmentEffectivityArgs } from '../authorization/testing/club-assignment-effectivity.testing';
import { RequestsController } from '../../requests/requests.controller';
import { CamporeesController } from '../../camporees/camporees.controller';
import { ClubsController } from '../../clubs/clubs.controller';
import { AnnualRankingsController } from '../../rankings/annual-ranking-progress/annual-rankings.controller';
import { ClubEnrollmentValidationController } from '../../club-enrollments/club-enrollment-validation.controller';

/**
 * B8 (union-division-app-surface): territory coverage of the REAL route
 * metadata. The guard, the real `Reflector` and the real
 * `AuthorizationContextService.canManageClub / canAccessHierarchyScope` run;
 * only Prisma and the hierarchy lookup are doubles. Route permissions and
 * resource types are read from the controllers, so a change to a decorator
 * breaks these tests.
 *
 * Permissions below mirror prisma/seeds/role-permissions.seed.sql: Union and
 * Division roles inherit the assistant-lf grants (requests:read/review,
 * camporees:read, clubs:read, rankings:read, club_enrollments:validate);
 * `attendance:approve_late` is granted to director-lf/assistant-lf/
 * director-union/assistant-union only (seed lines 1967-1980), never to Division.
 */

const BASE_USER_PERMISSIONS = ['validation:read', 'requests:read'];
const SUPERVISOR_PERMISSIONS = [
  'requests:read',
  'requests:review',
  'camporees:read',
  'clubs:read',
  'rankings:read',
  'club_enrollments:validate',
];
const UNION_ONLY_PERMISSIONS = ['attendance:approve_late'];

// Division 1 owns union 3 and union 4; division 2 owns union 5.
const UNION_TO_DIVISION: Record<number, number> = { 3: 1, 4: 1, 5: 2 };

type Territory = { division?: number; union?: number };

function supervisorWithoutClub(
  roleName: string,
  extraPermissions: string[],
  territory: Territory,
): ResolvedAuthorizationProfile {
  const scope = {
    ...(territory.division ? { division: { id: territory.division } } : {}),
    ...(territory.union ? { union: { id: territory.union } } : {}),
  };
  const permissions = [...SUPERVISOR_PERMISSIONS, ...extraPermissions];
  return {
    profile: { user_id: 'supervisor-1' },
    authorization: {
      grants: {
        global_roles: [
          { role_name: 'user', permissions: BASE_USER_PERMISSIONS, scope: {} },
          { role_name: roleName, permissions, scope },
        ],
        // The point of S5.1: no club assignment at all.
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: [...new Set([...BASE_USER_PERMISSIONS, ...permissions])],
        scope: { global: scope, club: null },
      },
    },
  } as unknown as ResolvedAuthorizationProfile;
}

const unionActor = (union = 3) =>
  supervisorWithoutClub('director-union', UNION_ONLY_PERMISSIONS, {
    union,
    division: UNION_TO_DIVISION[union],
  });
const assistantUnionActor = () =>
  supervisorWithoutClub('assistant-union', UNION_ONLY_PERMISSIONS, {
    union: 3,
    division: 1,
  });
const divisionActor = (division = 1) =>
  supervisorWithoutClub('director-dia', [], { division });
const assistantDivisionActor = () =>
  supervisorWithoutClub('assistant-dia', [], { division: 1 });

describe('PermissionsGuard territory coverage (union-division-app-surface B8)', () => {
  const resolveUserAuthorization = jest.fn();
  const hierarchy = { resolveCurrent: jest.fn() };
  const prisma = {
    union_camporees: { findUnique: jest.fn() },
    union_camporee_local_fields: { findFirst: jest.fn() },
    club_role_assignments: { findMany: jest.fn(), findFirst: jest.fn() },
    users: { count: jest.fn() },
  };

  // Real service: `canManageClub` and `canAccessHierarchyScope` need only the
  // hierarchy lookup. `resolveUserAuthorization` is the only stubbed method.
  const authorizationContext = new AuthorizationContextService(
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
    ...(new Array(8).fill(undefined) as [
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
    ]),
  );
  authorizationContext.resolveUserAuthorization =
    resolveUserAuthorization as never;

  const guard = new PermissionsGuard(
    new Reflector(),
    authorizationContext,
    prisma as unknown as PrismaService,
    hierarchy as unknown as InstitutionalHierarchyService,
    ...clubAssignmentEffectivityArgs(),
  );

  const contextFor = (
    controller: { prototype: object } & (new (...args: never[]) => object),
    handlerName: string,
    params: Record<string, string> = {},
  ): ExecutionContext => {
    const handler = (controller.prototype as Record<string, unknown>)[
      handlerName
    ];
    if (typeof handler !== 'function') {
      throw new Error(`${controller.name}.${handlerName} does not exist`);
    }
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'supervisor-1' },
          params,
          query: {},
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.club_role_assignments.findMany.mockResolvedValue([]);
    prisma.union_camporee_local_fields.findFirst.mockResolvedValue(null);
    hierarchy.resolveCurrent.mockImplementation(
      async (input: { unionId?: number; clubId?: number }) => {
        if (input.unionId !== undefined) {
          return {
            division_id: UNION_TO_DIVISION[input.unionId],
            union_id: input.unionId,
            local_field_id: null,
          };
        }
        // Club 100 sits in union 3, club 200 in union 4, club 300 in union 5.
        const clubUnion = { 100: 3, 200: 4, 300: 5 }[input.clubId as number];
        return {
          division_id: UNION_TO_DIVISION[clubUnion],
          union_id: clubUnion,
          local_field_id: 70 + clubUnion,
        };
      },
    );
  });

  // -------------------------------------------------------------------------
  // S5.1 / tasks Gap 4: club-less supervisor on `active_assignment` routes.
  // Enforcing code: ActiveAssignmentPolicy.resolve() => true
  //   (policies/simple/active-assignment.policy.ts:7-9) and
  //   hasRequiredPermissions() unions global + active-club permissions, so an
  //   empty club grant list does not reject
  //   (permission-requirements.ts:133-137).
  // -------------------------------------------------------------------------
  describe('club-less supervisor on active_assignment routes (S5.1, Gap 4)', () => {
    const actors: Array<[string, () => ResolvedAuthorizationProfile]> = [
      ['director-union', () => unionActor()],
      ['assistant-union', assistantUnionActor],
      ['director-dia', () => divisionActor()],
      ['assistant-dia', assistantDivisionActor],
    ];

    const requestsRoutes = [
      'getTransferRequests',
      'getTransferRequest',
      'reviewTransferRequest',
      'getAssignmentRequests',
      'getAssignmentRequest',
      'reviewAssignmentRequest',
    ];

    it.each(
      actors.flatMap(([role, actor]) =>
        requestsRoutes.map((route) => [role, route, actor] as const),
      ),
    )(
      '%s with no club is accepted by RequestsController.%s',
      async (_role, route, actor) => {
        resolveUserAuthorization.mockResolvedValue(actor());

        await expect(
          guard.canActivate(
            contextFor(RequestsController, route, { requestId: 'r-1' }),
          ),
        ).resolves.toBe(true);
      },
    );

    it.each(
      actors.flatMap(([role, actor]) =>
        ['findAll', 'findAllUnion'].map(
          (route) => [role, route, actor] as const,
        ),
      ),
    )(
      '%s with no club is accepted by CamporeesController.%s',
      async (_role, route, actor) => {
        resolveUserAuthorization.mockResolvedValue(actor());

        await expect(
          guard.canActivate(contextFor(CamporeesController, route)),
        ).resolves.toBe(true);
      },
    );

    it.each(actors)(
      '%s with no club is accepted by AnnualRankingsController.list',
      async (_role, actor) => {
        resolveUserAuthorization.mockResolvedValue(actor());

        await expect(
          guard.canActivate(contextFor(AnnualRankingsController, 'list')),
        ).resolves.toBe(true);
      },
    );

    it.each(actors)(
      '%s with no club is accepted by the club enrollment validation queue (global resource)',
      async (_role, actor) => {
        resolveUserAuthorization.mockResolvedValue(actor());

        await expect(
          guard.canActivate(
            contextFor(
              ClubEnrollmentValidationController,
              'findValidationQueue',
            ),
          ),
        ).resolves.toBe(true);
      },
    );

    it('rejects an actor that holds only the base user role (the club-less acceptance is not unconditional)', async () => {
      resolveUserAuthorization.mockResolvedValue({
        profile: { user_id: 'plain-1' },
        authorization: {
          grants: {
            global_roles: [
              {
                role_name: 'user',
                permissions: BASE_USER_PERMISSIONS,
                scope: {},
              },
            ],
            club_assignments: [],
            direct_permissions: [],
          },
          active_assignment: { assignment_id: null },
          effective: {
            permissions: BASE_USER_PERMISSIONS,
            scope: { global: {}, club: null },
          },
        },
      });

      await expect(
        guard.canActivate(
          contextFor(RequestsController, 'reviewTransferRequest', {
            requestId: 'r-1',
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });
  });

  // -------------------------------------------------------------------------
  // S4.3 / S10.3: union camporee routes. Enforcing code:
  //   UnionCamporeePolicy.resolve (policies/camporee/union-camporee.policy.ts:16-26)
  //   -> TerritoryScopeValidator.validateUnionCamporeeScope
  //   (policies/scope/territory-scope.ts:129-174) -> actorCanAccessHierarchyScope
  //   (actor-territory-scope.ts:252-286).
  // -------------------------------------------------------------------------
  describe('union camporee routes (S4.3, S10.3)', () => {
    const approveRoutes = [
      'listUnionPendingApprovals',
      'approveUnionClubEnrollment',
      'rejectUnionClubEnrollment',
      'approveUnionMemberEnrollment',
      'rejectUnionMemberEnrollment',
    ];

    beforeEach(() => {
      // Camporee 11 belongs to union 3; camporee 12 to union 4; camporee 13 to union 5.
      prisma.union_camporees.findUnique.mockImplementation(
        async ({ where }: { where: { union_camporee_id: number } }) => {
          const unionId = { 11: 3, 12: 4, 13: 5 }[where.union_camporee_id];
          return unionId === undefined
            ? null
            : { union_id: unionId, unions: { country_id: 9 } };
        },
      );
    });

    it.each(approveRoutes)(
      'Union actor of union 3 is accepted on %s for the camporee of union 3',
      async (route) => {
        resolveUserAuthorization.mockResolvedValue(unionActor(3));

        await expect(
          guard.canActivate(
            contextFor(CamporeesController, route, { camporeeId: '11' }),
          ),
        ).resolves.toBe(true);
      },
    );

    it.each(approveRoutes)(
      'Union actor of union 3 is rejected on %s for a camporee of another union',
      async (route) => {
        resolveUserAuthorization.mockResolvedValue(unionActor(3));

        await expect(
          guard.canActivate(
            contextFor(CamporeesController, route, { camporeeId: '12' }),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
      },
    );

    it('Union actor of union 3 is rejected on findOneUnion for a camporee of another union (even one inside its own division)', async () => {
      resolveUserAuthorization.mockResolvedValue(unionActor(3));

      await expect(
        guard.canActivate(
          contextFor(CamporeesController, 'findOneUnion', {
            camporeeId: '12',
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it.each(approveRoutes)(
      'Division actor never gets %s: attendance:approve_late is not granted to Division roles (R1.9)',
      async (route) => {
        resolveUserAuthorization.mockResolvedValue(divisionActor(1));

        await expect(
          guard.canActivate(
            contextFor(CamporeesController, route, { camporeeId: '11' }),
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      },
    );

    it('Division actor of division 1 is rejected on findOneUnion for a camporee of division 2', async () => {
      resolveUserAuthorization.mockResolvedValue(divisionActor(1));

      await expect(
        guard.canActivate(
          contextFor(CamporeesController, 'findOneUnion', {
            camporeeId: '13',
          }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED });
    });

    it('answers 404 CAMPOREE_UNION_CAMPOREE_NOT_FOUND for an unknown camporee id', async () => {
      resolveUserAuthorization.mockResolvedValue(unionActor(3));

      await expect(
        guard.canActivate(
          contextFor(CamporeesController, 'findOneUnion', {
            camporeeId: '999',
          }),
        ),
      ).rejects.toMatchObject({
        status: 404,
        code: ErrorCode.CAMPOREE_UNION_CAMPOREE_NOT_FOUND,
      });
    });
  });

  // -------------------------------------------------------------------------
  // S7.3: club summary outside the territory.
  // Enforcing code: ClubPolicy.resolve (policies/club/club.policy.ts:15-27)
  //   -> assertClubAccess (policies/scope/club-access.ts:8-24)
  //   -> AuthorizationContextService.canManageClub
  //   (services/authorization-context.service.ts:763-778).
  // -------------------------------------------------------------------------
  describe('club overview and detail (S7.3)', () => {
    it.each([
      ['getOverview', 'director-union', () => unionActor(3), '100', true],
      ['getOverview', 'director-union', () => unionActor(3), '200', false],
      ['getOverview', 'director-union', () => unionActor(3), '300', false],
      ['getOverview', 'director-dia', () => divisionActor(1), '100', true],
      ['getOverview', 'director-dia', () => divisionActor(1), '200', true],
      ['getOverview', 'director-dia', () => divisionActor(1), '300', false],
      ['findOne', 'director-union', () => unionActor(3), '200', false],
      ['findOne', 'director-dia', () => divisionActor(1), '300', false],
    ] as const)(
      'ClubsController.%s: %s on club %s -> accepted=%s',
      async (route, _role, actor, clubId, accepted) => {
        resolveUserAuthorization.mockResolvedValue(actor());
        const run = guard.canActivate(
          contextFor(ClubsController, route, { clubId }),
        );

        if (accepted) {
          await expect(run).resolves.toBe(true);
        } else {
          await expect(run).rejects.toMatchObject({
            code: ErrorCode.GUARD_CLUB_SCOPE_REQUIRED,
          });
        }
      },
    );
  });
});
