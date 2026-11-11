import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubEnrollmentReviewService } from './club-enrollment-review.service';

const NOW = new Date('2026-11-11T15:00:00.000Z');
const ENROLLMENT = '11111111-1111-4111-8111-111111111111';
const REVIEWER = 'aaaaaaa1-0000-4000-8000-000000000001';
const DIRECTOR = 'dddddddd-0000-4000-8000-000000000001';
const SUBMITTER = 'eeeeeeee-0000-4000-8000-000000000002';
const DEPUTY = 'ffffffff-0000-4000-8000-000000000003';

const CHANNELS = [
  { role: 'director-lf', scope: { all: false, sectionIds: [], clubs: {} } },
];
const SECTIONS_WHERE = { clubs: { is: { local_field_id: 1 } } };

const person = (user_id: string, name: string) => ({
  user_id,
  name,
  paternal_last_name: 'Pérez',
  maternal_last_name: null,
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    club_enrollment_id: ENROLLMENT,
    club_section_id: 44,
    ecclesiastical_year_id: 7,
    status: 'pending_validation',
    address: 'Av. Central 1',
    meeting_days: 'Sábado',
    latitude: 19.4,
    longitude: -99.1,
    meeting_schedule: [{ day: 'Sábado', time: '09:00' }],
    souls_target: 12,
    fee: true,
    fee_amount: { toString: () => '25.50', valueOf: () => 25.5 },
    director_id: DIRECTOR,
    deputy_director_ids: [DEPUTY],
    created_by: SUBMITTER,
    created_at: new Date('2026-11-01T10:00:00.000Z'),
    submitted_at: new Date('2026-11-01T12:00:00.000Z'),
    modified_at: new Date('2026-11-02T10:00:00.000Z'),
    reviewed_by_id: null,
    reviewer_role: null,
    reviewed_at: null,
    decision_reason: null,
    club_section: {
      club_section_id: 44,
      club_type_id: 3,
      main_club_id: 9,
      club_types: { name: 'Conquistadores' },
      clubs: {
        club_id: 9,
        name: 'Club Águila',
        local_fields: { local_field_id: 1, name: 'Campo Centro' },
      },
    },
    ecclesiastical_year: {
      year_id: 7,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T00:00:00.000Z'),
    },
    creator: person(SUBMITTER, 'Sara'),
    director: person(DIRECTOR, 'Dora'),
    secretary: null,
    treasurer: null,
    secretary_treasurer: person('st-1', 'Tomás'),
    reviewer: null,
    ...overrides,
  };
}

function setup() {
  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    club_enrollments: {
      findUnique: jest.fn(),
      findMany: jest.fn(async () => [row()]),
      count: jest.fn(async () => 1),
      groupBy: jest.fn(async () => [
        { status: 'pending_validation', _count: { _all: 4 } },
        { status: 'active', _count: { _all: 6 } },
        { status: 'rejected', _count: { _all: 2 } },
      ]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    users: {
      findMany: jest.fn(async () => [person(DEPUTY, 'Dani')]),
    },
  };
  const scope = {
    resolveReviewerChannels: jest.fn(async () => CHANNELS),
    sectionsWhere: jest.fn(() => SECTIONS_WHERE),
    findReviewerRoleForSection: jest.fn(async () => 'director-lf'),
    holdsClubRoleInSection: jest.fn(async () => false),
  };
  const catalogs = {
    getCurrentEcclesiasticalYear: jest.fn(async () => ({
      ecclesiastical_year_id: 7,
    })),
  };
  const enrollments = {
    createAnnualFolderForEnrollmentIfTemplateExists: jest.fn(
      async () => undefined,
    ),
  };
  const audit = {
    write: jest.fn(async () => ({ auditLogId: BigInt(1), replayed: false })),
  };
  const notifications = { notifySafe: jest.fn(async () => undefined) };
  const service = new ClubEnrollmentReviewService(
    prisma as never,
    scope as never,
    catalogs as never,
    enrollments as never,
    audit as never,
    notifications as never,
    { now: () => NOW },
  );
  return {
    prisma,
    scope,
    catalogs,
    enrollments,
    audit,
    notifications,
    service,
  };
}

/** Pending enrollment on its way to a decision: found, then re-read with the review stamped. */
function decidable(
  ctx: ReturnType<typeof setup>,
  status = 'pending_validation',
  reviewed: Record<string, unknown> = {},
) {
  ctx.prisma.club_enrollments.findUnique
    .mockResolvedValueOnce({
      club_enrollment_id: ENROLLMENT,
      club_section_id: 44,
      ecclesiastical_year_id: 7,
      status,
      director_id: DIRECTOR,
      created_by: SUBMITTER,
      club_section: { main_club_id: 9 },
    })
    .mockResolvedValue(row({ status, ...reviewed }));
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException
      ? { code: error.code, status: error.getStatus() }
      : String(error);
  }
  return undefined;
}

describe('ClubEnrollmentReviewService.findQueue', () => {
  it('lists pending enrollments of the current year inside the scope, oldest first', async () => {
    const ctx = setup();
    const result = await ctx.service.findQueue(REVIEWER, {});

    expect(ctx.scope.resolveReviewerChannels).toHaveBeenCalledWith(
      REVIEWER,
      'club_enrollments:validate',
      expect.objectContaining({ includeUnionDivision: true }),
    );
    const args = ctx.prisma.club_enrollments.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      AND: [
        {
          AND: [
            { club_section: SECTIONS_WHERE },
            { ecclesiastical_year_id: 7 },
          ],
        },
        { status: 'pending_validation' },
      ],
    });
    expect(args.orderBy).toEqual([
      { submitted_at: { sort: 'asc', nulls: 'last' } },
      { created_at: 'asc' },
    ]);
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      counts: { pending: 4, approved: 6, rejected: 2 },
    });
  });

  it('counts cover the whole scope of the year without the status filter', async () => {
    const ctx = setup();
    await ctx.service.findQueue(REVIEWER, {
      status: 'rejected',
      club_type_id: 3,
    });
    const groupBy = ctx.prisma.club_enrollments.groupBy.mock.calls[0][0];
    expect(groupBy.by).toEqual(['status']);
    expect(JSON.stringify(groupBy.where)).not.toContain('"status"');
    expect(JSON.stringify(groupBy.where)).toContain('"club_type_id":3');
    expect(JSON.stringify(groupBy.where)).toContain(
      '"ecclesiastical_year_id":7',
    );
  });

  it('reviewed lists show the latest review first', async () => {
    const ctx = setup();
    await ctx.service.findQueue(REVIEWER, { status: 'active' });
    await ctx.service.findQueue(REVIEWER, { status: 'rejected' });
    for (const [args] of ctx.prisma.club_enrollments.findMany.mock.calls) {
      expect(args.orderBy).toEqual([
        { reviewed_at: 'desc' },
        { created_at: 'desc' },
      ]);
    }
  });

  it('an explicit year, local field and club type replace the defaults', async () => {
    const ctx = setup();
    await ctx.service.findQueue(REVIEWER, {
      ecclesiastical_year_id: 5,
      local_field_id: 2,
      club_type_id: 3,
    });
    expect(ctx.catalogs.getCurrentEcclesiasticalYear).not.toHaveBeenCalled();
    const { where } = ctx.prisma.club_enrollments.findMany.mock.calls[0][0];
    expect(where.AND[0].AND).toEqual([
      { club_section: SECTIONS_WHERE },
      { ecclesiastical_year_id: 5 },
      { club_section: { club_type_id: 3 } },
      { club_section: { clubs: { local_field_id: 2 } } },
    ]);
  });

  it('every search word must match, with LIKE wildcards escaped and no email', async () => {
    const ctx = setup();
    await ctx.service.findQueue(REVIEWER, { search: 'ac% centro' });
    const { where } = ctx.prisma.club_enrollments.findMany.mock.calls[0][0];
    const clauses = where.AND[0].AND.slice(2);
    expect(clauses).toHaveLength(2);
    expect(JSON.stringify(clauses[0])).toContain('ac\\\\%');
    expect(JSON.stringify(clauses)).not.toContain('email');
    expect(JSON.stringify(clauses[1])).toContain('centro');
  });

  it('paginates and clamps the page size', async () => {
    const ctx = setup();
    await ctx.service.findQueue(REVIEWER, { page: 3, limit: 500 });
    const args = ctx.prisma.club_enrollments.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.skip).toBe(200);
  });

  it('without a current year the year filter is dropped instead of failing', async () => {
    const ctx = setup();
    ctx.catalogs.getCurrentEcclesiasticalYear.mockResolvedValue(undefined);
    await ctx.service.findQueue(REVIEWER, {});
    const { where } = ctx.prisma.club_enrollments.findMany.mock.calls[0][0];
    expect(JSON.stringify(where)).not.toContain('ecclesiastical_year_id');
  });

  it('maps an item with full names only, deputies hydrated and the fee as a number', async () => {
    const ctx = setup();
    const { items } = await ctx.service.findQueue(REVIEWER, {});
    expect(ctx.prisma.users.findMany).toHaveBeenCalledWith({
      where: { user_id: { in: [DEPUTY] } },
      select: expect.not.objectContaining({ email: true }),
    });
    expect(items[0]).toEqual({
      enrollment_id: ENROLLMENT,
      status: 'pending_validation',
      ecclesiastical_year: { id: 7, name: '2026' },
      club: { id: 9, name: 'Club Águila' },
      section: { id: 44, club_type_id: 3, club_type_name: 'Conquistadores' },
      local_field: { id: 1, name: 'Campo Centro' },
      address: 'Av. Central 1',
      latitude: 19.4,
      longitude: -99.1,
      meeting_days: 'Sábado',
      meeting_schedule: [{ day: 'Sábado', time: '09:00' }],
      souls_target: 12,
      fee: true,
      fee_amount: 25.5,
      board: {
        director: { user_id: DIRECTOR, name: 'Dora Pérez' },
        deputies: [{ user_id: DEPUTY, name: 'Dani Pérez' }],
        secretary: null,
        treasurer: null,
        secretary_treasurer: { user_id: 'st-1', name: 'Tomás Pérez' },
      },
      submitted_by: { user_id: SUBMITTER, name: 'Sara Pérez' },
      created_at: '2026-11-01T10:00:00.000Z',
      submitted_at: '2026-11-01T12:00:00.000Z',
      modified_at: '2026-11-02T10:00:00.000Z',
      reviewed_by: null,
      reviewer_role: null,
      reviewed_at: null,
      decision_reason: null,
    });
    expect(JSON.stringify(items)).not.toMatch(/email|phone/);
  });

  it('shows who reviewed, with which role and why', async () => {
    const ctx = setup();
    ctx.prisma.club_enrollments.findMany.mockResolvedValue([
      row({
        status: 'rejected',
        reviewer: person(REVIEWER, 'Rita'),
        reviewer_role: 'director-lf',
        reviewed_at: NOW,
        decision_reason: 'Falta la dirección',
      }) as never,
    ]);
    const { items } = await ctx.service.findQueue(REVIEWER, {
      status: 'rejected',
    });
    expect(items[0]).toMatchObject({
      reviewed_by: { user_id: REVIEWER, name: 'Rita Pérez' },
      reviewer_role: 'director-lf',
      reviewed_at: NOW.toISOString(),
      decision_reason: 'Falta la dirección',
    });
  });
});

describe('ClubEnrollmentReviewService decisions', () => {
  it('approve stamps the review, audits, creates the folder and notifies director and submitter', async () => {
    const ctx = setup();
    decidable(ctx, 'pending_validation', {
      status: 'active',
      reviewed_at: NOW,
      reviewer_role: 'director-lf',
    });

    const item = await ctx.service.approve(REVIEWER, ENROLLMENT);

    expect(ctx.prisma.club_enrollments.updateMany).toHaveBeenCalledWith({
      where: {
        club_enrollment_id: ENROLLMENT,
        status: 'pending_validation',
      },
      data: {
        status: 'active',
        reviewed_by_id: REVIEWER,
        reviewer_role: 'director-lf',
        reviewed_at: NOW,
        decision_reason: null,
        modified_at: NOW,
      },
    });
    expect(ctx.audit.write).toHaveBeenCalledWith(
      ctx.prisma,
      expect.objectContaining({
        entityType: 'club_enrollments',
        entityId: ENROLLMENT,
        action: 'CLUB_ENROLLMENT_APPROVED',
        clubId: 9,
        actor: expect.objectContaining({
          userId: REVIEWER,
          roleName: 'director-lf',
        }),
        after: { status: 'active', reason: null },
        result: 'succeeded',
      }),
    );
    expect(
      ctx.enrollments.createAnnualFolderForEnrollmentIfTemplateExists,
    ).toHaveBeenCalledWith(ENROLLMENT);
    expect(item.status).toBe('active');

    const sent = ctx.notifications.notifySafe.mock.calls as unknown as Array<
      [string, string, string, Record<string, string>, string]
    >;
    expect(sent.map((call) => call[0]).sort()).toEqual(
      [DIRECTOR, SUBMITTER].sort(),
    );
    expect(sent[0][1]).toBe('Registro anual aprobado');
    expect(sent[0][2]).toContain('Club Águila');
    expect(sent[0][3]).toEqual({
      type: 'club_enrollment_reviewed',
      entity_id: ENROLLMENT,
      action: 'approved',
      club_section_id: '44',
    });
    expect(sent[0][4]).toBe('club-enrollments:reviewed');
  });

  it('reject needs a pending enrollment, stores the reason and tells why', async () => {
    const ctx = setup();
    decidable(ctx, 'pending_validation', {
      status: 'rejected',
      decision_reason: 'Falta la dirección',
      reviewer_role: 'director-lf',
      reviewed_at: NOW,
    });

    const item = await ctx.service.reject(REVIEWER, ENROLLMENT, {
      reason: '  Falta la dirección  ',
    });

    expect(ctx.prisma.club_enrollments.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'rejected',
          reviewed_by_id: REVIEWER,
          reviewer_role: 'director-lf',
          reviewed_at: NOW,
          decision_reason: 'Falta la dirección',
        }),
      }),
    );
    expect(ctx.audit.write).toHaveBeenCalledWith(
      ctx.prisma,
      expect.objectContaining({
        action: 'CLUB_ENROLLMENT_REJECTED',
        after: { status: 'rejected', reason: 'Falta la dirección' },
      }),
    );
    expect(
      ctx.enrollments.createAnnualFolderForEnrollmentIfTemplateExists,
    ).not.toHaveBeenCalled();
    expect(item.decision_reason).toBe('Falta la dirección');
    const [, title, body, data] = ctx.notifications.notifySafe.mock
      .calls[0] as unknown as [string, string, string, Record<string, string>];
    expect(title).toBe('Registro anual rechazado');
    expect(body).toContain('fue rechazado: Falta la dirección');
    expect(data.action).toBe('rejected');
  });

  it('a second rejection of the same enrollment (after a resubmit) writes a new audit key', async () => {
    const ctx = setup();
    decidable(ctx);
    await ctx.service.reject(REVIEWER, ENROLLMENT, { reason: 'Primera vez' });
    const first = (ctx.audit.write.mock.calls[0] as unknown[])[1] as {
      eventKey: string;
    };
    expect(first.eventKey).toContain(String(NOW.getTime()));
    expect(first.eventKey).toContain('rejected');
  });

  it('notifies once when director and submitter are the same person, and skips the reviewer', async () => {
    const ctx = setup();
    ctx.prisma.club_enrollments.findUnique
      .mockResolvedValueOnce({
        club_enrollment_id: ENROLLMENT,
        club_section_id: 44,
        ecclesiastical_year_id: 7,
        status: 'pending_validation',
        director_id: DIRECTOR,
        created_by: DIRECTOR,
        club_section: { main_club_id: 9 },
      })
      .mockResolvedValue(row({ status: 'active' }));
    await ctx.service.approve(REVIEWER, ENROLLMENT);
    expect(ctx.notifications.notifySafe).toHaveBeenCalledTimes(1);

    const other = setup();
    other.prisma.club_enrollments.findUnique
      .mockResolvedValueOnce({
        club_enrollment_id: ENROLLMENT,
        club_section_id: 44,
        ecclesiastical_year_id: 7,
        status: 'pending_validation',
        director_id: null,
        created_by: REVIEWER,
        club_section: { main_club_id: 9 },
      })
      .mockResolvedValue(row({ status: 'active' }));
    await other.service.approve(REVIEWER, ENROLLMENT);
    expect(other.notifications.notifySafe).not.toHaveBeenCalled();
  });

  it('approving an already approved enrollment is idempotent: no write, no folder, no notification', async () => {
    const ctx = setup();
    decidable(ctx, 'active');
    const item = await ctx.service.approve(REVIEWER, ENROLLMENT);
    expect(item.status).toBe('active');
    expect(ctx.prisma.club_enrollments.updateMany).not.toHaveBeenCalled();
    expect(ctx.audit.write).not.toHaveBeenCalled();
    expect(
      ctx.enrollments.createAnnualFolderForEnrollmentIfTemplateExists,
    ).not.toHaveBeenCalled();
    expect(ctx.notifications.notifySafe).not.toHaveBeenCalled();
  });

  it.each([
    ['approve', 'rejected'],
    ['approve', 'inactive'],
    ['reject', 'active'],
    ['reject', 'rejected'],
  ] as const)(
    '%s on a %s enrollment answers 409 CE_ENROLLMENT_NOT_PENDING',
    async (action, status) => {
      const ctx = setup();
      decidable(ctx, status);
      const result =
        action === 'approve'
          ? ctx.service.approve(REVIEWER, ENROLLMENT)
          : ctx.service.reject(REVIEWER, ENROLLMENT, {
              reason: 'Motivo claro',
            });
      expect(await failure(result)).toEqual({
        code: ErrorCode.CE_ENROLLMENT_NOT_PENDING,
        status: 409,
      });
      expect(ctx.prisma.club_enrollments.updateMany).not.toHaveBeenCalled();
      expect(ctx.notifications.notifySafe).not.toHaveBeenCalled();
    },
  );

  it('loses the race: someone else decided between the read and the write', async () => {
    const ctx = setup();
    decidable(ctx);
    ctx.prisma.club_enrollments.updateMany.mockResolvedValue({ count: 0 });
    expect(await failure(ctx.service.approve(REVIEWER, ENROLLMENT))).toEqual({
      code: ErrorCode.CE_ENROLLMENT_NOT_PENDING,
      status: 409,
    });
    expect(ctx.audit.write).not.toHaveBeenCalled();
    expect(ctx.notifications.notifySafe).not.toHaveBeenCalled();
  });

  it('an unknown enrollment answers 404', async () => {
    const ctx = setup();
    ctx.prisma.club_enrollments.findUnique.mockResolvedValue(null);
    expect(await failure(ctx.service.approve(REVIEWER, ENROLLMENT))).toEqual({
      code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
      status: 404,
    });
  });

  it('an enrollment outside the scope answers the same 404 and changes nothing', async () => {
    const ctx = setup();
    decidable(ctx);
    ctx.scope.findReviewerRoleForSection.mockResolvedValue(null);
    for (const call of [
      () => ctx.service.approve(REVIEWER, ENROLLMENT),
      () =>
        ctx.service.reject(REVIEWER, ENROLLMENT, { reason: 'Motivo claro' }),
    ]) {
      ctx.prisma.club_enrollments.findUnique.mockResolvedValueOnce({
        club_enrollment_id: ENROLLMENT,
        club_section_id: 44,
        ecclesiastical_year_id: 7,
        status: 'pending_validation',
        director_id: DIRECTOR,
        created_by: SUBMITTER,
        club_section: { main_club_id: 9 },
      });
      expect(await failure(call())).toEqual({
        code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
        status: 404,
      });
    }
    expect(ctx.prisma.club_enrollments.updateMany).not.toHaveBeenCalled();
  });

  it('a reviewer with a club role in that section and year cannot decide: 403 CE_SELF_REVIEW', async () => {
    const ctx = setup();
    decidable(ctx);
    ctx.scope.holdsClubRoleInSection.mockResolvedValue(true);
    expect(await failure(ctx.service.approve(REVIEWER, ENROLLMENT))).toEqual({
      code: ErrorCode.CE_SELF_REVIEW,
      status: 403,
    });
    expect(ctx.scope.holdsClubRoleInSection).toHaveBeenCalledWith(
      REVIEWER,
      44,
      7,
    );
    expect(ctx.prisma.club_enrollments.updateMany).not.toHaveBeenCalled();
    expect(ctx.notifications.notifySafe).not.toHaveBeenCalled();
  });

  it('self-review is judged after scope, so an out-of-scope id never reveals it', async () => {
    const ctx = setup();
    decidable(ctx);
    ctx.scope.findReviewerRoleForSection.mockResolvedValue(null);
    ctx.scope.holdsClubRoleInSection.mockResolvedValue(true);
    expect(
      await failure(
        ctx.service.reject(REVIEWER, ENROLLMENT, { reason: 'Motivo claro' }),
      ),
    ).toEqual({
      code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
      status: 404,
    });
    expect(ctx.scope.holdsClubRoleInSection).not.toHaveBeenCalled();
  });
});
