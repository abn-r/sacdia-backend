import { JobsOverviewService } from './jobs-overview.service';

function queueWith(failed: unknown[]) {
  return {
    getJobCounts: jest.fn().mockResolvedValue({}),
    getFailed: jest.fn().mockResolvedValue(failed),
  };
}

describe('JobsOverviewService.getOverview', () => {
  it('sanitizes failed_reason at the API boundary', async () => {
    const raw =
      'Invalid `prisma.users.findMany()` invocation in\n/Users/x/src/notifications.processor.ts:940:30\n\n→ 940 await x\nUnknown argument `foo`.';
    const notifications = queueWith([
      {
        id: '1',
        name: 'send',
        failedReason: raw,
        attemptsMade: 3,
        finishedOn: 1700000000000,
      },
      { id: '2', name: 'n', attemptsMade: 1, finishedOn: 1600000000000 },
    ]);
    const empty = queueWith([]);
    const svc = new JobsOverviewService(
      notifications as never,
      empty as never,
      empty as never,
      empty as never,
    );

    const { recent_failed } = await svc.getOverview();

    expect(recent_failed).toHaveLength(2);
    expect(recent_failed[0].failed_reason).toContain('Unknown argument');
    expect(recent_failed[0].failed_reason).not.toMatch(/\/Users|\.ts|940/);
    expect(recent_failed[1].failed_reason).toBeNull();
  });
});
