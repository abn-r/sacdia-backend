import type { PrismaService } from '../prisma/prisma.service';
import { CronRunsService } from './cron-runs.service';

describe('CronRunsService.getSummary: how each recent run was triggered', () => {
  const queryRaw = jest.fn();
  let service: CronRunsService;

  const row = (overrides: Record<string, unknown>) => ({
    job_name: 'job-a',
    run_id: 1,
    started_at: new Date('2026-10-21T10:00:00Z'),
    ended_at: new Date('2026-10-21T10:00:01Z'),
    status: 'completed',
    duration_ms: 1000,
    items_processed: 2,
    error_message: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CronRunsService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService);
  });

  it('marks a manual run and exposes who triggered it', async () => {
    queryRaw
      .mockResolvedValueOnce([
        row({ run_id: 5, trigger: 'manual', triggered_by: 'admin-1' }),
      ])
      .mockResolvedValueOnce([]);

    const { recent } = await service.getSummary();

    expect(recent).toEqual([
      expect.objectContaining({
        run_id: 5,
        trigger: 'manual',
        triggered_by: 'admin-1',
      }),
    ]);
  });

  it('reports a run without trigger metadata as scheduled with no actor', async () => {
    queryRaw
      .mockResolvedValueOnce([
        row({ run_id: 6, trigger: null, triggered_by: null }),
        row({ job_name: 'job-b', run_id: 7 }),
      ])
      .mockResolvedValueOnce([]);

    const { recent } = await service.getSummary();

    expect(recent).toEqual([
      expect.objectContaining({
        run_id: 6,
        trigger: 'scheduled',
        triggered_by: null,
      }),
      expect.objectContaining({
        run_id: 7,
        trigger: 'scheduled',
        triggered_by: null,
      }),
    ]);
  });

  it('treats any trigger value other than manual as scheduled', async () => {
    queryRaw
      .mockResolvedValueOnce([
        row({ trigger: 'something-else', triggered_by: 'x' }),
      ])
      .mockResolvedValueOnce([]);

    const { recent } = await service.getSummary();

    expect(recent[0]).toMatchObject({
      trigger: 'scheduled',
      triggered_by: null,
    });
  });

  it('reads the trigger from cron_run_log.metadata in the recent-runs query', async () => {
    queryRaw.mockResolvedValue([]);

    await service.getSummary();

    const sql = (queryRaw.mock.calls[0][0] as string[]).join(' ');
    expect(sql).toContain("metadata->>'trigger'");
    expect(sql).toContain("metadata->>'triggered_by'");
  });

  it('keeps the per-job stats untouched', async () => {
    const stats = [{ job_name: 'job-a', total_runs_7d: 4 }];
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(stats);

    const result = await service.getSummary();

    expect(result.stats).toBe(stats);
  });
});
