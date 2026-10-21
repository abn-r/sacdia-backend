import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../../common/errors/error-codes';
import { CronRunLogger } from '../../common/services/cron-run-logger.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { MembershipRequestsCronService } from '../../membership-requests/membership-requests-cron.service';
import { MembershipRequestsService } from '../../membership-requests/membership-requests.service';
import { MonthlyReportsCronService } from '../../monthly-reports/monthly-reports-cron.service';
import { MonthlyReportsService } from '../../monthly-reports/monthly-reports.service';
import { BACKGROUND_JOBS_QUEUE } from '../../background-jobs/background-jobs.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CRON_JOB_DEFINITIONS } from './cron-job.registry';
import { AdminCronJobsService } from './admin-cron-jobs.service';

const EXPIRY_JOB = 'membership-requests-expiry';
const EXPIRY_LOCK = 'lock:cron:membership-requests-expiry';

describe('AdminCronJobsService', () => {
  const store = new Map<string, string>();
  const cache = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
  const prisma = {
    cron_run_log: { create: jest.fn(), update: jest.fn() },
  };
  const membershipRequests = { expireStaleRequests: jest.fn() };
  const monthlyReports = { runAutoGeneration: jest.fn() };
  const queue = { add: jest.fn() };
  const auditLogs = { recordEvent: jest.fn() };

  let testingModule: TestingModule;
  let service: AdminCronJobsService;
  let runId: number;

  beforeEach(async () => {
    jest.clearAllMocks();
    store.clear();
    runId = 40;
    prisma.cron_run_log.create.mockImplementation(() =>
      Promise.resolve({ run_id: ++runId }),
    );
    prisma.cron_run_log.update.mockResolvedValue({});
    membershipRequests.expireStaleRequests.mockResolvedValue(3);
    auditLogs.recordEvent.mockResolvedValue(undefined);
    queue.add.mockResolvedValue({});

    testingModule = await Test.createTestingModule({
      providers: [
        AdminCronJobsService,
        DistributedLockService,
        CronRunLogger,
        MembershipRequestsCronService,
        MonthlyReportsCronService,
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
        { provide: MembershipRequestsService, useValue: membershipRequests },
        { provide: MonthlyReportsService, useValue: monthlyReports },
        { provide: getQueueToken(BACKGROUND_JOBS_QUEUE), useValue: queue },
      ],
    }).compile();

    service = testingModule.get(AdminCronJobsService);
  });

  describe('list', () => {
    it('returns the whole allowlist with each job schedule', () => {
      const jobs = service.list();

      expect(jobs).toHaveLength(CRON_JOB_DEFINITIONS.length);
      expect(jobs.find((j) => j.job_name === EXPIRY_JOB)).toEqual({
        job_name: EXPIRY_JOB,
        schedule: '3 * * * *',
        time_zone: 'UTC',
        runnable: true,
        description: expect.any(String),
      });
    });

    it('flags as not runnable a job whose provider is not in the running app', () => {
      const jobs = service.list();

      // Only two cron providers exist in this test module.
      expect(
        jobs
          .filter((j) => j.runnable)
          .map((j) => j.job_name)
          .sort(),
      ).toEqual([
        'membership-requests-expiry',
        'monthly-reports-auto-generate',
      ]);
      expect(
        jobs.find((j) => j.job_name === 'ecclesiastical-year-cut'),
      ).toMatchObject({ runnable: false });
    });
  });

  describe('run: guard rails', () => {
    it('rejects a job that is not in the allowlist with CRON_JOB_NOT_FOUND', async () => {
      await expect(
        service.run('drop-database', 'admin-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.CRON_JOB_NOT_FOUND,
        status: 404,
      });
      expect(prisma.cron_run_log.create).not.toHaveBeenCalled();
      expect(auditLogs.recordEvent).not.toHaveBeenCalled();
    });

    it('rejects Object.prototype names instead of invoking them', async () => {
      await expect(service.run('constructor', 'admin-1')).rejects.toMatchObject(
        {
          code: ErrorCode.CRON_JOB_NOT_FOUND,
        },
      );
      await expect(service.run('__proto__', 'admin-1')).rejects.toMatchObject({
        code: ErrorCode.CRON_JOB_NOT_FOUND,
      });
    });

    it('rejects an allowlisted job whose provider is not running as CRON_JOB_NOT_FOUND', async () => {
      await expect(
        service.run('ecclesiastical-year-cut', 'admin-1'),
      ).rejects.toMatchObject({ code: ErrorCode.CRON_JOB_NOT_FOUND });
    });
  });

  describe('run: through the real @Cron handler', () => {
    it('invokes the handler with its own lock and logs a completed manual run', async () => {
      const result = await service.run(EXPIRY_JOB, 'admin-1');

      expect(membershipRequests.expireStaleRequests).toHaveBeenCalledTimes(1);
      // The handler took (and released) ITS lock: same path as the scheduler.
      expect(cache.set).toHaveBeenCalledWith(
        EXPIRY_LOCK,
        expect.any(String),
        55 * 60 * 1000,
      );
      expect(cache.del).toHaveBeenCalledWith(EXPIRY_LOCK);
      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          job_name: EXPIRY_JOB,
          status: 'running',
          metadata: { trigger: 'manual', triggered_by: 'admin-1' },
        }),
      });
      expect(result).toEqual({
        job_name: EXPIRY_JOB,
        run_id: 41,
        status: 'completed',
        items_processed: 3,
        duration_ms: expect.any(Number),
        error_message: null,
        enqueued: false,
      });
    });

    it('does not mark scheduled runs of the same handler as manual', async () => {
      const handler = testingModule.get(MembershipRequestsCronService);

      await handler.handleExpiry();

      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ job_name: EXPIRY_JOB }),
      });
      const metadata = (
        prisma.cron_run_log.create.mock.calls[0][0] as {
          data: { metadata: unknown };
        }
      ).data.metadata;
      expect(JSON.stringify(metadata)).not.toContain('manual');
    });

    it('returns skipped (and records it) when the job lock is already held', async () => {
      store.set(EXPIRY_LOCK, 'held-by-another-instance');

      const result = await service.run(EXPIRY_JOB, 'admin-1');

      expect(membershipRequests.expireStaleRequests).not.toHaveBeenCalled();
      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'skipped',
          metadata: {
            reason: 'lock_not_acquired',
            trigger: 'manual',
            triggered_by: 'admin-1',
          },
        }),
      });
      expect(result).toMatchObject({
        job_name: EXPIRY_JOB,
        run_id: 41,
        status: 'skipped',
        items_processed: null,
        error_message: null,
      });
      // The foreign lock is not ours to release.
      expect(store.get(EXPIRY_LOCK)).toBe('held-by-another-instance');
    });

    it('returns failed with the error message when the run fails', async () => {
      membershipRequests.expireStaleRequests.mockRejectedValue(
        new Error('db down'),
      );

      const result = await service.run(EXPIRY_JOB, 'admin-1');

      expect(result).toEqual({
        job_name: EXPIRY_JOB,
        run_id: 41,
        status: 'failed',
        items_processed: null,
        duration_ms: expect.any(Number),
        error_message: 'db down',
        enqueued: false,
      });
    });

    it('never runs the same job twice at once', async () => {
      let release!: () => void;
      membershipRequests.expireStaleRequests.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            release = () => resolve(1);
          }),
      );

      const first = service.run(EXPIRY_JOB, 'admin-1');
      await new Promise((resolve) => setImmediate(resolve));

      const second = await service.run(EXPIRY_JOB, 'admin-2');
      release();
      const firstResult = await first;

      expect(second).toMatchObject({
        status: 'skipped',
        run_id: expect.any(Number),
      });
      expect(membershipRequests.expireStaleRequests).toHaveBeenCalledTimes(1);
      expect(firstResult.status).toBe('completed');
      expect(prisma.cron_run_log.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'skipped',
          metadata: {
            reason: 'manual_run_in_progress',
            trigger: 'manual',
            triggered_by: 'admin-2',
          },
        }),
      });
    });

    it('releases the manual lock afterwards so the job can be run again', async () => {
      await service.run(EXPIRY_JOB, 'admin-1');
      const again = await service.run(EXPIRY_JOB, 'admin-1');

      expect(again.status).toBe('completed');
      expect(membershipRequests.expireStaleRequests).toHaveBeenCalledTimes(2);
    });
  });

  describe('run: queue-backed job', () => {
    it('reports enqueued when the handler hands the work to BullMQ, carrying the trigger', async () => {
      const result = await service.run(
        'monthly-reports-auto-generate',
        'admin-1',
      );

      expect(queue.add).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ manualTriggeredBy: 'admin-1' }),
        expect.any(Object),
      );
      expect(result).toEqual({
        job_name: 'monthly-reports-auto-generate',
        run_id: null,
        status: 'completed',
        items_processed: null,
        duration_ms: expect.any(Number),
        error_message: null,
        enqueued: true,
      });
    });

    it('reports failed (not enqueued) when the enqueue itself fails', async () => {
      queue.add.mockRejectedValue(new Error('redis connection lost'));

      const result = await service.run(
        'monthly-reports-auto-generate',
        'admin-1',
      );

      expect(result).toEqual({
        job_name: 'monthly-reports-auto-generate',
        run_id: null,
        status: 'failed',
        items_processed: null,
        duration_ms: expect.any(Number),
        error_message: 'redis connection lost',
        enqueued: false,
      });
      expect(auditLogs.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ result: 'failed' }),
      );
    });

    it('keeps swallowing the enqueue failure on a scheduled tick (the next tick retries)', async () => {
      queue.add.mockRejectedValue(new Error('redis connection lost'));
      const cron = testingModule.get(MonthlyReportsCronService);

      await expect(cron.handleAutoGenerate()).resolves.toBeUndefined();
    });
  });

  describe('run: audit', () => {
    it('writes the admin.cron_job.run row with the job and its result', async () => {
      await service.run(EXPIRY_JOB, 'admin-1');

      expect(auditLogs.recordEvent).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordEvent).toHaveBeenCalledWith({
        entity_type: 'cron_job',
        entity_id: EXPIRY_JOB,
        action: 'admin.cron_job.run',
        actor_user_id: 'admin-1',
        actor_kind: 'user',
        result: 'succeeded',
        summary: expect.stringContaining(EXPIRY_JOB),
        changes: {
          job_name: EXPIRY_JOB,
          status: 'completed',
          run_id: 41,
          items_processed: 3,
          duration_ms: expect.any(Number),
          error_message: null,
        },
      });
    });

    it('audits a failed run as failed', async () => {
      membershipRequests.expireStaleRequests.mockRejectedValue(
        new Error('db down'),
      );

      await service.run(EXPIRY_JOB, 'admin-1');

      expect(auditLogs.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.cron_job.run',
          result: 'failed',
          changes: expect.objectContaining({
            status: 'failed',
            error_message: 'db down',
          }),
        }),
      );
    });

    it('audits a skipped run as succeeded-with-skipped status', async () => {
      store.set(EXPIRY_LOCK, 'held');

      await service.run(EXPIRY_JOB, 'admin-1');

      expect(auditLogs.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'succeeded',
          changes: expect.objectContaining({ status: 'skipped' }),
        }),
      );
    });
  });
});
