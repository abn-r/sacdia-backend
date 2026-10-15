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
