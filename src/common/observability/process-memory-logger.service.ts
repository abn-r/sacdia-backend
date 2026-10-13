import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import * as v8 from 'v8';

const INTERVAL_ENV_KEY = 'PROCESS_MEMORY_LOG_INTERVAL_MINUTES';
const DEFAULT_INTERVAL_MINUTES = 15;
const MIB = 1024 * 1024;

const toMib = (bytes: number): number => Math.round((bytes / MIB) * 10) / 10;

/**
 * Logs process memory usage as ONE structured line so real memory pressure is
 * visible in the logs on hosts without metrics (Render Free, 512 MB).
 *
 * - Once at application bootstrap (`phase: 'boot'`).
 * - Then every `PROCESS_MEMORY_LOG_INTERVAL_MINUTES` minutes
 *   (`phase: 'interval'`). Default 15. `0` disables the interval but keeps the
 *   boot line. Optional integer >= 0, validated in `config/env.validation.ts`.
 * - Under `NODE_ENV=test` nothing is logged unless the env var is explicitly
 *   set, to keep jest output quiet.
 *
 * All sizes are MiB rounded to 1 decimal. Fields: rss_mib, heap_used_mib,
 * heap_total_mib, external_mib, array_buffers_mib, heap_size_limit_mib
 * (from v8.getHeapStatistics()), uptime_seconds. No PII.
 *
 * Grep the logs for the message `Process memory`.
 */
@Injectable()
export class ProcessMemoryLoggerService
  implements OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown
{
  private readonly logger = new Logger(ProcessMemoryLoggerService.name);
  private timer: NodeJS.Timeout | null = null;

  onApplicationBootstrap(): void {
    const rawInterval = process.env[INTERVAL_ENV_KEY];
    const explicit = rawInterval !== undefined && rawInterval.trim() !== '';

    if (process.env.NODE_ENV === 'test' && !explicit) return;

    this.logMemory('boot');

    const minutes = explicit
      ? Number.parseInt(rawInterval, 10)
      : DEFAULT_INTERVAL_MINUTES;
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    this.timer = setInterval(
      () => this.logMemory('interval'),
      minutes * 60_000,
    );
    // Never keep the process alive just to log memory.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private logMemory(phase: 'boot' | 'interval'): void {
    const usage = process.memoryUsage();
    this.logger.log({
      msg: 'Process memory',
      phase,
      rss_mib: toMib(usage.rss),
      heap_used_mib: toMib(usage.heapUsed),
      heap_total_mib: toMib(usage.heapTotal),
      external_mib: toMib(usage.external),
      array_buffers_mib: toMib(usage.arrayBuffers),
      heap_size_limit_mib: toMib(v8.getHeapStatistics().heap_size_limit),
      uptime_seconds: Math.round(process.uptime()),
    });
  }
}
