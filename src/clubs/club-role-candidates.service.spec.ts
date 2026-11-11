import { ErrorCode } from '../common/errors/error-codes';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { ClubsController } from './clubs.controller';
import { ClubRoleCandidatesService } from './club-role-candidates.service';
import { RoleRequirementService } from '../role-requirements/role-requirement.service';

const CLUB = 10;
const SECTION = 163; // Aventureros
const GM_SECTION = 90;
const CALLER = 'caller-0000-4000-8000-000000000000';
const U_AVAILABLE = 'aaaaaaaa-0000-4000-8000-000000000001';
const U_WITH_ROLE = 'aaaaaaaa-0000-4000-8000-000000000002';
const U_NOT_ENROLLED = 'aaaaaaaa-0000-4000-8000-000000000003';
const U_MINOR = 'aaaaaaaa-0000-4000-8000-000000000004';
const U_HOLDER_HERE = 'aaaaaaaa-0000-4000-8000-000000000005';

const YEAR = {
  year_id: 4,
  start_date: new Date('2026-01-01T00:00:00Z'),
  end_date: new Date('2026-12-31T00:00:00Z'),
};

function user(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    user_id: id,
    name,
    paternal_last_name: 'Prueba',
    maternal_last_name: null,
    user_image: null,
    birthday: new Date('1990-05-05T00:00:00Z'),
    ...extra,
  };
}

function nonMember(
  userId: string,
  role: string,
  sectionId: number,
  clubType: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    user_id: userId,
    ecclesiastical_year_id: 4,
    club_section_id: sectionId,
    status: 'active',
    active: true,
    end_date: null,
    roles: { role_name: role },
    club_sections: {
      club_section_id: sectionId,
      club_type_id: sectionId === 165 ? 2 : 1,
      club_types: { name: clubType },
    },
    ecclesiastical_year: {
      start_date: new Date('2026-01-01T00:00:00Z'),
      end_date: new Date('2026-12-31T00:00:00Z'),
    },
    ...overrides,
  };
}

function build(
  overrides: {
    sectionType?: string;
    sectionClub?: number;
    gmRows?: unknown[];
    eligible?: string[];
    users?: unknown[];
    nonMemberRows?: unknown[];
    holders?: unknown[];
    consent?: Map<string, { verifiedAt: Date | null }>;
    /** role_requirements rows (default: counselor, INFO). */
    requirements?: unknown[];
    /** service_credentials rows used by the requirement evaluation. */
    credentials?: unknown[];
    /** service_credentials rows shown in the detail. */
    detailCredentials?: unknown[];
  } = {},
) {
  const gmRows = overrides.gmRows ?? [
    { user_id: U_AVAILABLE, ecclesiastical_year_id: 4, status: 'active' },
    { user_id: U_WITH_ROLE, ecclesiastical_year_id: 4, status: 'pending' },
    { user_id: U_NOT_ENROLLED, ecclesiastical_year_id: 3, status: 'active' },
    { user_id: U_MINOR, ecclesiastical_year_id: 4, status: 'active' },
    { user_id: U_HOLDER_HERE, ecclesiastical_year_id: 4, status: 'active' },
  ];
  const eligibleIds = overrides.eligible ?? [
    U_AVAILABLE,
    U_WITH_ROLE,
    U_NOT_ENROLLED,
    U_MINOR,
    U_HOLDER_HERE,
  ];
  const users = overrides.users ?? [
    user(U_AVAILABLE, 'Laura'),
    user(U_WITH_ROLE, 'Beatriz'),
    user(U_NOT_ENROLLED, 'Carlos'),
    user(U_MINOR, 'Dana', { birthday: new Date('2010-01-01T00:00:00Z') }),
    user(U_HOLDER_HERE, 'Elena'),
  ];
  const nonMemberRows = overrides.nonMemberRows ?? [
    nonMember(U_WITH_ROLE, 'counselor', 165, 'Conquistadores'),
    nonMember(U_HOLDER_HERE, 'secretary', SECTION, 'Aventureros'),
    // history of another year counts for service_years only
    nonMember(U_AVAILABLE, 'secretary', 165, 'Conquistadores', {
      ecclesiastical_year_id: 2,
      status: 'ended',
      active: false,
    }),
  ];
  const holders = overrides.holders ?? [
    {
      user_id: U_HOLDER_HERE,
      roles: { role_name: 'secretary' },
      users: { name: 'Elena', paternal_last_name: 'Prueba' },
    },
    {
      user_id: 'x1',
      roles: { role_name: 'deputy-director' },
      users: { name: 'Ana', paternal_last_name: 'Ruiz' },
    },
  ];

  const craFindMany = jest.fn(
    (args: { where: Record<string, unknown> & { roles?: any } }) => {
      const roles = args.where.roles;
      if (roles?.role_name === 'member') return Promise.resolve(gmRows);
      if (args.where.club_section_id === SECTION)
        return Promise.resolve(holders);
      return Promise.resolve(nonMemberRows);
    },
  );
  const prisma = {
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        main_club_id: overrides.sectionClub ?? CLUB,
        club_type_id: 1,
        club_types: { name: overrides.sectionType ?? 'Aventureros' },
      }),
      findMany: jest.fn().mockResolvedValue([
        { club_section_id: SECTION, club_types: { name: 'Aventureros' } },
        { club_section_id: GM_SECTION, club_types: { name: 'Guías Mayores' } },
      ]),
    },
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({ year_id: 3 }),
    },
    roles: {
      findMany: jest.fn().mockResolvedValue([
        { role_id: 'r1', role_name: 'deputy-director', role_slot_limits: null },
        { role_id: 'r2', role_name: 'secretary', role_slot_limits: null },
        { role_id: 'r3', role_name: 'treasurer', role_slot_limits: null },
        {
          role_id: 'r4',
          role_name: 'secretary-treasurer',
          role_slot_limits: null,
        },
        { role_id: 'r5', role_name: 'counselor', role_slot_limits: null },
      ]),
    },
    club_role_assignments: { findMany: craFindMany },
    users: {
      findMany: jest.fn((args: { where: { user_id: { in: string[] } } }) =>
        Promise.resolve(
          (users as { user_id: string }[]).filter((u) =>
            args.where.user_id.in.includes(u.user_id),
          ),
        ),
      ),
    },
    institutional_certificate_requests: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { user_id: U_AVAILABLE, class: { asset_code: 'GM-02' } },
        ]),
    },
    enrollments: {
      findMany: jest.fn().mockResolvedValue([
        {
          enrollment_id: 7,
          investiture_date: new Date('2019-06-01T00:00:00Z'),
          ecclesiastical_year: {
            start_date: new Date('2019-01-01T00:00:00Z'),
            end_date: new Date('2019-12-31T00:00:00Z'),
          },
        },
      ]),
    },
    users_certifications: {
      findMany: jest.fn().mockResolvedValue([
        {
          status: 'CERTIFIED',
          certified_at: new Date('2024-01-01T00:00:00Z'),
          certifications: { name: 'Primeros auxilios' },
        },
      ]),
    },
    users_honors: { count: jest.fn().mockResolvedValue(12) },
    member_insurances: {
      findMany: jest.fn().mockResolvedValue([
        {
          start_date: new Date('2026-01-01T00:00:00Z'),
          end_date: new Date('2099-01-01T00:00:00Z'),
        },
      ]),
    },
    insurance_assignments: { findMany: jest.fn().mockResolvedValue([]) },
    role_requirements: {
      findMany: jest.fn().mockResolvedValue(
        overrides.requirements ?? [
          {
            requirement_type: 'COUNSELOR_TRAINING',
            mode: 'INFO',
            effective_from: null,
            equivalent_certification_id: null,
            roles: { role_name: 'counselor' },
          },
        ],
      ),
    },
    service_credentials: {
      findMany: jest.fn((args: { where: { user_id: unknown } }) =>
        Promise.resolve(
          typeof args.where.user_id === 'string'
            ? (overrides.detailCredentials ?? [])
            : (overrides.credentials ?? []),
        ),
      ),
    },
  };
  const ecclesiasticalYear = {
    getCurrentYear: jest.fn().mockResolvedValue(YEAR),
  };
  const evaluateMany = jest.fn().mockImplementation((ids: string[]) =>
    Promise.resolve(
      new Map(
        ids.map((id) => [
          id,
          eligibleIds.includes(id)
            ? {
                eligible: true,
                basis: id === U_AVAILABLE ? 'INVESTED' : 'APPROVED',
                enrollmentId: id === U_AVAILABLE ? 7 : null,
              }
            : { eligible: false, basis: null, enrollmentId: null },
        ]),
      ),
    ),
  );
  const consentGate = {
    loadDependentConsent: jest
      .fn()
      .mockResolvedValue(
        overrides.consent ??
          new Map([[U_MINOR, { verifiedAt: null as Date | null }]]),
      ),
  };
  const fileStorage = {
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://signed'),
  };
  const service = new ClubRoleCandidatesService(
    prisma as never,
    ecclesiasticalYear as never,
    { evaluateMany } as never,
    consentGate as never,
    fileStorage as never,
    new RoleRequirementService(),
  );
  return {
    service,
    prisma,
    evaluateMany,
    consentGate,
    craFindMany,
    fileStorage,
  };
}

const query = { page: 1, limit: 20, filter: 'all' as const };

describe('ClubRoleCandidatesService.list', () => {
  it('404s when the section belongs to another club (or does not exist)', async () => {
    const { service } = build({ sectionClub: 999 });
    await expect(
      service.list(CLUB, SECTION, CALLER, query),
    ).rejects.toMatchObject({ code: ErrorCode.CLUB_SECTION_NOT_FOUND });
  });

  it('409s when the section is not Aventureros or Conquistadores', async () => {
    const { service } = build({ sectionType: 'Guías Mayores' });
    await expect(
      service.list(CLUB, SECTION, CALLER, query),
    ).rejects.toMatchObject({
      code: ErrorCode.CLUB_ROLE_CANDIDATES_SECTION_NOT_SERVICE,
    });
  });

  it('groups candidates: available / with_role / not_enrolled and counts them', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const byId = new Map(result.items.map((i) => [i.user_id, i]));

    expect(byId.get(U_AVAILABLE)?.group).toBe('available');
    expect(byId.get(U_WITH_ROLE)?.group).toBe('with_role');
    expect(byId.get(U_HOLDER_HERE)?.group).toBe('with_role');
    // previous-year GM row only: not enrolled this year
    expect(byId.get(U_NOT_ENROLLED)?.group).toBe('not_enrolled');
    expect(byId.get(U_NOT_ENROLLED)?.gm_annual_status).toBe('none');
    expect(byId.get(U_WITH_ROLE)?.gm_annual_status).toBe('pending');
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 5,
      counts: { available: 2, with_role: 2, not_enrolled: 1 },
    });
  });

  it('keeps the exact contract keys for an item', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(Object.keys(item).sort()).toEqual(
      [
        'user_id',
        'name',
        'photo_url',
        'age',
        'gender',
        'group',
        'gm_annual_status',
        'guide_major',
        'current_roles',
        'service_years',
        'consent',
        'allowed_roles',
        'blocked_reason',
        'requirements',
      ].sort(),
    );
    expect(item.requirements).toEqual([
      {
        role: 'counselor',
        type: 'COUNSELOR_TRAINING',
        mode: 'INFO',
        status: 'MISSING',
        enforced: false,
      },
    ]);
    expect(Object.keys(item.requirements[0]).sort()).toEqual(
      ['role', 'type', 'mode', 'status', 'enforced'].sort(),
    );
    expect(item.guide_major).toEqual({
      basis: 'INVESTED',
      investiture_year: '2019',
      advanced: true,
      instructor: false,
    });
    expect(item.photo_url).toBeNull();
    expect(item.service_years).toBe(1);
    expect(item.consent).toBeNull();
    expect(Object.keys(result.section)).toEqual([
      'id',
      'club_type_id',
      'club_type_name',
      'has_gm_section',
      'year',
    ]);
    expect(result.section.has_gm_section).toBe(true);
    expect(result.section.year).toEqual({ id: 4, name: '2026' });
  });

  it('exposes current roles in other sections and still computes allowed_roles', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_WITH_ROLE)!;
    expect(item.current_roles).toEqual([
      {
        section_id: 165,
        club_type_id: 2,
        club_type_name: 'Conquistadores',
        role: 'counselor',
      },
    ]);
    // D4: a role in ANOTHER section does not block this one
    expect(item.blocked_reason).toBeNull();
    expect(item.allowed_roles).toContain('counselor');
  });

  it('not_enrolled people get no allowed roles (D1)', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_NOT_ENROLLED)!;
    expect(item.allowed_roles).toEqual([]);
    expect(item.blocked_reason).toBe(
      ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED,
    );
  });

  it('blocks a person already holding a service role in the target section', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_HOLDER_HERE)!;
    expect(item.allowed_roles).toEqual([]);
    expect(item.blocked_reason).toBe(ErrorCode.CLUB_ROLE_ALREADY_HELD);
  });

  it('blocks the caller himself', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, U_AVAILABLE, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).toEqual([]);
    expect(item.blocked_reason).toBe(ErrorCode.CLUB_ROLE_SELF_ASSIGNMENT);
  });

  it('blocks a minor without verified consent and reports the consent block', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_MINOR)!;
    expect(item.consent).toEqual({ required: true, verified: false });
    expect(item.allowed_roles).toEqual([]);
    expect(item.blocked_reason).toBe(ErrorCode.MR_CONSENT_NOT_VERIFIED);
  });

  it('lets a minor with verified consent receive roles', async () => {
    const { service } = build({
      consent: new Map([[U_MINOR, { verifiedAt: new Date() }]]),
    });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_MINOR)!;
    expect(item.consent).toEqual({ required: true, verified: true });
    expect(item.blocked_reason).toBeNull();
    expect(item.allowed_roles.length).toBeGreaterThan(0);
  });

  it('reports slots with holders (names only) and subtracts full ones from allowed_roles', async () => {
    const { service } = build({
      holders: [
        {
          user_id: 'x1',
          roles: { role_name: 'deputy-director' },
          users: { name: 'Ana', paternal_last_name: 'Ruiz' },
        },
        {
          user_id: 'x2',
          roles: { role_name: 'deputy-director' },
          users: { name: 'Luis', paternal_last_name: 'Gómez' },
        },
        {
          user_id: 'x3',
          roles: { role_name: 'secretary' },
          users: { name: 'Jorge', paternal_last_name: 'Pérez' },
        },
      ],
    });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const slot = (role: string) => result.slots.find((s) => s.role === role)!;
    expect(result.slots.map((s) => s.role)).toEqual([
      'deputy-director',
      'secretary',
      'treasurer',
      'secretary-treasurer',
      'counselor',
    ]);
    expect(slot('deputy-director')).toEqual({
      role: 'deputy-director',
      occupied: 2,
      max: 2,
      holders: ['Ana Ruiz', 'Luis Gómez'],
      blocked_by: [],
    });
    expect(slot('secretary-treasurer').blocked_by).toEqual(['secretary']);
    expect(slot('counselor').max).toBeNull();

    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).toEqual(['treasurer', 'counselor']);
  });

  it('never leaks email or phone, nor user ids in slot holders', async () => {
    const { service } = build();
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/email|phone|cellphone|mobile/i);
    for (const slot of result.slots) {
      for (const holder of slot.holders) expect(typeof holder).toBe('string');
    }
  });

  it('filters by group and paginates', async () => {
    const { service } = build();
    const filtered = await service.list(CLUB, SECTION, CALLER, {
      ...query,
      filter: 'with_role',
    });
    expect(filtered.items.map((i) => i.group)).toEqual([
      'with_role',
      'with_role',
    ]);
    expect(filtered.meta.total).toBe(2);
    // counts ignore the group filter
    expect(filtered.meta.counts).toEqual({
      available: 2,
      with_role: 2,
      not_enrolled: 1,
    });

    const page2 = await service.list(CLUB, SECTION, CALLER, {
      ...query,
      limit: 2,
      page: 2,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.meta).toMatchObject({ page: 2, limit: 2, total: 5 });
  });

  it('turns search tokens into AND-ed, wildcard-escaped name filters', async () => {
    const { service, craFindMany } = build();
    await service.list(CLUB, SECTION, CALLER, {
      ...query,
      search: 'lau 100%',
    });
    const gmCall = craFindMany.mock.calls.find(
      ([args]) => args.where.roles?.role_name === 'member',
    )!;
    const and = (gmCall[0].where as any).users.AND as any[];
    const tokenFilters = and.filter((f) => f.OR && f.OR[0]?.name);
    expect(tokenFilters).toHaveLength(2);
    expect(tokenFilters[0].OR[0].name).toEqual({
      contains: 'lau',
      mode: 'insensitive',
    });
    expect(tokenFilters[1].OR[0].name.contains).toBe('100\\%');
    // hidden dependents are excluded
    expect(JSON.stringify(and[0])).toContain('frozen_at');
    expect(JSON.stringify(and)).not.toMatch(/email/);
  });

  it('batches: one eligibility call and one users query regardless of size', async () => {
    const { service, evaluateMany, prisma } = build();
    await service.list(CLUB, SECTION, CALLER, query);
    expect(evaluateMany).toHaveBeenCalledTimes(1);
    expect(prisma.users.findMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.institutional_certificate_requests.findMany,
    ).toHaveBeenCalledTimes(1);
  });

  it('drops people who are not GM-eligible', async () => {
    const { service } = build({ eligible: [U_AVAILABLE] });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    expect(result.items.map((i) => i.user_id)).toEqual([U_AVAILABLE]);
  });
});

describe('ClubRoleCandidatesService requirements', () => {
  const blockCounselor = [
    {
      requirement_type: 'COUNSELOR_TRAINING',
      mode: 'BLOCK',
      effective_from: null,
      equivalent_certification_id: null,
      roles: { role_name: 'counselor' },
    },
  ];

  it('removes the role from allowed_roles only when enforced and not MET', async () => {
    const { service } = build({ requirements: blockCounselor });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).not.toContain('counselor');
    expect(item.allowed_roles).toContain('treasurer');
    expect(item.blocked_reason).toBeNull();
    expect(item.requirements[0]).toMatchObject({
      status: 'MISSING',
      enforced: true,
    });
  });

  it('keeps the role when the enforced requirement is MET', async () => {
    const { service } = build({
      requirements: blockCounselor,
      credentials: [
        {
          user_id: U_AVAILABLE,
          credential_type: 'COUNSELOR_TRAINING',
          status: 'APPROVED',
          expires_at: null,
        },
      ],
    });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).toContain('counselor');
    expect(item.requirements[0]).toMatchObject({
      status: 'MET',
      enforced: true,
    });
  });

  it.each(['INFO', 'WARN'])('%s never removes a role', async (mode) => {
    const { service } = build({
      requirements: [{ ...blockCounselor[0], mode }],
    });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).toContain('counselor');
    expect(item.requirements[0]).toMatchObject({ mode, enforced: false });
  });

  it('does not remove a role whose BLOCK starts in the future', async () => {
    const { service } = build({
      requirements: [
        { ...blockCounselor[0], effective_from: new Date('2999-01-01') },
      ],
    });
    const result = await service.list(CLUB, SECTION, CALLER, query);
    const item = result.items.find((i) => i.user_id === U_AVAILABLE)!;
    expect(item.allowed_roles).toContain('counselor');
    expect(item.requirements[0].enforced).toBe(false);
  });
});

describe('ClubRoleCandidatesService.detail', () => {
  it('adds credentials (no object key, newest first) to the detail', async () => {
    const { service } = build({
      gmRows: [
        { user_id: U_AVAILABLE, ecclesiastical_year_id: 4, status: 'active' },
      ],
      eligible: [U_AVAILABLE],
      users: [user(U_AVAILABLE, 'Laura')],
      detailCredentials: [
        {
          credential_type: 'COUNSELOR_TRAINING',
          status: 'APPROVED',
          completed_at: new Date('2025-08-01T00:00:00Z'),
          expires_at: null,
        },
      ],
    });
    const result = await service.detail(CLUB, SECTION, U_AVAILABLE, CALLER);
    expect(result.credentials).toEqual([
      {
        type: 'COUNSELOR_TRAINING',
        status: 'APPROVED',
        completed_at: '2025-08-01',
        expires_at: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/object_key|file_url/i);
    expect(result.requirements).toHaveLength(1);
  });

  it('404s (anti-probe) when the user is not a candidate of the section', async () => {
    const { service } = build({ gmRows: [] });
    await expect(
      service.detail(CLUB, SECTION, U_AVAILABLE, CALLER),
    ).rejects.toMatchObject({ code: ErrorCode.GUARD_ASSIGNMENT_NOT_FOUND });
  });

  it('adds history, certifications, insurance and honors count to the item', async () => {
    const { service } = build({
      gmRows: [
        { user_id: U_AVAILABLE, ecclesiastical_year_id: 4, status: 'active' },
      ],
      eligible: [U_AVAILABLE],
      users: [user(U_AVAILABLE, 'Laura')],
    });
    const result = await service.detail(CLUB, SECTION, U_AVAILABLE, CALLER);
    expect(result.user_id).toBe(U_AVAILABLE);
    expect(result.role_history).toEqual([
      {
        year_name: '2026',
        club_type_name: 'Conquistadores',
        role: 'secretary',
      },
    ]);
    expect(result.certifications).toEqual([
      {
        name: 'Primeros auxilios',
        status: 'CERTIFIED',
        certified_at: '2024-01-01T00:00:00.000Z',
      },
    ]);
    expect(result.insurance).toEqual({
      active: true,
      expires_at: '2099-01-01',
    });
    expect(result.honors_count).toBe(12);
    expect(JSON.stringify(result)).not.toMatch(/email|phone/i);
  });
});

describe('ClubsController role-candidates authorization metadata', () => {
  it.each(['listRoleCandidates', 'getRoleCandidate'] as const)(
    '%s requires club_roles:assign on the club_section',
    (method) => {
      const handler = ClubsController.prototype[method];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
        permissions: ['club_roles:assign'],
        mode: 'all',
      });
      expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
        type: 'club_section',
        idParam: 'sectionId',
      });
    },
  );

  it('wraps the list in { status, data, meta }', async () => {
    const list = jest.fn().mockResolvedValue({
      section: { id: 1 },
      slots: [],
      items: [],
      meta: { page: 1, limit: 20, total: 0, counts: {} },
    });
    const controller = new ClubsController(
      {} as never,
      {} as never,
      { list } as never,
    );
    const response = await controller.listRoleCandidates(
      CLUB,
      SECTION,
      { sub: CALLER },
      query,
    );
    expect(response).toEqual({
      status: 'success',
      data: { section: { id: 1 }, slots: [], items: [] },
      meta: { page: 1, limit: 20, total: 0, counts: {} },
    });
    expect(list).toHaveBeenCalledWith(CLUB, SECTION, CALLER, query);
  });
});
