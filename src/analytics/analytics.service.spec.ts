import { AnalyticsService } from './analytics.service';

describe('AnalyticsService.getSlaDashboard — validation counts', () => {
  function build() {
    const prisma = {
      enrollments: { groupBy: jest.fn().mockResolvedValue([]) },
      class_section_progress: { count: jest.fn().mockResolvedValue(4) },
      users_honors: { count: jest.fn().mockResolvedValue(2) },
      camporee_clubs: { count: jest.fn().mockResolvedValue(0) },
      camporee_members: { count: jest.fn().mockResolvedValue(0) },
      camporee_payments: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ pending: 6, overdue: 0, avg_days: null }]),
    };
    const service = new AnalyticsService(prisma as never);
    const internals = service as unknown as Record<string, unknown>;
    internals.computeTimingMetrics = jest.fn().mockResolvedValue({});
    internals.computeThroughput = jest.fn().mockResolvedValue([]);
    internals.computeApprovalRate = jest
      .fn()
      .mockResolvedValue({ resolved: 0, approved: 0, rate: 0 });
    internals.countOverdue = jest.fn().mockResolvedValue(0);
    return { service, prisma };
  }

  it('counts the same SUBMITTED / PENDING_REVIEW items as the evidence review queue', async () => {
    const { service, prisma } = build();

    const result = await service.getSlaDashboard([12]);

    expect(result.validation).toEqual({
      class_sections_pending: 4,
      honors_pending: 2,
      total_pending: 6,
    });

    const scope = {
      users: {
        club_role_assignments: {
          some: {
            club_section_id: { in: [12] },
            active: true,
            status: 'active',
          },
        },
      },
    };
    expect(prisma.class_section_progress.count).toHaveBeenCalledWith({
      where: {
        status: 'SUBMITTED',
        active: true,
        submitted_at: { not: null },
        ...scope,
      },
    });
    expect(prisma.users_honors.count).toHaveBeenCalledWith({
      where: {
        validation_status: 'PENDING_REVIEW',
        active: true,
        submitted_at: { not: null },
        ...scope,
      },
    });
  });

  it('does not scope the counts for a global (admin) view', async () => {
    const { service, prisma } = build();

    await service.getSlaDashboard(undefined);

    expect(prisma.class_section_progress.count).toHaveBeenCalledWith({
      where: {
        status: 'SUBMITTED',
        active: true,
        submitted_at: { not: null },
      },
    });
  });
});

describe('AnalyticsService.getSlaDashboard — evidence SLA', () => {
  const NOW = new Date('2026-10-23T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;

  function build(rows: unknown[]) {
    const prisma = {
      enrollments: { groupBy: jest.fn().mockResolvedValue([]) },
      class_section_progress: { count: jest.fn().mockResolvedValue(2) },
      users_honors: { count: jest.fn().mockResolvedValue(4) },
      camporee_clubs: { count: jest.fn().mockResolvedValue(0) },
      camporee_members: { count: jest.fn().mockResolvedValue(0) },
      camporee_payments: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue(rows),
    };
    const service = new AnalyticsService(prisma as never);
    const internals = service as unknown as Record<string, unknown>;
    internals.computeTimingMetrics = jest.fn().mockResolvedValue({});
    internals.computeThroughput = jest.fn().mockResolvedValue([]);
    internals.computeApprovalRate = jest
      .fn()
      .mockResolvedValue({ resolved: 0, approved: 0, rate: 0 });
    internals.countOverdue = jest.fn().mockResolvedValue(0);
    return { service, prisma };
  }

  /** Flattens the tagged-template call into SQL text + bound values. */
  function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
    const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
    const flat: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === 'object' && 'values' in value) {
        (value as { values: unknown[] }).values.forEach(walk);
      } else {
        flat.push(value);
      }
    };
    values.forEach(walk);
    const text = strings
      .map((part, i) => {
        const value = values[i];
        const nested =
          value && typeof value === 'object' && 'strings' in value
            ? (value as { strings: string[] }).strings.join('?')
            : '';
        return part + nested;
      })
      .join('');
    return { text, values: flat };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns overdue and average age of the pending evidence queue', async () => {
    // Coordinator QA case: 6 pending, three of them 48, 101 and 128 days old.
    const { service } = build([
      { pending: 6, overdue: 3, avg_days: '46.18333333333333' },
    ]);

    const result = await service.getSlaDashboard([12]);

    expect(result.evidence).toEqual({
      pending: 6,
      overdue: 3,
      avg_days: 46.2,
      overdue_threshold_days: 7,
    });
  });

  it('flags as overdue what was submitted 7 or more days ago, scoped to the coordinator', async () => {
    const { service, prisma } = build([
      { pending: 0, overdue: 0, avg_days: null },
    ]);

    await service.getSlaDashboard([12, 30]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(text).toContain("csp.status = 'SUBMITTED'");
    expect(text).toContain("uh.validation_status = 'PENDING_REVIEW'");
    expect(text).toContain("cra.status = 'active'");
    expect(text).toContain('submitted_at <=');
    expect(values).toEqual(
      expect.arrayContaining([
        new Date(NOW.getTime() - 7 * DAY_MS),
        NOW,
        12,
        30,
      ]),
    );
  });

  it('does not scope the evidence query for a global (admin) view', async () => {
    const { service, prisma } = build([
      { pending: 1, overdue: 0, avg_days: 2 },
    ]);

    await service.getSlaDashboard(undefined);

    const { text } = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(text).not.toContain('club_role_assignments');
  });

  it('returns an empty evidence SLA without querying when the scope is empty', async () => {
    const { service, prisma } = build([]);

    const result = await service.getSlaDashboard([]);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(result.evidence).toEqual({
      pending: 0,
      overdue: 0,
      avg_days: null,
      overdue_threshold_days: 7,
    });
  });

  it('returns null average when nothing is pending', async () => {
    const { service } = build([{ pending: 0, overdue: 0, avg_days: null }]);

    const result = await service.getSlaDashboard([5]);

    expect(result.evidence.avg_days).toBeNull();
    expect(result.evidence.overdue).toBe(0);
  });
});
