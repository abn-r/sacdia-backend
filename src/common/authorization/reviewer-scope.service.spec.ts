import { ReviewerScopeService } from './reviewer-scope.service';
import { ServiceCredentialReviewScopeService } from './service-credential-review-scope.service';
import { GlobalRole } from './roles';

jest.mock('../../investiture-requests/investiture-pastor-eligibility', () => ({
  pastorCanAuthorize: jest.fn(async (_prisma: unknown, id: string) =>
    id.startsWith('eligible'),
  ),
}));

const PERM = 'club_enrollments:validate';
const EVERYWHERE = [
  GlobalRole.SUPER_ADMIN,
  GlobalRole.ADMIN,
  GlobalRole.ASSISTANT_ADMIN,
];

type Actor = {
  roles: string[];
  /** roles that carry the permission; defaults to all of `roles` */
  withPermission?: string[];
  global?: {
    local_field?: { id: number };
    union?: { id: number };
    division?: { id: number };
  };
};

function setup(actors: Record<string, Actor>, opts: { year?: boolean } = {}) {
  const resolveUserAuthorization = jest.fn(async (id: string) => {
    const actor = actors[id] ?? { roles: [] };
    const carrying = actor.withPermission ?? actor.roles;
    return {
      profile: { user_id: id },
      authorization: {
        grants: {
          global_roles: actor.roles.map((role_name) => ({
            role_name,
            permissions: carrying.includes(role_name) ? [PERM] : [],
          })),
          club_assignments: [],
        },
        effective: { scope: { global: actor.global ?? {} } },
      },
    };
  });
  const prisma = {
    club_sections: { count: jest.fn(async () => 0) },
    club_role_assignments: { count: jest.fn(async () => 0) },
    district_investiture_pastors: {
      findMany: jest.fn(async ({ where }: { where: { user_id: string } }) =>
        where.user_id.endsWith('pastor') ? [{ districlub_type_id: 10 }] : [],
      ),
    },
  };
  const coordination = {
    getEffectiveCoordinatorSectionIds: jest.fn(async (id: string) =>
      id.startsWith('coord') ? [5, 3] : [],
    ),
  };
  const ecclesiasticalYear = {
    getCurrentYear: jest.fn(async () => {
      if (opts.year === false) throw new Error('no current year');
      return { year_id: 7 };
    }),
  };
  const args = [
    prisma,
    { resolveUserAuthorization },
    coordination,
    ecclesiasticalYear,
  ] as never[];
  return {
    prisma,
    coordination,
    scope: new ReviewerScopeService(...(args as [never, never, never, never])),
    credentialScope: new ServiceCredentialReviewScopeService(
      ...(args as [never, never, never, never]),
    ),
  };
}

const enrollmentChannels = (
  scope: ReviewerScopeService,
  id: string,
  includeUnionDivision = true,
) =>
  scope.resolveReviewerChannels(id, PERM, {
    everywhere: EVERYWHERE,
    includeUnionDivision,
  });

describe('ReviewerScopeService channels', () => {
  const actors: Record<string, Actor> = {
    admin: { roles: ['admin'] },
    assistant: { roles: ['assistant-admin'] },
    lf: { roles: ['director-lf'], global: { local_field: { id: 1 } } },
    lfNoField: { roles: ['assistant-lf'] },
    union: { roles: ['director-union'], global: { union: { id: 2 } } },
    division: { roles: ['assistant-dia'], global: { division: { id: 3 } } },
    coord: { roles: ['zone-coordinator'] },
    'other-coordinator': { roles: ['coordinator'] },
    'eligible-pastor': { roles: ['pastor'] },
    'plain-pastor': { roles: ['pastor'] },
    club: { roles: ['user'] },
    noPerm: {
      roles: ['director-lf'],
      withPermission: [],
      global: { local_field: { id: 1 } },
    },
    dual: {
      roles: ['director-lf', 'director-union'],
      global: { local_field: { id: 1 }, union: { id: 2 } },
    },
  };

  it('admin and assistant-admin reach everything with the matched role', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'admin')).toEqual([
      { role: 'admin', scope: { all: true } },
    ]);
    expect(await enrollmentChannels(scope, 'assistant')).toEqual([
      { role: 'assistant-admin', scope: { all: true } },
    ]);
  });

  it('Local Field reaches the clubs of its local field', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'lf')).toEqual([
      {
        role: 'director-lf',
        scope: { all: false, sectionIds: [], clubs: { local_field_id: 1 } },
      },
    ]);
  });

  it('Union reaches the clubs of its union and Division the clubs of its division', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'union')).toEqual([
      {
        role: 'director-union',
        scope: {
          all: false,
          sectionIds: [],
          clubs: { local_fields: { union_id: 2 } },
        },
      },
    ]);
    expect(await enrollmentChannels(scope, 'division')).toEqual([
      {
        role: 'assistant-dia',
        scope: {
          all: false,
          sectionIds: [],
          clubs: { local_fields: { unions: { division_id: 3 } } },
        },
      },
    ]);
  });

  it('a Local Field or Union role without territory reaches nothing', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'lfNoField')).toEqual([]);
  });

  it('coordinators reach the sections of their assignments, none means no channel', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'coord')).toEqual([
      {
        role: 'zone-coordinator',
        scope: { all: false, sectionIds: [5, 3], clubs: null },
      },
    ]);
    expect(await enrollmentChannels(scope, 'other-coordinator')).toEqual([]);
  });

  it('a pastor reaches the districts they are assigned to only while eligible', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'eligible-pastor')).toEqual([
      {
        role: 'pastor',
        scope: {
          all: false,
          sectionIds: [],
          clubs: { districlub_type_id: { in: [10] } },
        },
      },
    ]);
    // Assigned to a district but not an eligible pastor (inactive account / role).
    expect(await enrollmentChannels(scope, 'plain-pastor')).toEqual([]);
  });

  it('a role that does not carry the permission is not a channel', async () => {
    const { scope } = setup(actors);
    expect(await enrollmentChannels(scope, 'noPerm')).toEqual([]);
    expect(await enrollmentChannels(scope, 'club')).toEqual([]);
  });

  it('keeps one channel per role, in priority order (Local Field before Union)', async () => {
    const { scope } = setup(actors);
    const channels = await enrollmentChannels(scope, 'dual');
    expect(channels.map((channel) => channel.role)).toEqual([
      'director-lf',
      'director-union',
    ]);
  });

  it('merges the channels into one scope for lists and counts', async () => {
    const { scope } = setup(actors);
    const channels = [
      ...(await enrollmentChannels(scope, 'lf')),
      ...(await enrollmentChannels(scope, 'union')),
    ];
    expect(scope.combinedScope(channels)).toEqual({
      all: false,
      sectionIds: [],
      clubs: {
        OR: [{ local_field_id: 1 }, { local_fields: { union_id: 2 } }],
      },
    });
    expect(scope.combinedScope([])).toBeNull();
    expect(
      scope.combinedScope(await enrollmentChannels(scope, 'admin')),
    ).toEqual({ all: true });
  });

  it('sectionsWhere matches nothing without channels and everything for admins', async () => {
    const { scope } = setup(actors);
    expect(scope.sectionsWhere([])).toEqual({ club_section_id: { in: [] } });
    expect(
      scope.sectionsWhere(await enrollmentChannels(scope, 'admin')),
    ).toEqual({});
  });

  it('findReviewerRoleForSection returns the first channel that covers the section', async () => {
    const { scope, prisma } = setup(actors);
    const channels = await enrollmentChannels(scope, 'dual');
    prisma.club_sections.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    await expect(scope.findReviewerRoleForSection(channels, 44)).resolves.toBe(
      'director-union',
    );
    prisma.club_sections.count.mockResolvedValue(0);
    await expect(
      scope.findReviewerRoleForSection(channels, 44),
    ).resolves.toBeNull();
    await expect(
      scope.findReviewerRoleForSection(
        await enrollmentChannels(scope, 'admin'),
        44,
      ),
    ).resolves.toBe('admin');
  });

  it('holdsClubRoleInSection looks for an active role other than member in that section and year', async () => {
    const { scope, prisma } = setup(actors);
    prisma.club_role_assignments.count.mockResolvedValueOnce(1);
    await expect(scope.holdsClubRoleInSection('u1', 44, 7)).resolves.toBe(true);
    expect(prisma.club_role_assignments.count).toHaveBeenCalledWith({
      where: {
        user_id: 'u1',
        club_section_id: 44,
        ecclesiastical_year_id: 7,
        active: true,
        status: 'active',
        roles: { role_name: { not: 'member' } },
      },
    });
    prisma.club_role_assignments.count.mockResolvedValueOnce(0);
    await expect(scope.holdsClubRoleInSection('u1', 44, 7)).resolves.toBe(
      false,
    );
  });
});

describe('ServiceCredentialReviewScopeService keeps its own channels', () => {
  it('does NOT open union or division channels for credentials', async () => {
    const { credentialScope } = setup({
      union: { roles: ['director-union'], global: { union: { id: 2 } } },
      division: { roles: ['director-dia'], global: { division: { id: 3 } } },
      assistant: { roles: ['assistant-admin'] },
    });
    // The credentials permission is the one the fake grants; same shape.
    expect(await credentialScope.resolveChannels('union')).toEqual([]);
    expect(await credentialScope.resolveChannels('division')).toEqual([]);
    // assistant-admin is not an "everywhere" role for credentials.
    expect(await credentialScope.resolveChannels('assistant')).toEqual([]);
  });
});
