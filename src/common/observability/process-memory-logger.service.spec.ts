import { Logger } from '@nestjs/common';
import * as v8 from 'v8';
import { ProcessMemoryLoggerService } from './process-memory-logger.service';

jest.mock('v8', () => ({
  ...jest.requireActual<typeof import('v8')>('v8'),
  getHeapStatistics: jest.fn(),
}));

const MIB = 1024 * 1024;
const ENV_KEY = 'PROCESS_MEMORY_LOG_INTERVAL_MINUTES';

describe('ProcessMemoryLoggerService', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalInterval = process.env[ENV_KEY];

  let logSpy: jest.SpyInstance;
  let service: ProcessMemoryLoggerService;
  let handles: NodeJS.Timeout[];

  beforeEach(() => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'production';
    delete process.env[ENV_KEY];

    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 200 * MIB + MIB * 0.26,
      heapTotal: 100 * MIB,
      heapUsed: 80 * MIB + MIB * 0.54,
      external: 10 * MIB,
      arrayBuffers: 2 * MIB,
    });
    jest.spyOn(process, 'uptime').mockReturnValue(123.4);
    jest.mocked(v8.getHeapStatistics).mockReturnValue({
      heap_size_limit: 320 * MIB,
    });

    handles = [];
    const realSetInterval = global.setInterval;
    jest.spyOn(global, 'setInterval').mockImplementation(((
      ...args: Parameters<typeof setInterval>
    ) => {
      const handle = realSetInterval(...args);
      jest.spyOn(handle, 'unref');
      handles.push(handle);
      return handle;
    }) as typeof setInterval);

    service = new ProcessMemoryLoggerService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    jest.mocked(v8.getHeapStatistics).mockReset();
    jest.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalInterval === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalInterval;
  });

  const expectedFields = (phase: 'boot' | 'interval') => ({
    msg: 'Process memory',
    phase,
    rss_mib: 200.3,
    heap_used_mib: 80.5,
    heap_total_mib: 100,
    external_mib: 10,
    array_buffers_mib: 2,
    heap_size_limit_mib: 320,
    uptime_seconds: 123,
  });

  it('logs one boot line with every field in MiB', () => {
    service.onApplicationBootstrap();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expectedFields('boot'));
  });

  it('logs an interval line after N minutes (default 15)', () => {
    service.onApplicationBootstrap();
    logSpy.mockClear();

    jest.advanceTimersByTime(15 * 60_000 - 1);
    expect(logSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expectedFields('interval'));

    jest.advanceTimersByTime(15 * 60_000);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('honours a custom interval from the env', () => {
    process.env[ENV_KEY] = '2';
    service.onApplicationBootstrap();
    logSpy.mockClear();

    jest.advanceTimersByTime(2 * 60_000);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expectedFields('interval'));
  });

  it('0 disables the interval but keeps the boot line', () => {
    process.env[ENV_KEY] = '0';
    service.onApplicationBootstrap();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expectedFields('boot'));
    expect(global.setInterval).not.toHaveBeenCalled();

    jest.advanceTimersByTime(60 * 60_000);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('unrefs the timer so it never keeps the process alive', () => {
    service.onApplicationBootstrap();

    expect(handles).toHaveLength(1);
    expect(handles[0].unref).toHaveBeenCalledTimes(1);
  });

  it('clears the timer on destroy and on shutdown', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    service.onApplicationBootstrap();
    logSpy.mockClear();

    service.onModuleDestroy();
    expect(clearSpy).toHaveBeenCalledWith(handles[0]);

    jest.advanceTimersByTime(60 * 60_000);
    expect(logSpy).not.toHaveBeenCalled();

    // idempotent: shutdown after destroy must not throw nor clear twice
    clearSpy.mockClear();
    service.onApplicationShutdown();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  describe('NODE_ENV=test', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('skips both the boot line and the interval by default', () => {
      service.onApplicationBootstrap();
      jest.advanceTimersByTime(60 * 60_000);

      expect(logSpy).not.toHaveBeenCalled();
      expect(global.setInterval).not.toHaveBeenCalled();
    });

    it('logs when the interval is explicitly set', () => {
      process.env[ENV_KEY] = '1';
      service.onApplicationBootstrap();
      expect(logSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60_000);
      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });
});
