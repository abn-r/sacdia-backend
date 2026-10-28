import { TestingClock } from '../clock/testing-clock';
import { TemporalContextFactory } from '../clock/temporal-context.factory';
import { ZonedBusinessTimeService } from '../clock/zoned-business-time.service';
import { ClubAssignmentEffectivityPolicy } from './club-assignment-effectivity.policy';
import { MemberTerritoryScopeService } from './member-territory-scope.service';

const NOW = new Date('2026-10-28T12:00:00.000Z');

function build(options: {
  user?: { local_field_id: number | null } | null;
  assignments?: unknown[];
  localFields?: Array<{ local_field_id: number }>;
  timezone?: string | null;
}) {
  const zoned = new ZonedBusinessTimeService();
  const prisma = {
    users: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.user === undefined ? { local_field_id: null } : options.user,
        ),
    },
    club_role_assignments: {
      findMany: jest.fn().mockResolvedValue(options.assignments ?? []),
    },
    local_fields: {
      findUnique: jest.fn().mockResolvedValue({
        local_field_id: 5,
        active: true,
        timezone:
          options.timezone === undefined
            ? 'America/Mexico_City'
            : options.timezone,
      }),
      findFirst: jest.fn().mockResolvedValue(options.localFields?.[0] ?? null),
    },
  };
  const service = new MemberTerritoryScopeService(
    prisma as never,
    new ClubAssignmentEffectivityPolicy(zoned),
    new TemporalContextFactory(new TestingClock(NOW), zoned),
  );
  return { service, prisma };
}

const assignment = (
  overrides: Partial<{
    active: boolean;
    status: string;
    start_date: string;
    end_date: string | null;
    expires_at: Date | null;
    lf: number;
    timezone: string | null;
  }> = {},
) => ({
  active: overrides.active ?? true,
  status: overrides.status ?? 'active',
  start_date: overrides.start_date ?? '2026-01-01',
  end_date: overrides.end_date ?? null,
  expires_at: overrides.expires_at ?? null,
  club_sections: {
    clubs: {
      local_fields: {
        local_field_id: overrides.lf ?? 7,
        timezone:
          overrides.timezone === undefined
            ? 'America/Mexico_City'
            : overrides.timezone,
      },
    },
  },
});

describe('MemberTerritoryScopeService', () => {
  it('builds the predicate from the canonical policy using the field business date', async () => {
    const { service } = build({});

    const where = await service.effectiveAssignmentForLocalField(5);

    expect(where).toMatchObject({
      active: true,
      status: 'active',
      start_date: { lte: new Date('2026-10-28T00:00:00.000Z') },
    });
  });

  it('union/division use the lowest-id field of the territory; none means match nothing', async () => {
    const found = build({ localFields: [{ local_field_id: 5 }] });
    await expect(
      found.service.effectiveAssignmentForScope({ level: 'union', unionId: 2 }),
    ).resolves.toMatchObject({ status: 'active' });
    expect(found.prisma.local_fields.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { union_id: 2 },
        orderBy: { local_field_id: 'asc' },
      }),
    );

    const none = build({});
    await expect(
      none.service.effectiveAssignmentForScope({
        level: 'division',
        divisionId: 1,
      }),
    ).resolves.toEqual({ assignment_id: { in: [] } });
  });

  it('counts the field of an active, in-date club role when users.local_field_id is NULL', async () => {
    const { service } = build({ assignments: [assignment({ lf: 7 })] });

    await expect(service.resolveMemberLocalFieldIds('u-1')).resolves.toEqual([
      7,
    ]);
  });

  it.each([
    ['designated', { status: 'designated' }],
    ['pending', { status: 'pending' }],
    ['rejected', { status: 'rejected' }],
    ['inactive', { active: false }],
    ['ended (end_date in the past)', { end_date: '2026-10-01' }],
    ['expired', { expires_at: new Date('2026-10-28T11:00:00.000Z') }],
    ['not started yet', { start_date: '2026-12-01' }],
  ])('does NOT count a %s assignment', async (_label, overrides) => {
    const { service } = build({ assignments: [assignment(overrides)] });

    await expect(service.resolveMemberLocalFieldIds('u-1')).resolves.toEqual(
      [],
    );
  });

  it('merges the own-row field with effective club fields, deduped, and returns [] for an unknown user', async () => {
    const { service } = build({
      user: { local_field_id: 5 },
      assignments: [
        assignment({ lf: 5 }),
        assignment({ lf: 8 }),
        assignment({ lf: 9, status: 'pending' }),
      ],
    });
    await expect(service.resolveMemberLocalFieldIds('u-1')).resolves.toEqual([
      5, 8,
    ]);

    const unknown = build({ user: null });
    await expect(
      unknown.service.resolveMemberLocalFieldIds('x'),
    ).resolves.toEqual([]);
  });

  it('memberInLocalFieldsWhere ORs several fields, each with its own predicate', async () => {
    const { service } = build({});

    const single = await service.memberInLocalFieldsWhere([5]);
    expect(single).toHaveProperty('OR');
    const many = await service.memberInLocalFieldsWhere([5, 8]);
    expect(many.OR).toHaveLength(2);
  });

  it.each([
    ['missing', null],
    ['invalid', 'Not/AZone'],
  ])(
    'a field with a %s timezone fails closed: the club path matches nothing, no throw',
    async (_label, timezone) => {
      const { service } = build({ timezone });

      await expect(
        service.effectiveAssignmentForLocalField(5),
      ).resolves.toEqual({ assignment_id: { in: [] } });
    },
  );

  it('an unknown local field fails closed instead of throwing', async () => {
    const { service, prisma } = build({});
    prisma.local_fields.findUnique.mockResolvedValue(null);

    await expect(service.effectiveAssignmentForLocalField(99)).resolves.toEqual(
      { assignment_id: { in: [] } },
    );
  });

  it('skips a club role whose field has no valid timezone, keeping the others', async () => {
    const { service } = build({
      assignments: [
        assignment({ lf: 7, timezone: null }),
        assignment({ lf: 8 }),
      ],
    });

    await expect(service.resolveMemberLocalFieldIds('u-1')).resolves.toEqual([
      8,
    ]);
  });
});
