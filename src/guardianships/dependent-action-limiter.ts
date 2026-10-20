import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * A fixed-window limit keyed on an arbitrary subject (for example "5 password
 * resets per hour PER DEPENDENT"). The route throttler keys on the caller, so a
 * limit that is about the CHILD, not the guardian, needs its own counter.
 *
 * The window opens at the first hit. The cache is the shared store; if it
 * fails, the limit falls back to this process (never fails open to unlimited).
 * The read-modify-write is not atomic across instances: a burst can overshoot
 * by a request or two, which is acceptable for an abuse limit (it is not a
 * security boundary like the login lockout).
 */
@Injectable()
export class DependentActionLimiter {
  private readonly logger = new Logger(DependentActionLimiter.name);
  private readonly memory = new Map<string, Window>();

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** Counts one hit; throws 429 `code` when the window is already full. */
  async consume(
    key: string,
    limit: number,
    windowMs: number,
    code: ErrorCode = ErrorCode.AUTH_LOGIN_LOCKED,
  ): Promise<void> {
    const cacheKey = `dependent-limit:${key}`;
    const now = Date.now();

    let window = await this.read(cacheKey, now);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
    }
    if (window.count >= limit) {
      throw new AppException(code, HttpStatus.TOO_MANY_REQUESTS, {
        retry_after_seconds: Math.max(
          1,
          Math.ceil((window.resetAt - now) / 1000),
        ),
      });
    }
    window.count += 1;
    await this.write(cacheKey, window, now);
  }

  private async read(key: string, now: number): Promise<Window | null> {
    try {
      const cached = await this.cache.get<Window>(key);
      if (cached) return cached;
    } catch (error) {
      this.warn(error);
    }
    const local = this.memory.get(key);
    return local && local.resetAt > now ? { ...local } : null;
  }

  private async write(key: string, window: Window, now: number): Promise<void> {
    this.memory.set(key, { ...window });
    if (this.memory.size > 5_000) {
      for (const [k, v] of this.memory) {
        if (v.resetAt <= now) this.memory.delete(k);
      }
    }
    try {
      await this.cache.set(key, window, Math.max(1, window.resetAt - now));
    } catch (error) {
      this.warn(error);
    }
  }

  private warn(error: unknown): void {
    this.logger.warn(
      `dependent action limiter cache unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
