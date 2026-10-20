import { Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { AppServiceUnavailableException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ageToday } from '../../common/age/age.util';
import {
  CountryAgePolicyService,
  DEFAULT_COUNTRY_AGE_POLICY,
} from '../../common/age/country-age-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FamilyFeatureFlagsService } from '../../guardianships/family-feature-flags.service';
import type { LinkedDeviceRevokeReason } from '../../guardianships/linked-device-revoker.port';
import { ActingForCache } from '../acting-for/acting-for.cache';
import {
  deviceRevoked,
  deviceSessionExpired,
} from '../acting-for/acting-for.errors';
import { msUntilNextLocalMidnight } from '../supervised/supervised-principal.cache';
import { LinkedDeviceRevocation } from './linked-device-revocation';

/** Cache TTLs: a positive decision lives 30 s, a negative one 10 s (epoch bumps defeat both). */
export const DEVICE_GATE_ACTIVE_TTL_MS = 30_000;
export const DEVICE_GATE_INACTIVE_TTL_MS = 10_000;
/** `last_seen_at` is written at most once in this window (per device). */
export const DEVICE_LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 1_000;
/** Bounds the in-process write throttle. */
const LAST_SEEN_MEMORY_MAX = 5_000;

export interface DeviceGateInput {
  dependentId: string;
  sid: string;
  deviceId: string;
}

/** Why a device request is refused. */
export type DeviceInactiveCause =
  | 'not_found'
  | 'revoked'
  | 'expired'
  | 'session_missing'
  | 'guardianship_invalid'
  | 'dependent_inactive'
  | 'frozen'
  | 'teen_login_enabled'
  | 'majority';

/** What the gate lets through. */
export interface DeviceGateActive {
  active: true;
  linkedDeviceId: string;
  guardianshipId: string;
  /** ms since epoch: the device stops being valid at this time (cap or session). */
  validUntil: number;
}

export interface DeviceGateInactive {
  active: false;
  cause: DeviceInactiveCause;
}

export type DeviceGateDecision = DeviceGateActive | DeviceGateInactive;

/** The reason recorded on the device when a lifecycle cause makes it inactive. */
const AUTO_REVOKE_REASON: Partial<
  Record<DeviceInactiveCause, LinkedDeviceRevokeReason>
> = {
  guardianship_invalid: 'guardianship_revoked',
  dependent_inactive: 'dependent_frozen',
  frozen: 'dependent_frozen',
  teen_login_enabled: 'teen_login_enabled',
  majority: 'majority',
  session_missing: 'session_revoked',
  expired: 'expired',
};

/**
 * The per-request validity check of a linked device (FP3-44). A device JWT
 * lives an hour; this is what makes a revoke cut access on the NEXT request.
 *
 * Every request with a device token must find, in this order:
 *  - the feature flag on (kill switch, read every time, never cached);
 *  - a `linked_devices` row with this id, this dependent and this session id,
 *    not revoked, before its absolute expiry;
 *  - the session itself: existing, owned by the dependent, not expired;
 *  - the dependent: active, not frozen or purged, under the age of majority,
 *    with NO enabled supervised login (a child with an own login is not a
 *    device child any more);
 *  - the pairing guardianship: still VERIFIED, not custody, not test data, not
 *    revoked.
 *
 * Cache: `device:v1:{dependentId}:{epoch}:{deviceId}`, epoch = the SAME one
 * acting-for uses, so every family mutation (`bump`) orphans the entry. A
 * missing epoch is a miss (initEpoch before the read, no payload read under
 * it). The payload is plain JSON (strings, booleans, an epoch-ms number), so a
 * cache hit needs no Date revival; `validUntil` is compared on every hit so a
 * cached positive entry can never outlive the cap or the session.
 *
 * Failure policy: a cache error falls back to the database; a database error is
 * a 503 AUTH_REVOCATION_CHECK_UNAVAILABLE. It never fails open.
 *
 * A lifecycle cause (the guardianship stopped being valid, the child turned of
 * age, a teen login exists, the child is frozen, the session vanished, the cap
 * passed) also fires an UN-AWAITED revoke, so the row records why. The check
 * itself is the safety net for an event that was missed.
 */
@Injectable()
export class LinkedDeviceGate {
  private readonly logger = new Logger(LinkedDeviceGate.name);
  private readonly lastSeenWrites = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly epochs: ActingForCache,
    private readonly flags: FamilyFeatureFlagsService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly revocation: LinkedDeviceRevocation,
  ) {}

  /**
   * Throws 401 AUTH_DEVICE_REVOKED (or AUTH_DEVICE_SESSION_EXPIRED past the
   * absolute cap) unless the device may act right now.
   */
  async assertActive(input: DeviceGateInput): Promise<DeviceGateActive> {
    // The kill switch: no data change, no revoke, just a 401 while it is off.
    if (!this.flags.isEnabled('linked_device')) {
      throw deviceRevoked();
    }

    const decision = await this.decide(input);
    if (!decision.active) {
      throw decision.cause === 'expired'
        ? deviceSessionExpired()
        : deviceRevoked();
    }
    return decision;
  }

  /**
   * Non-throwing variant for the refresh path: the decision, with the same
   * cache and the same lifecycle auto-revoke.
   */
  async decide(input: DeviceGateInput): Promise<DeviceGateDecision> {
    const key = (epoch: number) =>
      `device:v1:${input.dependentId}:${epoch}:${input.deviceId}`;

    let epoch: number | null;
    try {
      epoch = await this.epochs.getEpoch(input.dependentId);
      if (epoch === null) {
        // No epoch stored: a miss. Mint one BEFORE the database read and read
        // no payload under it (a mutation in between bumps past it).
        epoch = await this.epochs.initEpoch(input.dependentId);
      } else {
        const cached = await this.cache.get<DeviceGateDecision>(key(epoch));
        if (cached && this.isUsable(cached, input)) {
          return cached;
        }
      }
    } catch (error) {
      epoch = null;
      this.logCacheUnavailable(error);
    }

    const { decision, timeZone } = await this.loadFromDatabase(input);

    if (epoch !== null) {
      try {
        await this.cache.set(
          key(epoch),
          decision,
          this.ttlOf(decision, timeZone),
        );
      } catch (error) {
        this.logCacheUnavailable(error);
      }
    }

    if (decision.active) {
      this.touchLastSeen(input.deviceId);
    } else {
      this.autoRevoke(input, decision.cause);
    }
    return decision;
  }

  /** A cached entry is usable while its absolute time has not passed. */
  private isUsable(
    cached: DeviceGateDecision,
    input: DeviceGateInput,
  ): boolean {
    if (typeof cached !== 'object' || cached === null) return false;
    if (!cached.active) {
      return typeof cached.cause === 'string';
    }
    return (
      cached.linkedDeviceId === input.deviceId &&
      typeof cached.guardianshipId === 'string' &&
      typeof cached.validUntil === 'number' &&
      cached.validUntil > Date.now()
    );
  }

  private ttlOf(decision: DeviceGateDecision, timeZone: string | null): number {
    let ttl = decision.active
      ? DEVICE_GATE_ACTIVE_TTL_MS
      : DEVICE_GATE_INACTIVE_TTL_MS;
    if (decision.active) {
      // Never past the cap or the session, and never past the child's local
      // midnight (the day it turns of age is decided by the calendar day).
      ttl = Math.min(ttl, decision.validUntil - Date.now());
      if (timeZone) ttl = Math.min(ttl, msUntilNextLocalMidnight(timeZone));
    }
    return Math.max(ttl, MIN_TTL_MS);
  }

  private async loadFromDatabase(input: DeviceGateInput): Promise<{
    decision: DeviceGateDecision;
    timeZone: string | null;
  }> {
    try {
      const now = new Date();
      const device = await this.prisma.linked_devices.findFirst({
        where: {
          linked_device_id: input.deviceId,
          dependent_user_id: input.dependentId,
          session_id: input.sid,
        },
        select: {
          linked_device_id: true,
          guardianship_id: true,
          revoked_at: true,
          absolute_expires_at: true,
          guardianship: {
            select: {
              consent_status: true,
              is_custodian: true,
              is_test_data: true,
              revoked_at: true,
              guardian_user_id: true,
            },
          },
          dependent: {
            select: {
              active: true,
              birthday: true,
              country_id: true,
              dependent_profile: {
                select: { frozen_at: true, purged_at: true },
              },
              supervised_login: { select: { disabled_at: true } },
            },
          },
        },
      });

      if (!device) return inactive('not_found');
      if (device.revoked_at) return inactive('revoked');
      if (device.absolute_expires_at.getTime() <= now.getTime()) {
        return inactive('expired');
      }

      const session = await this.prisma.session.findFirst({
        where: {
          id: input.sid,
          userId: input.dependentId,
          expiresAt: { gt: now },
        },
        select: { expiresAt: true },
      });
      if (!session) return inactive('session_missing');

      const dependent = device.dependent;
      const policy = dependent.birthday
        ? await this.countryAgePolicy.getPolicy(dependent.country_id)
        : { ...DEFAULT_COUNTRY_AGE_POLICY };
      const timeZone = policy.timeZone;
      const profile = dependent.dependent_profile;

      if (!dependent.active) return inactive('dependent_inactive', timeZone);
      if (profile && (profile.frozen_at || profile.purged_at)) {
        return inactive('frozen', timeZone);
      }
      if (
        dependent.supervised_login &&
        dependent.supervised_login.disabled_at === null
      ) {
        return inactive('teen_login_enabled', timeZone);
      }
      // A NULL birthday cannot prove the child is a minor: fail closed.
      if (
        !dependent.birthday ||
        ageToday(dependent.birthday, policy.timeZone) >= policy.ageOfMajority
      ) {
        return inactive('majority', timeZone);
      }

      const guardianship = device.guardianship;
      if (
        guardianship.consent_status !== 'verified' ||
        guardianship.is_custodian ||
        guardianship.is_test_data ||
        guardianship.revoked_at !== null ||
        guardianship.guardian_user_id === null
      ) {
        return inactive('guardianship_invalid', timeZone);
      }

      return {
        decision: {
          active: true,
          linkedDeviceId: device.linked_device_id,
          guardianshipId: device.guardianship_id,
          validUntil: Math.min(
            device.absolute_expires_at.getTime(),
            session.expiresAt.getTime(),
          ),
        },
        timeZone,
      };
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'linked_device_gate_lookup_failed',
          dependent: input.dependentId,
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new AppServiceUnavailableException(
        ErrorCode.AUTH_REVOCATION_CHECK_UNAVAILABLE,
      );
    }
  }

  /** Fire and forget: the row records why the request check refused it. */
  private autoRevoke(input: DeviceGateInput, cause: DeviceInactiveCause): void {
    const reason = AUTO_REVOKE_REASON[cause];
    if (!reason) return;
    void this.revocation
      .revokeStandalone(
        {
          linked_device_id: input.deviceId,
          dependent_user_id: input.dependentId,
        },
        { by: null, reason },
      )
      .catch((error: unknown) => {
        this.logger.warn(
          JSON.stringify({
            event: 'linked_device_auto_revoke_failed',
            device: input.deviceId,
            cause,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }

  /**
   * `last_seen_at`, at most once per window. Best effort: a failure (or a slow
   * write) never fails or delays the request. Conditional in SQL too, so two
   * instances racing still write once.
   */
  private touchLastSeen(deviceId: string): void {
    const now = Date.now();
    const last = this.lastSeenWrites.get(deviceId);
    if (last !== undefined && now - last < DEVICE_LAST_SEEN_INTERVAL_MS) {
      return;
    }
    if (this.lastSeenWrites.size >= LAST_SEEN_MEMORY_MAX) {
      this.lastSeenWrites.clear();
    }
    this.lastSeenWrites.set(deviceId, now);

    void this.prisma.linked_devices
      .updateMany({
        where: {
          linked_device_id: deviceId,
          revoked_at: null,
          OR: [
            { last_seen_at: null },
            {
              last_seen_at: {
                lt: new Date(now - DEVICE_LAST_SEEN_INTERVAL_MS),
              },
            },
          ],
        },
        data: { last_seen_at: new Date(now) },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          JSON.stringify({
            event: 'linked_device_last_seen_failed',
            device: deviceId,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }

  private logCacheUnavailable(error: unknown): void {
    this.logger.warn(
      JSON.stringify({
        event: 'linked_device_gate_cache_unavailable',
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function inactive(
  cause: DeviceInactiveCause,
  timeZone: string | null = null,
): { decision: DeviceGateInactive; timeZone: string | null } {
  return { decision: { active: false, cause }, timeZone };
}
