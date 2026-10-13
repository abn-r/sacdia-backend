import { EventEmitter } from 'events';
import { attachBullmqWorkerErrorLogging } from './bullmq-worker-logging';

describe('attachBullmqWorkerErrorLogging', () => {
  const quota = () =>
    new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500002');

  it('keeps an error listener attached so the event cannot crash the process', () => {
    const worker = new EventEmitter();

    attachBullmqWorkerErrorLogging(worker as never, { error: jest.fn() }, 'q');

    expect(worker.listenerCount('error')).toBe(1);
    expect(() => worker.emit('error', quota())).not.toThrow();
  });

  it('logs one line for a 100 ms flood and names the queue and the fix', () => {
    const worker = new EventEmitter();
    const logger = { error: jest.fn() };
    attachBullmqWorkerErrorLogging(worker as never, logger, 'emails');

    for (let i = 0; i < 1_000; i += 1) worker.emit('error', quota());

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [message] = logger.error.mock.calls[0];
    expect(message).toContain('queue "emails"');
    expect(message).toContain('max requests limit exceeded');
    expect(message).toContain('BULLMQ_DISABLED_QUEUES');
  });

  it('keeps independent state per worker', () => {
    const a = new EventEmitter();
    const b = new EventEmitter();
    const logger = { error: jest.fn() };
    attachBullmqWorkerErrorLogging(a as never, logger, 'emails');
    attachBullmqWorkerErrorLogging(b as never, logger, 'notifications');

    a.emit('error', quota());
    a.emit('error', quota());
    b.emit('error', quota());

    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});
