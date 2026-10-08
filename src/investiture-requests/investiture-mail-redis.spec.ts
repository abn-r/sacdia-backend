import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Queue, Worker, type Job } from 'bullmq';
import { EmailProcessor } from '../common/email/email.processor';
import { EmailQueueProducer, EMAIL_QUEUE } from '../common/email/email.queue';
import { EmailService } from '../common/email/email.service';
import { serviceOf, world } from './investiture-communications.delivery.spec';

jest.setTimeout(90000);

const monday = new Date('2026-10-05T16:00:00.000Z');

describe('investiture mail on an isolated Redis', () => {
  let redis: ChildProcess;
  let port: number;
  let directory: string;
  const previousEmail = process.env.EMAIL_ENABLED;
  const previousInvestitureEmail = process.env.INVESTITURE_EMAIL_ENABLED;

  beforeAll(async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.INVESTITURE_EMAIL_ENABLED = 'true';
    port = await freePort();
    directory = mkdtempSync(join(tmpdir(), 'sacdia-investiture-mail-'));
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
    if (previousEmail === undefined) {
      delete process.env.EMAIL_ENABLED;
    } else {
      process.env.EMAIL_ENABLED = previousEmail;
    }
    if (previousInvestitureEmail === undefined) {
      delete process.env.INVESTITURE_EMAIL_ENABLED;
    } else {
      process.env.INVESTITURE_EMAIL_ENABLED = previousInvestitureEmail;
    }
    if (redis && !redis.killed) {
      redis.kill('SIGTERM');
    }
  });

  it('retries an exhausted provider failure after a worker restart without a second message', async () => {
    const { prisma, state, dispatches } = world();
    state.includeOfficer = false;
    state.extraPastor = false;
    const connection = {
      host: '127.0.0.1',
      port,
      maxRetriesPerRequest: null,
    };
    const queue = new Queue(EMAIL_QUEUE, { connection });
    const producer = new EmailQueueProducer(queue);
    const email = new EmailService(producer);
    const service = serviceOf(prisma, email);
    const accepted = new Map<string, string>();
    let fail = true;
    let providerCalls = 0;
    const provider = {
      send: async (payload: { idempotencyKey?: string }) => {
        providerCalls += 1;
        if (fail) {
          throw new Error('provider unavailable');
        }
        const key = payload.idempotencyKey ?? 'missing';
        if (!accepted.has(key)) {
          accepted.set(key, `msg-${accepted.size + 1}`);
        }
        return { messageId: accepted.get(key) ?? 'msg' };
      },
    };
    const processor = new EmailProcessor(
      provider,
      { get: () => undefined } as never,
      {} as never,
      { get: () => service } as never,
    );
    (
      processor as unknown as {
        renderTemplate: () => Promise<{
          subject: string;
          html: string;
          text: string;
        }>;
      }
    ).renderTemplate = async () => ({
      subject: 'Aviso',
      html: '<p>Aviso</p>',
      text: 'Aviso',
    });
    let worker = new Worker(EMAIL_QUEUE, (job) => processor.process(job), {
      connection,
    });
    worker.on('failed', (job, error) => {
      noteExhausted(job, error, service);
    });
    worker.on('error', () => undefined);

    expect(await service.dispatchReminders(monday)).toBe(1);
    const row = dispatches.find((item) => item.role === 'pastor');
    expect(row?.status).toBe('queued');
    const jobId = `investiture-mail-${row?.dispatch_id}`;
    await waitFor(async () => {
      const job = await queue.getJob(jobId);
      const current = dispatches.find(
        (item) => item.dispatch_id === row?.dispatch_id,
      );
      return (
        (await job?.getState()) === 'failed' &&
        (job?.attemptsMade ?? 0) >= 1 &&
        current?.status === 'failed'
      );
    });
    expect(accepted.size).toBe(0);
    // BCR33-N4: a reminder hand-off is exactly one provider attempt.
    expect(providerCalls).toBe(1);

    await worker.close();
    fail = false;
    worker = new Worker(EMAIL_QUEUE, (job) => processor.process(job), {
      connection,
    });
    worker.on('error', () => undefined);
    expect(await service.deliverPending(monday)).toBe(1);
    await waitFor(async () => {
      const current = dispatches.find(
        (item) => item.dispatch_id === row?.dispatch_id,
      );
      return current?.status === 'sent' && accepted.size === 1;
    });
    expect(accepted.size).toBe(1);

    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('BCR33-N4 reaches the provider at most 5 times per reminder across every hand-off', async () => {
    const { prisma, state, dispatches } = world();
    state.includeOfficer = false;
    state.extraPastor = false;
    const connection = {
      host: '127.0.0.1',
      port,
      maxRetriesPerRequest: null,
    };
    const queueName = `${EMAIL_QUEUE}-cap`;
    const queue = new Queue(queueName, { connection });
    const email = new EmailService(new EmailQueueProducer(queue));
    const service = serviceOf(prisma, email);
    let providerCalls = 0;
    const processor = new EmailProcessor(
      {
        send: async () => {
          providerCalls += 1;
          throw new Error('provider unavailable');
        },
      },
      { get: () => undefined } as never,
      {} as never,
      { get: () => service } as never,
    );
    (
      processor as unknown as {
        renderTemplate: () => Promise<{
          subject: string;
          html: string;
          text: string;
        }>;
      }
    ).renderTemplate = async () => ({
      subject: 'Aviso',
      html: '<p>Aviso</p>',
      text: 'Aviso',
    });
    const worker = new Worker(queueName, (job) => processor.process(job), {
      connection,
    });
    worker.on('failed', (job, error) => {
      noteExhausted(job, error, service);
    });
    worker.on('error', () => undefined);

    expect(await service.dispatchReminders(monday)).toBe(1);
    const row = dispatches.find((item) => item.role === 'pastor');
    const settled = () =>
      dispatches.find((item) => item.dispatch_id === row?.dispatch_id)?.status;
    await waitFor(async () => settled() === 'failed');
    expect(providerCalls).toBe(1);

    for (let cycle = 0; cycle < 8 && settled() !== 'skipped'; cycle += 1) {
      await service.deliverPending(monday);
      await waitFor(async () => ['failed', 'skipped'].includes(settled()));
    }

    expect(settled()).toBe('skipped');
    expect(providerCalls).toBe(5);

    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('does not send a second message when the ack fails after the provider accepts', async () => {
    const { prisma, state, dispatches } = world();
    state.includeOfficer = false;
    state.extraPastor = false;
    const connection = {
      host: '127.0.0.1',
      port,
      maxRetriesPerRequest: null,
    };
    const queue = new Queue(`${EMAIL_QUEUE}-ack`, { connection });
    const email = new EmailService(new EmailQueueProducer(queue));
    const service = serviceOf(prisma, email);
    const accepted = new Map<string, number>();
    let ack = false;
    const realAck = service.acknowledge.bind(service);
    service.acknowledge = async (dispatchId, messageId) => {
      if (!ack) {
        ack = true;
        throw new Error('ack write failed');
      }
      await realAck(dispatchId, messageId);
    };
    const processor = new EmailProcessor(
      {
        send: async (payload: { idempotencyKey?: string }) => {
          const key = payload.idempotencyKey ?? 'missing';
          accepted.set(key, (accepted.get(key) ?? 0) + 1);
          return { messageId: 'msg-ack' };
        },
      },
      { get: () => undefined } as never,
      {} as never,
      { get: () => service } as never,
    );
    (
      processor as unknown as {
        renderTemplate: () => Promise<{
          subject: string;
          html: string;
          text: string;
        }>;
      }
    ).renderTemplate = async () => ({
      subject: 'Aviso',
      html: '<p>Aviso</p>',
      text: 'Aviso',
    });
    const worker = new Worker(
      `${EMAIL_QUEUE}-ack`,
      (job) => processor.process(job),
      { connection },
    );
    worker.on('error', () => undefined);
    worker.on('failed', (job, error) => {
      noteExhausted(job, error, service);
    });
    expect(await service.dispatchReminders(monday)).toBe(1);
    const row = dispatches.find((item) => item.role === 'pastor');
    const status = () =>
      dispatches.find((item) => item.dispatch_id === row?.dispatch_id)?.status;
    // BCR33-N4: a reminder hand-off is one provider attempt. The ack failure
    // ends this hand-off as failed; the next hand-off (deliverPending) resends
    // the stored message with the same idempotency key and acknowledges it.
    await waitFor(async () => status() === 'failed');
    expect(accepted.size).toBe(1);
    expect([...accepted.values()][0]).toBe(1);
    expect(await service.deliverPending(monday)).toBe(1);
    await waitFor(async () => status() === 'sent');
    expect(accepted.size).toBe(1);
    expect([...accepted.values()][0]).toBe(2);
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });
});

function noteExhausted(
  job: Job | undefined,
  error: Error,
  service: { markFailed(dispatchId: string, message: string): Promise<void> },
): void {
  if (!job) {
    return;
  }
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) {
    return;
  }
  const dispatchId = (job.data as { dispatchId?: string }).dispatchId;
  if (!dispatchId) {
    return;
  }
  void service.markFailed(dispatchId, error.message);
}

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('redis did not start');
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 70000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timed out waiting for the mail job');
}
