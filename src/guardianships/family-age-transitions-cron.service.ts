import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { ageToday } from '../common/age/age.util';
import {
  CountryAgePolicyService,
  type CountryAgePolicy,
} from '../common/age/country-age-policy.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import { LinkedDevicesService } from './linked-devices.service';

export const FAMILY_AGE_TRANSITIONS_JOB = 'family-age-transitions';
const LOCK_KEY = 'cron:family-age-transitions';
/** Slightly under the 24h interval, like the other daily crons. */
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
/**
 * Coarse prefilter for the nudge scan: nobody older than this can be a minor
 * in any country, so adults are never read. The exact test is the country
 * policy in code.
 */
const MAX_MINOR_PREFILTER_YEARS = 22;
/** Mandatory-free source (reminders bucket): a guardian MAY mute the nudge. */
export const AGE_NUDGE_SOURCE = 'family:age_nudge';

export interface FamilyAgeTransitionsSummary {
  /** Dependents whose guardians were nudged (flag set). */
  nudged: number;
  /** Eligible by age but no VERIFIED guardian yet: left NULL, nudged later. */
  skippedNoGuardian: number;
  /** Devices revoked because the child reached the age of majority. */
  majorityRevoked: number;
  /** Devices revoked because the 180-day cap passed. */
  expiredRevoked: number;
  failed: number;
}

/**
 * Daily pass over the age milestones of the family-profiles dependents
 * (Phase 3c, FP3-67 and FP3-50).
 *
 *  1. NUDGE (B14). A dependent with no account (or only a disabled login),
 *     active, not frozen or purged, `teen_login_nudged_at IS NULL`, whose age
 *     in its OWN country policy and calendar day is `>= minSelfLoginAge` and
 *     `< ageOfMajority`: every VERIFIED non-custodian guardian gets one push +
 *     inbox notice ("can now have their own login"), never email. The flag is
 *     CLAIMED first with a compare-and-set, so two instances or a retry can
 *     never double-send, and a total delivery failure gives the claim back. A
 *     dependent without a verified guardian is left NULL and nudged later. A
 *     cron that missed days nudges once on catch-up (the test is `>=`, not
 *     "turns 13 today"). With FAMILY_TEEN_LOGIN_ENABLED off it sends nothing and
 *     sets nothing. The paired devices are NOT touched by a birthday of 13.
 *  2. SWEEP (B15). Active linked devices whose child reached the age of
 *     majority are revoked (`majority`), and devices past their absolute cap
 *     (`expired`). Both go through {@link LinkedDevicesService}, which revokes
 *     with a compare-and-set and tells the remaining guardians, so the notice
 *     fires exactly once whoever gets there first (this job or the per-request
 *     gate). The user-visible effect is already enforced lazily by the gate;
 *     the sweep records why and tells the guardians even for a phone that
 *     never makes another request. Not flagged: a kill switch must still let
 *     the housekeeping run.
 */
@Injectable()
export class FamilyAgeTransitionsCronService {
  private readonly logger = new Logger(FamilyAgeTransitionsCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly notifications: NotificationsService,
    private readonly security: GuardianSecurityNotificationsService,
    private readonly flags: FamilyFeatureFlagsService,
    private readonly linkedDevices: LinkedDevicesService,
  ) {}

  @Cron('0 14 * * *', { name: FAMILY_AGE_TRANSITIONS_JOB, timeZone: 'UTC' })
  async handleDaily(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(LOCK_KEY, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.debug(
        'Another instance runs the family age transitions job — skipping',
      );
      await this.cronLogger.trackSkipped(
        FAMILY_AGE_TRANSITIONS_JOB,
        'lock_not_acquired',
      );
      return;
    }

    try {
      await this.cronLogger.track(FAMILY_AGE_TRANSITIONS_JOB, async () => {
        const summary = await this.run();
        if (summary.failed > 0) {
          // Fail the run so cron_run_log / CronAlertService report it. Nothing
          // is lost: a failed nudge gave its claim back, a failed revoke is
          // retried by the next sweep (and enforced lazily by the gate).
          throw new Error(
            `${summary.failed} family age transition(s) could not be processed (retry next run); ${summary.nudged} nudged, ${summary.majorityRevoked} majority and ${summary.expiredRevoked} expired device(s) revoked`,
          );
        }
        return {
          itemsProcessed:
            summary.nudged + summary.majorityRevoked + summary.expiredRevoked,
        };
      });
    } catch (error) {
      this.logger.error(
        `Error in the family age transitions job: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await this.lockService.release(LOCK_KEY);
    }
  }

  async run(now: Date = new Date()): Promise<FamilyAgeTransitionsSummary> {
    const summary: FamilyAgeTransitionsSummary = {
      nudged: 0,
      skippedNoGuardian: 0,
      majorityRevoked: 0,
      expiredRevoked: 0,
      failed: 0,
    };
    if (this.flags.isEnabled('teen_login')) {
      await this.nudgeAll(now, summary);
    }
    await this.sweepDevices(now, summary);
    return summary;
  }

  // ---------------------------------------------------------------------------
  // 1. Birthday-13 nudge
  // ---------------------------------------------------------------------------

  private async nudgeAll(
    now: Date,
    summary: FamilyAgeTransitionsSummary,
  ): Promise<void> {
    const oldestBirthday = new Date(now.getTime());
    oldestBirthday.setUTCFullYear(
      oldestBirthday.getUTCFullYear() - MAX_MINOR_PREFILTER_YEARS,
    );

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.users.findMany({
        where: {
          active: true,
          account: { none: {} },
          birthday: { not: null, gt: oldestBirthday },
          dependent_profile: {
            is: {
              frozen_at: null,
              purged_at: null,
              teen_login_nudged_at: null,
            },
          },
          // An own login that is still ENABLED means the nudge has nothing to
          // offer; a disabled one is eligible again.
          OR: [
            { supervised_login: { is: null } },
            { supervised_login: { is: { disabled_at: { not: null } } } },
          ],
          ...(cursor ? { user_id: { gt: cursor } } : {}),
        },
        orderBy: { user_id: 'asc' },
        take: BATCH_SIZE,
        select: {
          user_id: true,
          birthday: true,
          country_id: true,
          supervised_login: { select: { disabled_at: true } },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].user_id;

      for (const dependent of batch) {
        try {
          await this.nudgeOne(dependent, now, summary);
        } catch (error) {
          summary.failed += 1;
          this.logFailure('age_nudge_failed', dependent.user_id, error);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
  }

  private async nudgeOne(
    dependent: {
      user_id: string;
      birthday: Date | null;
      country_id: number | null;
      supervised_login: { disabled_at: Date | null } | null;
    },
    now: Date,
    summary: FamilyAgeTransitionsSummary,
  ): Promise<void> {
    if (!dependent.birthday) return;
    // Belt and braces over the query: an enabled login has nothing to nudge.
    if (
      dependent.supervised_login &&
      dependent.supervised_login.disabled_at === null
    ) {
      return;
    }

    const policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
    const age = ageToday(dependent.birthday, policy.timeZone, now);
    if (age < policy.minSelfLoginAge || age >= policy.ageOfMajority) return;

    const target = await this.security.recipientsOf(dependent.user_id);
    if (!target) {
      // Pending, custody-only or no guardian: stays NULL, nudged once verified.
      summary.skippedNoGuardian += 1;
      return;
    }

    // Claim first: only the instance that flips NULL -> now sends.
    const claim = await this.prisma.dependent_profiles.updateMany({
      where: {
        user_id: dependent.user_id,
        teen_login_nudged_at: null,
        frozen_at: null,
        purged_at: null,
      },
      data: { teen_login_nudged_at: now },
    });
    if (claim.count === 0) return;

    const results = await Promise.allSettled(
      target.guardianIds.map((guardianId) =>
        this.notifications.sendToUser(
          {
            userId: guardianId,
            title: `${target.firstName} ya puede tener su propio acceso`,
            body: `Puedes activar el inicio de sesión propio de ${target.firstName} desde su perfil.`,
            data: {
              type: 'dependent_age_milestone',
              event: 'age_milestone',
              dependent_user_id: dependent.user_id,
            },
          },
          'system',
          AGE_NUDGE_SOURCE,
        ),
      ),
    );

    if (results.every((result) => result.status === 'rejected')) {
      // No delivery attempt got through: give the claim back so tomorrow's run
      // tries again instead of silently losing the milestone.
      await this.prisma.dependent_profiles.updateMany({
        where: {
          user_id: dependent.user_id,
          teen_login_nudged_at: now,
        },
        data: { teen_login_nudged_at: null },
      });
      throw new Error('no guardian notice could be sent');
    }
    summary.nudged += 1;
  }

  // ---------------------------------------------------------------------------
  // 2. Device sweep
  // ---------------------------------------------------------------------------

  private async sweepDevices(
    now: Date,
    summary: FamilyAgeTransitionsSummary,
  ): Promise<void> {
    // Dependents already swept in this run (all their devices went at once).
    const sweptDependents = new Set<string>();
    const policies = new Map<number | null, CountryAgePolicy>();

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.linked_devices.findMany({
        where: {
          revoked_at: null,
          ...(cursor ? { linked_device_id: { gt: cursor } } : {}),
        },
        orderBy: { linked_device_id: 'asc' },
        take: BATCH_SIZE,
        select: {
          linked_device_id: true,
          dependent_user_id: true,
          absolute_expires_at: true,
          dependent: { select: { birthday: true, country_id: true } },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].linked_device_id;

      for (const device of batch) {
        try {
          const dependentId = device.dependent_user_id;
          if (sweptDependents.has(dependentId)) continue;

          if (await this.isOfAge(device.dependent, now, policies)) {
            sweptDependents.add(dependentId);
            summary.majorityRevoked += await this.linkedDevices.revokeBySystem({
              dependentId,
              reason: 'majority',
              // Re-read under the dependent lock: a birthday corrected since
              // the scan wins over the stale read.
              precondition: (tx) => this.stillOfAge(tx, dependentId, now),
            });
            continue;
          }

          if (device.absolute_expires_at.getTime() <= now.getTime()) {
            summary.expiredRevoked += await this.linkedDevices.revokeBySystem({
              dependentId,
              deviceId: device.linked_device_id,
              reason: 'expired',
              now,
            });
          }
        } catch (error) {
          summary.failed += 1;
          this.logFailure(
            'device_sweep_failed',
            device.dependent_user_id,
            error,
          );
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
  }

  /**
   * True when the child is of age in ITS country's calendar day. A child with no
   * birthday is left to the request gate (which fails closed): there is no age
   * to reason about here.
   */
  private async isOfAge(
    dependent: { birthday: Date | null; country_id: number | null },
    now: Date,
    cache: Map<number | null, CountryAgePolicy>,
  ): Promise<boolean> {
    if (!dependent.birthday) return false;
    let policy = cache.get(dependent.country_id);
    if (!policy) {
      policy = await this.countryAgePolicy.getPolicy(dependent.country_id);
      cache.set(dependent.country_id, policy);
    }
    return (
      ageToday(dependent.birthday, policy.timeZone, now) >= policy.ageOfMajority
    );
  }

  private async stillOfAge(
    tx: Prisma.TransactionClient,
    dependentId: string,
    now: Date,
  ): Promise<boolean> {
    const fresh = await tx.users.findUnique({
      where: { user_id: dependentId },
      select: { birthday: true, country_id: true },
    });
    if (!fresh) return false;
    // No policy cache here: this is the authoritative read under the lock.
    return this.isOfAge(fresh, now, new Map());
  }

  private logFailure(event: string, userId: string, error: unknown): void {
    this.logger.error(
      JSON.stringify({
        event,
        user: userId,
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
