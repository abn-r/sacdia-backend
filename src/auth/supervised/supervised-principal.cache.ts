import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { ActingForCache } from '../acting-for/acting-for.cache';
import type {
  ReleasePhase,
  SupervisionStatus,
} from '../acting-for/auth-principal';

/**
 * Why a principal is cut. `teen_login_disabled` (FAMILY_TEEN_LOGIN_ENABLED is
 * off and the account logs in with a handle) is decided on EVERY call from the
 * flag and the cached login method: it is never cached itself.
 */
export type SupervisedBlockCause =
  'login_disabled' | 'frozen' | 'teen_login_disabled';

/** `supervised_logins.method` of the account, when it has a row. */
export type SupervisedLoginMethod = 'email' | 'handle';

/**
 * What the resolver decided about a user: adult, supervised, blocked, or
 * `profile_incomplete` (unknown age: NULL birthday while the self-service
 * post-registration is still open). `login_method` is set only when the account
 * has a `supervised_logins` row (absent = no supervised login).
 */
export type SupervisedState =
  | { state: 'adult'; login_method?: SupervisedLoginMethod }
  | { state: 'profile_incomplete' }
  | {
      state: 'supervised';
      supervision: SupervisionStatus;
      login_method?: SupervisedLoginMethod;
    }
  | { state: 'blocked'; cause: SupervisedBlockCause }
  /**
   * Phase 4: an adult released from guardianship that has not completed the
   * release (accepted the fresh terms + has an email). `frozen` still logs in
   * (ruling R6) and can thaw by accepting.
   */
  | {
      state: 'released';
      phase: ReleasePhase;
      login_method?: SupervisedLoginMethod;
    };

export const SUPERVISED_ADULT_TTL_MS = 3_600_000; // 1 h
export const SUPERVISED_ACTIVE_TTL_MS = 60_000; // 60 s
export const SUPERVISED_BLOCKED_TTL_MS = 10_000; // 10 s
export const SUPERVISED_SESSION_TTL_MS = 60_000;
export const SUPERVISED_SESSION_MISS_TTL_MS = 10_000;
/** Never cache for less than this (a cap that lands on midnight must not be 0). */
const MIN_TTL_MS = 1_000;

const DAY_MS = 86_400_000;

/**
 * Milliseconds from `now` until the next 00:00 of the calendar day in
 * `timeZone`. Used to CAP the cache TTL so an age transition (a teen turning 18
 * at the country's midnight) applies without waiting for the TTL to expire.
 *
 * Reads the local clock once (no scanning). On the single DST day of a zone
 * that still observes DST the figure can be an hour long before the transition;
 * the TTLs it caps are at most one hour, so the error is bounded and harmless.
 */
export function msUntilNextLocalMidnight(
  timeZone: string,
  now: Date = new Date(),
): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now);
  } catch {
    return DAY_MS;
  }
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed =
    (read('hour') * 3600 + read('minute') * 60 + read('second')) * 1000 +
    now.getMilliseconds();
  return Math.max(DAY_MS - elapsed, 0);
}

/**
 * Epoch-versioned cache of the supervised-principal decision.
 *
 * Keys:
 *  - `supv:v4:{userId}:{epoch}`            the SupervisedState. v4 adds the
 *                                          `released` state (Phase 4). While
 *                                          FAMILY_MAJORITY_RELEASE_ENABLED is
 *                                          on the key is `supv:v4r:...`, so a
 *                                          flag flip never reads a state
 *                                          derived under the other value.
 *                                          v2 added the
 *                                          `profile_incomplete` state (a v1
 *                                          entry said "adult" for a NULL
 *                                          birthday); v3 adds `login_method`
 *                                          (a v2 entry has none, so a handle
 *                                          session would pass the flag-off
 *                                          cut). Older entries are never read.
 *  - `supv:sid:v1:{userId}:{epoch}:{sid}`  "this session still exists"
 * The epoch is the SAME one acting-for uses (`acting:epoch:{userId}`), so every
 * family mutation that already calls `ActingForCache.bump` also invalidates
 * these entries in one write. All methods throw on cache failure; the resolver
 * falls back to the database and never fails open.
 */
@Injectable()
export class SupervisedPrincipalCache {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly epochs: ActingForCache,
  ) {}

  getEpoch(userId: string): Promise<number | null> {
    return this.epochs.getEpoch(userId);
  }

  initEpoch(userId: string): Promise<number> {
    return this.epochs.initEpoch(userId);
  }

  private stateKey(
    userId: string,
    epoch: number,
    releaseEnabled: boolean,
  ): string {
    return `${releaseEnabled ? 'supv:v4r' : 'supv:v4'}:${userId}:${epoch}`;
  }

  async getState(
    userId: string,
    epoch: number,
    releaseEnabled = false,
  ): Promise<SupervisedState | null> {
    const cached = await this.cache.get<SupervisedState>(
      this.stateKey(userId, epoch, releaseEnabled),
    );
    return cached ?? null;
  }

  async setState(
    userId: string,
    epoch: number,
    state: SupervisedState,
    timeZone: string | null,
    releaseEnabled = false,
  ): Promise<void> {
    const base =
      state.state === 'adult'
        ? SUPERVISED_ADULT_TTL_MS
        : state.state === 'supervised' ||
            state.state === 'profile_incomplete' ||
            state.state === 'released'
          ? SUPERVISED_ACTIVE_TTL_MS
          : SUPERVISED_BLOCKED_TTL_MS;
    const ttl = timeZone
      ? Math.max(Math.min(base, msUntilNextLocalMidnight(timeZone)), MIN_TTL_MS)
      : base;
    await this.cache.set(
      this.stateKey(userId, epoch, releaseEnabled),
      state,
      ttl,
    );
  }

  async getSession(
    userId: string,
    epoch: number,
    sid: string,
  ): Promise<boolean | null> {
    const cached = await this.cache.get<boolean>(
      `supv:sid:v1:${userId}:${epoch}:${sid}`,
    );
    return typeof cached === 'boolean' ? cached : null;
  }

  async setSession(
    userId: string,
    epoch: number,
    sid: string,
    active: boolean,
  ): Promise<void> {
    await this.cache.set(
      `supv:sid:v1:${userId}:${epoch}:${sid}`,
      active,
      active ? SUPERVISED_SESSION_TTL_MS : SUPERVISED_SESSION_MISS_TTL_MS,
    );
  }
}
