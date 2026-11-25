import { ClubsService } from './clubs.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../common/testing/actor-scope.fixture';
import { clubMatches } from '../common/testing/territory-where.testing';

/**
 * B8 (union-division-app-surface): clubs in territory (function 6, S7.3).
 * `GET /clubs` is `@SkipPermissions`, so the territorial recorte lives in the
 * service and must hold on its own: a Union/Division actor lists only clubs
 * of its territory, client filters outside it answer 403, and an unconfigured
 * territory answers 403 ADMIN_USER_SCOPE_MISSING (R1.5). The per-club routes
 * (`/clubs/:id`, `/clubs/:id/overview`) are covered at guard level in
 * common/guards/permissions.guard.territory-coverage.spec.ts.
 *
 * Real code under test: ClubsService.findAll + resolveActorTerritoryScope +
 * assertClubListFiltersInActorScope + clubsWhereForActor. Doubles: Prisma.
 *
 * Enforcing code:
 * - clubs/clubs.service.ts:117-127 (resolve scope, assert filters, AND with
 *   client where)
 * - common/authorization/actor-territory-scope.ts:344-389 (filters),
 *   :96-112 (clubsWhereForActor; unconfigured throws at :103-104)
 */

const ACTOR_UUID = '11111111-1111-4111-8111-111111111111';

// Local fields: 71 in union 3, 72 in union 4 (division 1), 73 in union 5 (division 2).
const LOCAL_FIELDS: Record<
  number,
  { local_field_id: number; union_id: number; division_id: number }
> = {
  71: { local_field_id: 71, union_id: 3, division_id: 1 },
  72: { local_field_id: 72, union_id: 4, division_id: 1 },
  73: { local_field_id: 73, union_id: 5, division_id: 2 },
};
const CLUBS = [
  { id: 1, club: { local_field_id: 71, union_id: 3, division_id: 1 } },
  { id: 2, club: { local_field_id: 72, union_id: 4, division_id: 1 } },
  { id: 3, club: { local_field_id: 73, union_id: 5, division_id: 2 } },
];

const unionActor = () =>
  actorProfile({
    userId: ACTOR_UUID,
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { union: { id: 3 }, division: { id: 1 } },
  });
const divisionActor = () =>
  actorProfile({
    userId: ACTOR_UUID,
    globalRoles: [
      { roleName: 'assistant-dia', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: { division: { id: 1 } },
  });
const unconfiguredUnionActor = () =>
  actorProfile({
    userId: ACTOR_UUID,
    globalRoles: [
      { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
    ],
    territory: {},
  });

describe('ClubsService.findAll territory coverage (union-division-app-surface B8)', () => {
  let profile: ReturnType<typeof actorProfile>;
  let prisma: any;
  let service: ClubsService;

  beforeEach(() => {
    profile = unionActor();
    prisma = {
      clubs: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      local_fields: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row = LOCAL_FIELDS[where.local_field_id];
          return row
            ? {
                local_field_id: row.local_field_id,
                union_id: row.union_id,
                unions: { division_id: row.division_id },
              }
            : null;
        }),
      },
      districts: {
        findUnique: jest.fn(async ({ where }: any) => {
          // District 900 sits in local field 72 (union 4), district 901 in 71.
          const lf = { 900: 72, 901: 71 }[where.districlub_type_id as number];
          return lf ? { local_field_id: lf } : null;
        }),
      },
      churches: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new ClubsService(
      prisma,
      undefined as never, // fileStorage
      { resolveUserAuthorization: jest.fn(async () => profile) } as never,
      ...(new Array(9).fill(undefined) as never[]),
    );
  });

  const visibleClubIds = () => {
    const where = prisma.clubs.findMany.mock.calls.at(-1)[0].where as {
      AND?: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const clauses = where.AND ?? [where];
    return CLUBS.filter((c) =>
      clauses.every((clause) => clubMatches(clause, c.club)),
    ).map((c) => c.id);
  };

  it('Union 3 lists only clubs of union 3', async () => {
    await service.findAll({}, undefined, ACTOR_UUID);

    expect(visibleClubIds()).toEqual([1]);
    expect(prisma.clubs.count.mock.calls[0][0].where).toEqual(
      prisma.clubs.findMany.mock.calls[0][0].where,
    );
  });

  it('Division 1 lists clubs of every union of its division and none of division 2', async () => {
    profile = divisionActor();

    await service.findAll({}, undefined, ACTOR_UUID);

    expect(visibleClubIds()).toEqual([1, 2]);
  });

  it('a client local_field_id inside the territory narrows the list', async () => {
    profile = divisionActor();

    await service.findAll({ localFieldId: 72 }, undefined, ACTOR_UUID);

    expect(visibleClubIds()).toEqual([2]);
  });

  it.each([
    ['Union 3 asking for a local field of union 4', unionActor, 72],
    ['Union 3 asking for a local field of division 2', unionActor, 73],
    ['Division 1 asking for a local field of division 2', divisionActor, 73],
  ] as const)(
    '%s answers 403 GUARD_PERMISSION_DENIED and runs no query (S7.3)',
    async (_label, actor, localFieldId) => {
      profile = actor();

      await expect(
        service.findAll({ localFieldId }, undefined, ACTOR_UUID),
      ).rejects.toMatchObject({
        status: 403,
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      expect(prisma.clubs.findMany).not.toHaveBeenCalled();
    },
  );

  it('Union 3 asking for a district of another union answers 403 GUARD_PERMISSION_DENIED', async () => {
    await expect(
      service.findAll({ districtId: 900 }, undefined, ACTOR_UUID),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    expect(prisma.clubs.findMany).not.toHaveBeenCalled();
  });

  it('Union 3 asking for a district of its own union is accepted', async () => {
    await service.findAll({ districtId: 901 }, undefined, ACTOR_UUID);

    expect(prisma.clubs.findMany).toHaveBeenCalledTimes(1);
  });

  it('unconfigured Union actor answers 403 ADMIN_USER_SCOPE_MISSING and runs no query (R1.5)', async () => {
    profile = unconfiguredUnionActor();

    await expect(
      service.findAll({}, undefined, ACTOR_UUID),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.ADMIN_USER_SCOPE_MISSING,
    });
    expect(prisma.clubs.findMany).not.toHaveBeenCalled();
  });
});
