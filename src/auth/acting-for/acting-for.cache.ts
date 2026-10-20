import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { ActingForScope } from './auth-principal';

export type ActingDenyCause =
  | 'no_guardianship'
  | 'revoked'
  | 'custodian_or_external'
  | 'test_data'
  | 'dependent_inactive'
  | 'guardian_inactive'
  | 'has_account'
  | 'supervised_login_active'
  | 'no_dependent_profile'
  | 'frozen'
  | 'birthday_missing'
  | 'over_age'
  | 'unknown';

export interface ActingGrant {
  guardianshipId: string;
  consentStatus: 'pending' | 'verified';
  scopes: readonly ActingForScope[];
}

export type ActingResolution =
  | { granted: true; grant: ActingGrant }
  | { granted: false; cause: ActingDenyCause };

/** A grant lives 60s; a denial only 10s so an approved link shows up quickly. */
export const ACTING_GRANT_TTL_MS = 60_000;
export const ACTING_DENIAL_TTL_MS = 10_000;
/** The epoch must outlive every payload it versions. */
const ACTING_EPOCH_TTL_MS = 2_592_000_000; // 30 days

/**
 * Epoch-versioned cache of acting-for decisions.
 *
 * Payload key: `acting:v1:{dependentId}:{epoch}:{guardianId}`. Every
 * guardianship mutation calls `bump(dependentId)`, which moves the epoch and
 * orphans every cached decision about that dependent in one write (no SCAN).
 * All methods throw on cache failure: the resolver decides to fall back to the
 * database, so the cache can never turn into an allow.
 *
 * A MISSING epoch (30-day expiry, Redis flush or eviction) is a cache miss, not
 * epoch 0: payloads written under an older epoch of the same value could
 * resurrect a revoked grant. The resolver mints a fresh epoch (`initEpoch`)
 * BEFORE it reads the database and never reads a payload under it.
 */
@Injectable()
export class ActingForCache {
  private readonly logger = new Logger(ActingForCache.name);
  private lastEpoch = 0;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private epochKey(dependentId: string): string {
    return `acting:epoch:${dependentId}`;
  }

  private payloadKey(
    dependentId: string,
    epoch: number,
    guardianId: string,
  ): string {
    return `acting:v1:${dependentId}:${epoch}:${guardianId}`;
  }

  /** Strictly increasing inside the process even within one millisecond. */
  private nextEpoch(): number {
    this.lastEpoch = Math.max(Date.now(), this.lastEpoch + 1);
    return this.lastEpoch;
  }

  /** The current epoch, or `null` when none is stored (treat as a cache miss). */
  async getEpoch(dependentId: string): Promise<number | null> {
    const raw = await this.cache.get<number | string>(
      this.epochKey(dependentId),
    );
    const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw;
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : null;
  }

  /**
   * Stores a brand-new epoch for a dependent that has none and returns it.
   * Call it before the database read that the payload will be cached from, so a
   * mutation committing in between bumps past it and orphans that payload.
   */
  async initEpoch(dependentId: string): Promise<number> {
    const epoch = this.nextEpoch();
    await this.cache.set(
      this.epochKey(dependentId),
      epoch,
      ACTING_EPOCH_TTL_MS,
    );
    return epoch;
  }

  async get(
    dependentId: string,
    epoch: number,
    guardianId: string,
  ): Promise<ActingResolution | null> {
    const cached = await this.cache.get<ActingResolution>(
      this.payloadKey(dependentId, epoch, guardianId),
    );
    return cached ?? null;
  }

  async set(
    dependentId: string,
    epoch: number,
    guardianId: string,
    resolution: ActingResolution,
  ): Promise<void> {
    await this.cache.set(
      this.payloadKey(dependentId, epoch, guardianId),
      resolution,
      resolution.granted ? ACTING_GRANT_TTL_MS : ACTING_DENIAL_TTL_MS,
    );
  }

  /**
   * Invalidate every cached decision about a dependent. Callers invoke it right
   * after the guardianship mutation commits. A cache outage is logged and not
   * thrown: the mutation already happened, and stale grants age out in 60s.
   */
  async bump(dependentId: string): Promise<void> {
    try {
      await this.cache.set(
        this.epochKey(dependentId),
        this.nextEpoch(),
        ACTING_EPOCH_TTL_MS,
      );
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'acting_for_epoch_bump_failed',
          dependent: dependentId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
