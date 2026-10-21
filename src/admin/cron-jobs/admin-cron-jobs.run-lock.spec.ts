import type { Type } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { CleanupService } from '../../common/services/cleanup.service';
import { CronAlertService } from '../../common/services/cron-alert.service';
import { buildCronRunLockHarness } from '../../common/services/cron-run-lock.testing';
import { DataExportService } from '../../data-export/data-export.service';
import { InvestitureAchievementIntentReconciler } from '../../investiture-requests/investiture-achievement-intent.reconciler';
import { MemberOfMonthCronService } from '../../member-of-month/member-of-month-cron.service';
import { FcmTokensService } from '../../notifications/fcm-tokens.service';
import { AdminCronJobsService } from './admin-cron-jobs.service';
import { findCronJob } from './cron-job.registry';

/**
 * The jobs that take no lock of their own share ONE lock (`cron-run:<job>`)
 * between the `@Cron` tick and the manual run. Each case builds the real
 * handler; `work` is the first thing the handler does once it holds the lock,
 * so a skip is proven by `work` never being called.
 */
interface JobCase {
  jobName: string;
  /** the job writes cron_run_log rows (a skipped tick leaves a row) */
  logsRuns: boolean;
  build: (h: ReturnType<typeof buildCronRunLockHarness>) => {
    instance: object;
    method: string;
    work: jest.Mock;
  };
}

const passThroughLogger = {
  track: jest.fn((_job: string, fn: () => Promise<unknown>) => fn()),
};

const cases: JobCase[] = [
  {
    jobName: 'cleanup-expired-records',
    logsRuns: true,
    build: (h) => {
      const work = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        session: { deleteMany: work },
        verification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      return {
        instance: new CleanupService(
          prisma as never,
          passThroughLogger as never,
          h.runLock,
        ),
        method: 'cleanupExpiredRecords',
        work,
      };
    },
  },
  {
    jobName: 'fcm-tokens-cleanup',
    logsRuns: true,
    build: (h) => {
      const work = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = { user_fcm_tokens: { deleteMany: work } };
      return {
        instance: new CleanupService(
          prisma as never,
          passThroughLogger as never,
          h.runLock,
        ),
        method: 'cleanupInactiveFcmTokens',
        work,
      };
    },
  },
  {
    jobName: 'cron-alert-check',
    logsRuns: false,
    build: (h) => {
      const work = jest.fn().mockResolvedValue([]);
      return {
        instance: new CronAlertService(
          { $queryRaw: work } as never,
          {} as never,
          null,
          h.runLock,
        ),
        method: 'checkAndAlertFailures',
        work,
      };
    },
  },
  {
    jobName: 'data-export-cleanup',
    logsRuns: true,
    build: (h) => {
      const work = jest.fn().mockResolvedValue([]);
      const prisma = {
        data_export_requests: {
          findMany: work,
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return {
        instance: new DataExportService(
          prisma as never,
          {} as never,
          undefined as never,
          passThroughLogger as never,
          {} as never,
          h.runLock,
        ),
        method: 'cleanupExpiredExports',
        work,
      };
    },
  },
  {
    jobName: 'member-of-month-auto-evaluate',
    logsRuns: true,
    build: (h) => {
      const work = jest.fn().mockResolvedValue([]);
      return {
        instance: new MemberOfMonthCronService(
          { club_sections: { findMany: work } } as never,
          {} as never,
          passThroughLogger as never,
          h.runLock,
        ),
        method: 'handleAutoEvaluate',
        work,
      };
    },
  },
  {
    jobName: 'fcm-tokens-stale-cleanup',
    logsRuns: false,
    build: (h) => {
      const work = jest.fn().mockResolvedValue({ count: 0 });
      return {
        instance: new FcmTokensService(
          { user_fcm_tokens: { deleteMany: work } } as never,
          h.runLock,
        ),
        method: 'cleanupOldTokens',
        work,
      };
    },
  },
  {
    jobName: 'investiture-achievement-intent',
    logsRuns: false,
    build: (h) => {
      const work = jest.fn().mockResolvedValue(0);
      return {
        instance: new InvestitureAchievementIntentReconciler(
          { reconcileConfirmedAchievementIntents: work } as never,
          h.runLock,
        ),
        method: 'reconcile',
        work,
      };
    },
  },
];

const tick = (instance: object, method: string): Promise<unknown> =>
  (instance as Record<string, () => Promise<unknown>>)[method]();

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe.each(cases)('run lock of $jobName', (jobCase) => {
  let h: ReturnType<typeof buildCronRunLockHarness>;
  let built: ReturnType<JobCase['build']>;
  let admin: AdminCronJobsService;
  const auditLogs = { recordEvent: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    h = buildCronRunLockHarness();
    built = jobCase.build(h);
    const moduleRef = {
      get: (target: Type<unknown>) => {
        if (built.instance instanceof target) return built.instance;
        throw new Error('not found');
      },
    } as unknown as ModuleRef;
    admin = new AdminCronJobsService(moduleRef, h.runLock, auditLogs as never);
  });

  it('is registered under the same name its handler locks with', () => {
    const def = findCronJob(jobCase.jobName);
    expect(def?.method).toBe(built.method);
  });

  it('the scheduled tick runs and releases the lock', async () => {
    await tick(built.instance, built.method);

    expect(built.work).toHaveBeenCalledTimes(1);
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);
  });

  it('the scheduled tick skips while a manual run holds the lock', async () => {
    let release!: () => void;
    built.work.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const manual = admin.run(jobCase.jobName, 'admin-1');
    await settle();
    expect(built.work).toHaveBeenCalledTimes(1);

    await tick(built.instance, built.method);
    release();
    const result = await manual;

    expect(built.work).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    if (jobCase.logsRuns) {
      expect(h.cronLogger.trackSkipped).toHaveBeenCalledWith(
        jobCase.jobName,
        'run_lock_held',
      );
    } else {
      expect(h.cronLogger.trackSkipped).not.toHaveBeenCalled();
    }
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);
  });

  it('the manual run is skipped while a scheduled tick holds the lock', async () => {
    let release!: () => void;
    built.work.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([]))),
    );
    const scheduled = tick(built.instance, built.method);
    await settle();
    expect(built.work).toHaveBeenCalledTimes(1);

    const result = await admin.run(jobCase.jobName, 'admin-1');
    release();
    await scheduled;

    expect(built.work).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      job_name: jobCase.jobName,
      status: 'skipped',
    });
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);
  });

  it('a manual run does not deadlock on the lock it already holds', async () => {
    const result = await admin.run(jobCase.jobName, 'admin-1');

    expect(built.work).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);
  });

  it('releases the lock when the work throws (tick and manual run)', async () => {
    built.work.mockRejectedValue(new Error('db down'));

    await tick(built.instance, built.method).catch(() => undefined);
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);

    await admin.run(jobCase.jobName, 'admin-1');
    expect(await h.isRunLockFree(jobCase.jobName)).toBe(true);

    built.work.mockResolvedValue([]);
    await tick(built.instance, built.method);
    expect(built.work).toHaveBeenCalledTimes(3);
  });
});
