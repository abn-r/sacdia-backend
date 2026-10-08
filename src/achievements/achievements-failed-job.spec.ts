import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue, Worker } from 'bullmq';
import {
  AchievementsService,
  achievementQueueJobId,
} from './achievements.service';
import { AchievementsProcessor } from './achievements.processor';
import { InvestitureAuthorizationRequestService } from '../investiture-requests/investiture-authorization-requests.service';

jest.setTimeout(30000);

const PERSON = '11111111-1111-4111-8111-111111111111';
const INTENT = `investiture-authorization:${PERSON}`;

type EventRow = {
  event_id: number;
  user_id: string;
  event_type: string;
  event_payload: unknown;
  processed: boolean;
  idempotency_key: string;
};

describe('failed achievement jobs on an isolated Redis', () => {
  let redis: ChildProcess;
  let port: number;
  let directory: string;
  let queue: Queue;
  let worker: Worker;

  beforeAll(async () => {
    port = await freePort();
    directory = mkdtempSync(join(tmpdir(), 'sacdia-achievements-redis-'));
    redis = spawn(
      'redis-server',
      [
        '--port',
        String(port),
        '--bind',
        '127.0.0.1',
        '--protected-mode',
        'yes',
        '--save',
        '',
        '--appendonly',
        'no',
        '--dir',
        directory,
        '--daemonize',
        'no',
        '--loglevel',
        'warning',
      ],
      { stdio: 'ignore' },
    );
    await waitForRedis(port);
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    if (redis && !redis.killed) {
      redis.kill('SIGTERM');
    }
  });

  it('retries an exhausted job once and then marks the event processed', async () => {
    const rows: EventRow[] = [];
    let failuresLeft = 3;
    const people = [
      {
        person_id: PERSON,
        user_id: 'user-1',
        class_id: 7,
        enrollment_id: 1,
        status: 'INVESTED',
        achievement_intent_key: INTENT,
      },
    ];
    const store = {
      achievement_event_log: {
        create: async (args: {
          data: Omit<EventRow, 'event_id' | 'processed'> & {
            processed?: boolean;
          };
        }) => {
          const row: EventRow = {
            event_id: rows.length + 1,
            processed: false,
            ...args.data,
          };
          rows.push(row);
          return row;
        },
        findFirst: async (args: { where: { idempotency_key: string } }) =>
          rows.find(
            (row) => row.idempotency_key === args.where.idempotency_key,
          ) ?? null,
        findUnique: async (args: { where: { event_id: number } }) => {
          if (failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error('transient achievement_event_log read');
          }
          return (
            rows.find((row) => row.event_id === args.where.event_id) ?? null
          );
        },
        findMany: async (args: {
          where: { idempotency_key: { in: string[] }; processed: boolean };
        }) =>
          rows.filter(
            (row) =>
              args.where.idempotency_key.in.includes(row.idempotency_key) &&
              row.processed === args.where.processed,
          ),
        update: async (args: {
          where: { event_id: number };
          data: { processed: boolean };
        }) => {
          const row = rows.find(
            (item) => item.event_id === args.where.event_id,
          );
          if (!row) {
            throw new Error('event missing');
          }
          row.processed = args.data.processed;
          return row;
        },
      },
      achievements: { findMany: async () => [] },
      enrollments: {
        findUnique: async () => ({
          enrollment_id: 1,
          user_id: 'user-1',
          class_id: 7,
          ecclesiastical_year_id: 2026,
          investiture_status: 'INVESTIDO',
          record_kind: 'OPERATIONAL',
          cross_type_enrollment: false,
          active: true,
          classes: {
            name: 'Amigo',
            min_duration_years: 1,
            max_duration_years: 1,
            club_type_id: 1,
            club_types: { name: 'Conquistadores' },
          },
          ecclesiastical_year: { start_date: new Date('2026-01-01') },
        }),
      },
      investiture_authorization_people: {
        findMany: async () => people,
      },
      ecclesiastical_years: {
        findUnique: async () => {
          throw new Error('year must not be read during recovery');
        },
      },
      $queryRaw: async () => [],
      $executeRaw: async () => 0,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(store),
    };
    const connection = {
      host: '127.0.0.1',
      port,
      maxRetriesPerRequest: null,
    };
    queue = new Queue('achievements-failed-recovery', { connection });
    const processor = new AchievementsProcessor(
      store as never,
      {} as never,
      { notifySafe: async () => undefined } as never,
    );
    worker = new Worker(
      'achievements-failed-recovery',
      (job) => processor.process(job),
      { connection },
    );
    worker.on('error', () => undefined);
    const achievements = new AchievementsService(
      store as never,
      {} as never,
      {} as never,
      queue,
    );
    const requests = new InvestitureAuthorizationRequestService(
      store as never,
      {} as never,
      achievements,
    );

    await requests.reconcileConfirmedAchievementIntents();
    const jobId = achievementQueueJobId(INTENT);
    await waitFor(async () => {
      const job = await queue.getJob(jobId);
      return (await job?.getState()) === 'failed' && job?.attemptsMade === 3;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].processed).toBe(false);
    expect(failuresLeft).toBe(0);

    await Promise.all([
      requests.reconcileConfirmedAchievementIntents(),
      requests.reconcileConfirmedAchievementIntents(),
    ]);
    await waitFor(async () => {
      const job = await queue.getJob(jobId);
      return (await job?.getState()) === 'completed' && rows[0].processed;
    });

    const finished = await queue.getJob(jobId);
    expect(await finished?.getState()).toBe('completed');
    expect(finished?.attemptsMade).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].processed).toBe(true);
    expect(rows[0].idempotency_key).toBe(INTENT);
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
      'completed',
      'paused',
    );
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(0);
    expect(
      counts.waiting + counts.active + counts.delayed + counts.paused,
    ).toBe(0);

    await requests.reconcileConfirmedAchievementIntents();
    expect(rows).toHaveLength(1);
    expect(people[0].status).toBe('INVESTED');
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const selected =
        typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
    server.on('error', reject);
  });
}

async function waitForRedis(redisPort: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const pong = await new Promise<boolean>((resolve) => {
      const ping = spawn('redis-cli', ['-p', String(redisPort), 'ping'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      ping.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      ping.on('exit', (code) => {
        resolve(code === 0 && output.includes('PONG'));
      });
      ping.on('error', () => resolve(false));
    });
    if (pong) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('redis did not start');
}

async function waitFor(ready: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await ready()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for the achievement job');
}
