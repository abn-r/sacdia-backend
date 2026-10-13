jest.mock('./firebase-admin.module', () => ({
  firebaseAdmin: { getApps: jest.fn(() => []), getMessaging: jest.fn() },
}));

import { Logger } from '@nestjs/common';
import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants';
import { AchievementsProcessor } from '../achievements/achievements.processor';
import { ACHIEVEMENTS_QUEUE } from '../achievements/achievements.constants';
import { BackgroundJobsProcessor } from '../background-jobs/background-jobs.processor';
import { BACKGROUND_JOBS_QUEUE } from '../background-jobs/background-jobs.types';
import { CertificateOcrProcessor } from '../certificate-bulk-imports/ocr/certificate-ocr.processor';
import { CERTIFICATE_OCR_QUEUE } from '../certificate-bulk-imports/ocr/certificate-ocr.queue';
import { EmailProcessor } from '../common/email/email.processor';
import { EMAIL_QUEUE } from '../common/email/email.queue';
import { MASTER_HONORS_QUEUE } from '../honors/master-honors.constants';
import { MasterHonorsRecalculationProcessor } from '../honors/master-honors-recalculation.processor';
import {
  NOTIFICATIONS_QUEUE,
  NotificationsProcessor,
} from '../notifications/notifications.processor';
import {
  BULLMQ_DEFAULT_DRAIN_DELAY_SECONDS,
  BULLMQ_DEFAULT_LOCK_DURATION_MS,
  BULLMQ_DEFAULT_STALLED_INTERVAL_MS,
  BULLMQ_WORKER_QUEUES,
  buildBullmqWorkerOptions,
  isBullmqWorkerEnabled,
  parseQueueList,
} from './bullmq-workers.config';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('buildBullmqWorkerOptions', () => {
  it('uses cheap idle-polling defaults when no env is set', () => {
    expect(buildBullmqWorkerOptions('notifications', {}, {})).toEqual({
      drainDelay: 30,
      lockDuration: 30_000,
      stalledInterval: 300_000,
    });
    expect(BULLMQ_DEFAULT_DRAIN_DELAY_SECONDS).toBe(30);
    expect(BULLMQ_DEFAULT_STALLED_INTERVAL_MS).toBe(300_000);
  });

  it('reads drainDelay and stalledInterval from env', () => {
    const options = buildBullmqWorkerOptions(
      'achievements',
      {},
      {
        BULLMQ_WORKER_DRAIN_DELAY_SECONDS: '60',
        BULLMQ_WORKER_STALLED_INTERVAL_MS: '600000',
      },
    );

    expect(options.drainDelay).toBe(60);
    expect(options.stalledInterval).toBe(600_000);
  });

  it.each(['', 'abc', '0', '-5', '1.5'])(
    'falls back to defaults for invalid env value %p',
    (value) => {
      const options = buildBullmqWorkerOptions(
        'achievements',
        {},
        {
          BULLMQ_WORKER_DRAIN_DELAY_SECONDS: value,
          BULLMQ_WORKER_STALLED_INTERVAL_MS: value,
        },
      );

      expect(options.drainDelay).toBe(30);
      expect(options.stalledInterval).toBe(300_000);
    },
  );

  it('never lets stalledInterval drop below lockDuration', () => {
    const options = buildBullmqWorkerOptions(
      'certificate-import-ocr',
      {},
      { BULLMQ_WORKER_STALLED_INTERVAL_MS: '1000' },
    );

    expect(options.lockDuration).toBe(60_000);
    expect(options.stalledInterval).toBe(60_000);
  });

  it('gives the OCR queue a longer lock than the BullMQ default', () => {
    expect(
      buildBullmqWorkerOptions('certificate-import-ocr', {}, {}).lockDuration,
    ).toBeGreaterThan(BULLMQ_DEFAULT_LOCK_DURATION_MS);
  });

  it('keeps per-processor overrides (concurrency, limiter) intact', () => {
    const limiter = { max: 90, duration: 86_400_000 };
    const options = buildBullmqWorkerOptions(
      'emails',
      { concurrency: 3, limiter },
      {},
    );

    expect(options.concurrency).toBe(3);
    expect(options.limiter).toBe(limiter);
    expect(options.drainDelay).toBe(30);
  });

  it('clamps stalledInterval to an overridden lockDuration', () => {
    const options = buildBullmqWorkerOptions(
      'background-jobs',
      { lockDuration: 400_000 },
      {},
    );

    expect(options.stalledInterval).toBe(400_000);
  });
});

describe('isBullmqWorkerEnabled', () => {
  it('is enabled by default for every queue', () => {
    for (const queue of BULLMQ_WORKER_QUEUES) {
      expect(isBullmqWorkerEnabled(queue, {})).toBe(true);
    }
  });

  it.each(['false', 'FALSE', '0'])(
    'disables every worker when BULLMQ_WORKERS_ENABLED=%s',
    (value) => {
      for (const queue of BULLMQ_WORKER_QUEUES) {
        expect(
          isBullmqWorkerEnabled(queue, { BULLMQ_WORKERS_ENABLED: value }),
        ).toBe(false);
      }
    },
  );

  it('keeps workers enabled for unrecognised flag values', () => {
    expect(
      isBullmqWorkerEnabled('emails', { BULLMQ_WORKERS_ENABLED: 'maybe' }),
    ).toBe(true);
  });

  it('disables only the queues listed in BULLMQ_DISABLED_QUEUES', () => {
    const env = { BULLMQ_DISABLED_QUEUES: ' emails , certificate-import-ocr ' };

    expect(isBullmqWorkerEnabled('emails', env)).toBe(false);
    expect(isBullmqWorkerEnabled('certificate-import-ocr', env)).toBe(false);
    expect(isBullmqWorkerEnabled('notifications', env)).toBe(true);
    expect(isBullmqWorkerEnabled('achievements', env)).toBe(true);
  });

  it('parses empty and blank queue lists as "nothing disabled"', () => {
    expect(parseQueueList(undefined)).toEqual([]);
    expect(parseQueueList(' , ,')).toEqual([]);
    expect(
      isBullmqWorkerEnabled('emails', { BULLMQ_DISABLED_QUEUES: '' }),
    ).toBe(true);
  });
});

describe('worker registry consistency', () => {
  it('lists exactly the queues that own a @Processor', () => {
    expect([...BULLMQ_WORKER_QUEUES].sort()).toEqual(
      [
        NOTIFICATIONS_QUEUE,
        ACHIEVEMENTS_QUEUE,
        EMAIL_QUEUE,
        BACKGROUND_JOBS_QUEUE,
        MASTER_HONORS_QUEUE,
        CERTIFICATE_OCR_QUEUE,
      ].sort(),
    );
  });

  it.each([
    ['notifications', NotificationsProcessor],
    ['achievements', AchievementsProcessor],
    ['emails', EmailProcessor],
    ['background-jobs', BackgroundJobsProcessor],
    ['master-honors', MasterHonorsRecalculationProcessor],
    ['certificate-import-ocr', CertificateOcrProcessor],
  ])('%s processor is built from the centralized options', (_queue, cls) => {
    const options = Reflect.getMetadata(WORKER_METADATA, cls);

    expect(options).toEqual(
      expect.objectContaining({
        drainDelay: 30,
        stalledInterval: expect.any(Number),
      }),
    );
    expect(options.stalledInterval).toBeGreaterThanOrEqual(
      options.lockDuration,
    );
  });

  it('preserves the email daily limiter and the OCR concurrency', () => {
    expect(
      Reflect.getMetadata(WORKER_METADATA, EmailProcessor).limiter,
    ).toEqual({ max: 90, duration: 24 * 60 * 60 * 1000 });
    expect(
      Reflect.getMetadata(WORKER_METADATA, CertificateOcrProcessor).concurrency,
    ).toBe(1);
  });
});

describe('processor providers honour the worker switch', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  function providersOf(modulePath: string, exportName: string): unknown[] {
    let providers: unknown[] = [];
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(modulePath) as Record<string, object>;
      providers = Reflect.getMetadata('providers', mod[exportName]) ?? [];
    });
    return providers;
  }

  const redisUrl = 'rediss://default:secret@redis.example.com:6379';

  it('registers the email processor by default', () => {
    process.env.REDIS_URL = redisUrl;
    delete process.env.BULLMQ_WORKERS_ENABLED;
    delete process.env.BULLMQ_DISABLED_QUEUES;

    const providers = providersOf(
      '../common/email/email.module',
      'EmailModule',
    );

    expect(providers.map((p) => (p as { name?: string }).name)).toContain(
      'EmailProcessor',
    );
  });

  it('omits the email processor but keeps the producer when disabled', () => {
    process.env.REDIS_URL = redisUrl;
    process.env.BULLMQ_DISABLED_QUEUES = 'emails';

    const providers = providersOf(
      '../common/email/email.module',
      'EmailModule',
    );
    const names = providers.map((p) => (p as { name?: string }).name);

    expect(names).not.toContain('EmailProcessor');
    expect(names).toContain('EmailQueueProducer');
  });

  it('omits every worker when BULLMQ_WORKERS_ENABLED=false', () => {
    process.env.REDIS_URL = redisUrl;
    process.env.BULLMQ_WORKERS_ENABLED = 'false';

    const cases: Array<[string, string, string]> = [
      ['../common/email/email.module', 'EmailModule', 'EmailProcessor'],
      [
        '../notifications/notifications.module',
        'NotificationsModule',
        'NotificationsProcessor',
      ],
      [
        '../achievements/achievements.module',
        'AchievementsModule',
        'AchievementsProcessor',
      ],
      [
        '../background-jobs/background-jobs.module',
        'BackgroundJobsModule',
        'BackgroundJobsProcessor',
      ],
      [
        '../honors/honors.module',
        'HonorsModule',
        'MasterHonorsRecalculationProcessor',
      ],
      [
        '../certificate-bulk-imports/certificate-bulk-imports.module',
        'CertificateBulkImportsModule',
        'CertificateOcrProcessor',
      ],
    ];

    for (const [path, exportName, processor] of cases) {
      const names = providersOf(path, exportName).map(
        (p) => (p as { name?: string }).name,
      );
      expect(names).not.toContain(processor);
    }
  });

  it('registers every worker when Redis is configured and nothing is disabled', () => {
    process.env.REDIS_URL = redisUrl;
    delete process.env.BULLMQ_WORKERS_ENABLED;
    delete process.env.BULLMQ_DISABLED_QUEUES;

    const cases: Array<[string, string, string]> = [
      [
        '../notifications/notifications.module',
        'NotificationsModule',
        'NotificationsProcessor',
      ],
      [
        '../achievements/achievements.module',
        'AchievementsModule',
        'AchievementsProcessor',
      ],
      [
        '../background-jobs/background-jobs.module',
        'BackgroundJobsModule',
        'BackgroundJobsProcessor',
      ],
      [
        '../honors/honors.module',
        'HonorsModule',
        'MasterHonorsRecalculationProcessor',
      ],
      [
        '../certificate-bulk-imports/certificate-bulk-imports.module',
        'CertificateBulkImportsModule',
        'CertificateOcrProcessor',
      ],
    ];

    for (const [path, exportName, processor] of cases) {
      const names = providersOf(path, exportName).map(
        (p) => (p as { name?: string }).name,
      );
      expect(names).toContain(processor);
    }
  });
});
