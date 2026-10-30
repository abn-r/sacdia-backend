import { SectionRankingsService } from './section-rankings.service';

/** Minimal profile: the scope helpers read only these fields. */
const profileWith = (
  permissions: string[],
  global: { union?: { id: number }; division?: { id: number } } = {},
) =>
  ({
    profile: { user_id: 'u-1' },
    authorization: {
      grants: { global_roles: [], club_assignments: [] },
      active_assignment: { assignment_id: null },
      effective: { permissions, scope: { global } },
    },
  }) as any;

describe('SectionRankingsService territory tiers', () => {
  const prisma = {
    sectionRanking: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    club_sections: { findUnique: jest.fn() },
    enrollmentRanking: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new SectionRankingsService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  const listWhere = async (profile: any, clubId?: number) => {
    await service.list({ profile, yearId: 1, clubId, page: 1, limit: 20 });
    return prisma.sectionRanking.findMany.mock.calls[0][0].where;
  };

  it('read_union lists the clubs whose local field is in the caller union', async () => {
    const where = await listWhere(
      profileWith(['section_rankings:read_union'], { union: { id: 3 } }),
    );
    expect(where).toEqual({
      ecclesiastical_year_id: 1,
      club: { local_fields: { union_id: 3 } },
    });
  });

  it('read_division lists the clubs whose union is in the caller division', async () => {
    const where = await listWhere(
      profileWith(['section_rankings:read_division'], { division: { id: 1 } }),
      10,
    );
    expect(where).toEqual({
      ecclesiastical_year_id: 1,
      club: { local_fields: { unions: { division_id: 1 } } },
      club_id: 10,
    });
  });

  it('read_union without a union in scope matches nothing', async () => {
    const where = await listWhere(profileWith(['section_rankings:read_union']));
    expect(where).toEqual({ ecclesiastical_year_id: -1 });
  });

  it('read_global still has no territory filter', async () => {
    const where = await listWhere(
      profileWith(
        ['section_rankings:read_global', 'section_rankings:read_union'],
        { union: { id: 3 } },
      ),
    );
    expect(where).toEqual({ ecclesiastical_year_id: 1 });
  });

  const sectionInUnion = (unionId: number, divisionId: number) => ({
    club_section_id: 7,
    clubs: {
      club_id: 10,
      local_field_id: 4,
      local_fields: { union_id: unionId, unions: { division_id: divisionId } },
    },
  });

  it('opens the members of a section in the caller union', async () => {
    prisma.club_sections.findUnique.mockResolvedValue(sectionInUnion(3, 1));
    await expect(
      service.getMembers(
        7,
        1,
        profileWith(['section_rankings:read_union'], { union: { id: 3 } }),
      ),
    ).resolves.toEqual([]);
  });

  it('denies the members of a section in another union', async () => {
    prisma.club_sections.findUnique.mockResolvedValue(sectionInUnion(5, 1));
    await expect(
      service.getMembers(
        7,
        1,
        profileWith(['section_rankings:read_union'], { union: { id: 3 } }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEMBER_RANKING_SCOPE_DENIED' },
    });
  });

  it('denies the members of a section in another division', async () => {
    prisma.club_sections.findUnique.mockResolvedValue(sectionInUnion(3, 2));
    await expect(
      service.getMembers(
        7,
        1,
        profileWith(['section_rankings:read_division'], {
          division: { id: 1 },
        }),
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEMBER_RANKING_SCOPE_DENIED' },
    });
  });
});
