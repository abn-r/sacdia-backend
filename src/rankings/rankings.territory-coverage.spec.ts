import { Logger } from '@nestjs/common';
import { AnnualRankingsService } from './annual-ranking-progress/annual-rankings.service';
import { SectionRankingsService } from './section-rankings/section-rankings.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  actorProfile,
  TERRITORIAL_PERMISSIONS,
} from '../common/testing/actor-scope.fixture';
import { clubMatches } from '../common/testing/territory-where.testing';

/**
 * B8 (union-division-app-surface): «Progreso anual» (function 8, S9.2).
 * Club standings (`/annual-rankings`) and section standings
 * (`/section-rankings`) never include another territory for a Union or
 * Division actor, whatever the client asks for.
 *
 * Real code under test: AnnualRankingsService.getLeaderboard (scope gate) and
 * SectionRankingsService.list / getMembers (where-clause and section gate).
 * Doubles: Prisma, config/tier collaborators.
 *
 * Enforcing code:
 * - rankings/annual-ranking-progress/annual-rankings.service.ts
 *   `assertCanReadLocalField` (grep; ~:369-411): Union/Division territory ->
 *   assertLocalFieldInActorScope (common/authorization/actor-territory-scope.ts:325-342)
 * - rankings/section-rankings/section-rankings.service.ts `buildScopeWhere`
 *   (~:153-238) and `validateSectionScope` (~:245-294);
 *   rankings/ranking-territory-scope.ts:25-51 (territory -> club where)
 * Seeded permissions: section_rankings:read_union -> union roles,
 * section_rankings:read_division -> division roles
 * (prisma/seeds/role-permissions.seed.sql:2929-2944).
 */

const LOCAL_FIELDS: Record<number, { union_id: number; division_id: number }> =
  {
    71: { union_id: 3, division_id: 1 },
    72: { union_id: 4, division_id: 1 },
    73: { union_id: 5, division_id: 2 },
  };
const CLUBS = [
  { id: 1, club: { local_field_id: 71, union_id: 3, division_id: 1 } },
  { id: 2, club: { local_field_id: 72, union_id: 4, division_id: 1 } },
  { id: 3, club: { local_field_id: 73, union_id: 5, division_id: 2 } },
];

function withPermissions(
  profile: ReturnType<typeof actorProfile>,
  permissions: string[],
) {
  (profile.authorization.effective as { permissions: string[] }).permissions =
    permissions;
  return profile;
}

const unionActor = () =>
  withPermissions(
    actorProfile({
      userId: 'union-1',
      globalRoles: [
        { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
      ],
      territory: { union: { id: 3 }, division: { id: 1 } },
    }),
    ['rankings:read', 'section_rankings:read_union'],
  );
const divisionActor = () =>
  withPermissions(
    actorProfile({
      userId: 'division-1',
      globalRoles: [
        { roleName: 'assistant-dia', permissions: TERRITORIAL_PERMISSIONS },
      ],
      territory: { division: { id: 1 } },
    }),
    ['rankings:read', 'section_rankings:read_division'],
  );
const unconfiguredUnionActor = () =>
  withPermissions(
    actorProfile({
      userId: 'union-2',
      globalRoles: [
        { roleName: 'director-union', permissions: TERRITORIAL_PERMISSIONS },
      ],
      territory: {},
    }),
    ['rankings:read', 'section_rankings:read_union'],
  );

describe('annual rankings territory coverage (union-division-app-surface B8)', () => {
  const SENTINEL = new Error('past-the-scope-gate');
  let prisma: any;
  let service: AnnualRankingsService;

  beforeEach(() => {
    prisma = {
      local_fields: {
        findUnique: jest.fn(async ({ where }: any) => {
          const row = LOCAL_FIELDS[where.local_field_id];
          return row
            ? {
                local_field_id: where.local_field_id,
                union_id: row.union_id,
                unions: { division_id: row.division_id },
              }
            : null;
        }),
      },
    };
    service = new AnnualRankingsService(
      prisma,
      // First collaborator reached after the gate: it proves the gate passed.
      {
        // Throws synchronously so no orphan rejected promise is left behind.
        getByScope: jest.fn(() => {
          throw SENTINEL;
        }),
      } as never,
      {} as never,
      {} as never,
    );
  });

  const leaderboard = (profile: any, localFieldId: number) =>
    service.getLeaderboard({ localFieldId, yearId: 1, clubTypeId: 1 }, profile);

  it.each([
    ['Union 3', unionActor, 71, true],
    ['Union 3', unionActor, 72, false],
    ['Union 3', unionActor, 73, false],
    ['Division 1', divisionActor, 71, true],
    ['Division 1', divisionActor, 72, true],
    ['Division 1', divisionActor, 73, false],
  ] as const)(
    '/annual-rankings: %s asking for local field %s -> inside=%s',
    async (_label, actor, localFieldId, inside) => {
      const run = leaderboard(actor(), localFieldId);

      if (inside) {
        await expect(run).rejects.toBe(SENTINEL);
      } else {
        await expect(run).rejects.toMatchObject({
          status: 403,
          code: ErrorCode.GUARD_PERMISSION_DENIED,
        });
      }
    },
  );

  it('/annual-rankings: an unknown local field id is also denied (no probing)', async () => {
    await expect(leaderboard(divisionActor(), 999)).rejects.toMatchObject({
      code: ErrorCode.GUARD_PERMISSION_DENIED,
    });
  });
});

describe('section rankings territory coverage (union-division-app-surface B8)', () => {
  let prisma: any;
  let service: SectionRankingsService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = {
      sectionRanking: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      enrollmentRanking: { findMany: jest.fn().mockResolvedValue([]) },
      club_sections: {
        findUnique: jest.fn(async ({ where }: any) => {
          const club = CLUBS.find((c) => c.id === where.club_section_id - 1000);
          return club
            ? {
                club_section_id: where.club_section_id,
                clubs: {
                  club_id: club.id,
                  local_field_id: club.club.local_field_id,
                  local_fields: {
                    union_id: club.club.union_id,
                    unions: { division_id: club.club.division_id },
                  },
                },
              }
            : null;
        }),
      },
    };
    service = new SectionRankingsService(prisma);
  });

  const listedClubIds = () => {
    const where = prisma.sectionRanking.findMany.mock.calls.at(-1)[0].where as {
      club?: Record<string, unknown>;
      ecclesiastical_year_id: number;
      club_id?: number;
    };
    if (!where.club) return [];
    return CLUBS.filter(
      (c) =>
        clubMatches(where.club, c.club) &&
        (where.club_id === undefined || where.club_id === c.id),
    ).map((c) => c.id);
  };

  it('Union 3 lists section standings of union 3 only', async () => {
    await service.list({
      profile: unionActor(),
      yearId: 1,
      page: 1,
      limit: 20,
    });

    expect(listedClubIds()).toEqual([1]);
  });

  it('Division 1 lists section standings of its division only', async () => {
    await service.list({
      profile: divisionActor(),
      yearId: 1,
      page: 1,
      limit: 20,
    });

    expect(listedClubIds()).toEqual([1, 2]);
  });

  it('a client club_id of another territory is ANDed with the territory and yields nothing (S9.2)', async () => {
    await service.list({
      profile: unionActor(),
      clubId: 2,
      yearId: 1,
      page: 1,
      limit: 20,
    });

    expect(listedClubIds()).toEqual([]);
  });

  it('a section of another division is denied on the members drill-down', async () => {
    await expect(
      service.getMembers(1003, 1, divisionActor()),
    ).rejects.toMatchObject({
      status: 403,
      code: ErrorCode.MEMBER_RANKING_SCOPE_DENIED,
    });
    expect(prisma.enrollmentRanking.findMany).not.toHaveBeenCalled();
  });

  it('a section of another union of the same division is denied for a Union actor but allowed for Division', async () => {
    await expect(
      service.getMembers(1002, 1, unionActor()),
    ).rejects.toMatchObject({ code: ErrorCode.MEMBER_RANKING_SCOPE_DENIED });

    await expect(service.getMembers(1002, 1, divisionActor())).resolves.toEqual(
      [],
    );
  });

  describe('unconfigured territory (fail closed)', () => {
    // NOTE: R1.5 asks for 403 ADMIN_USER_SCOPE_MISSING. Here the section list
    // answers an EMPTY page (where year = -1, ranking-territory-scope.ts:36-38
    // returns a null club where) and the members drill-down answers
    // MEMBER_RANKING_SCOPE_DENIED. Reported as a gap; these tests only prove
    // nothing leaks.
    it('the section list matches no row', async () => {
      await service.list({
        profile: unconfiguredUnionActor(),
        yearId: 1,
        page: 1,
        limit: 20,
      });

      expect(prisma.sectionRanking.findMany.mock.calls[0][0].where).toEqual({
        ecclesiastical_year_id: -1,
      });
    });

    it('the members drill-down is denied', async () => {
      await expect(
        service.getMembers(1001, 1, unconfiguredUnionActor()),
      ).rejects.toMatchObject({ code: ErrorCode.MEMBER_RANKING_SCOPE_DENIED });
    });
  });
});
