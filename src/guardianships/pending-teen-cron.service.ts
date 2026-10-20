import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { ageToday } from '../common/age/age.util';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { TokenBlacklistService } from '../common/services/token-blacklist.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVE_USER_GUARDIAN, lockDependent } from './guardianship-queries';
import {
  FROZEN_PURGE_AFTER_DAYS,
  PENDING_TEEN_FREEZE_DAYS,
  PENDING_TEEN_REMINDER_DAYS,
} from './guardianships.constants';
import {
  LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';

export const PENDING_TEEN_JOB = 'pending-teen-guardian';
const LOCK_KEY = 'cron:pending-teen-guardian';
/** Slightly under the 24h interval, like the other daily crons. */
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Same as the access token TTL: tokens issued before the freeze die with it. */
const JWT_TTL_SECONDS = 28_800;
/**
 * Coarse prefilter for the lazy clock start: nobody older than this can be a
 * minor in any country, so adults never get scanned.
 */
const MAX_MINOR_PREFILTER_YEARS = 21;
export const TEEN_REMINDER_SOURCE = 'family:teen_reminder';

export interface PendingTeenSummary {
  clocksStarted: number;
  reminders: number;
  frozen: number;
  failed: number;
}

/**
 * Daily pass over the self-registered teens that have no guardian linked.
 *
 *   1. A minor account holder without a `supervised_logins` row gets one with
 *      `pending_since = now` (the clock starts at the FIRST evaluation, so
 *      accounts that predate this feature are never frozen on the first run).
 *   2. Reminders go to the TEEN (push + inbox, never email) at day 7, 30 and 83
 *      of the guardian-less clock. After an outage only the LATEST due reminder
 *      is sent, once (`pending_reminder_level` is claimed before sending).
 *   3. At day 90 the account is frozen: one transaction marks the dependent
 *      profile frozen (`purge_after = now + 90 days`, ruling R9), disables the
 *      supervised login (`unlinked_purged`) and deletes the sessions. A pending
 *      (unverified) link counts as linked and stops the clock. The hard delete
 *      of the personal data belongs to {@link DependentProfilesPurgeCronService}.
 *
 * Nothing here touches a person who reached the age of majority.
 */
@Injectable()
export class PendingTeenCronService {
  private readonly logger = new Logger(PendingTeenCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    private readonly actingForCache: ActingForCache,
    private readonly notifications: NotificationsService,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly tokenBlacklist: TokenBlacklistService,
    @Inject(LINKED_DEVICE_REVOKER)
    private readonly deviceRevoker: LinkedDeviceRevoker,
  ) {}

  @Cron('40 4 * * *', { name: PENDING_TEEN_JOB, timeZone: 'UTC' })
  async handleDaily(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(LOCK_KEY, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.debug(
        'Another instance runs the pending teen job — skipping',
      );
      await this.cronLogger.trackSkipped(PENDING_TEEN_JOB, 'lock_not_acquired');
      return;
    }

    try {
      await this.cronLogger.track(PENDING_TEEN_JOB, async () => {
        const summary = await this.run();
        if (summary.failed > 0) {
          throw new Error(
            `${summary.failed} pending teen(s) could not be processed (retry next run); ${summary.reminders} reminded, ${summary.frozen} frozen`,
          );
        }
        return {
          itemsProcessed:
            summary.clocksStarted + summary.reminders + summary.frozen,
        };
      });
    } catch (error) {
      this.logger.error(
        `Error in the pending teen job: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await this.lockService.release(LOCK_KEY);
    }
  }

  async run(now: Date = new Date()): Promise<PendingTeenSummary> {
    const summary: PendingTeenSummary = {
      clocksStarted: 0,
      reminders: 0,
      frozen: 0,
      failed: 0,
    };
    summary.clocksStarted = await this.startMissingClocks(now, summary);
    await this.processPending(now, summary);
    return summary;
  }

  // ---------------------------------------------------------------------------
  // 1. Lazy clock start
  // ---------------------------------------------------------------------------

  private async startMissingClocks(
    now: Date,
    summary: PendingTeenSummary,
  ): Promise<number> {
    const oldestBirthday = new Date(now.getTime());
    oldestBirthday.setUTCFullYear(
      oldestBirthday.getUTCFullYear() - MAX_MINOR_PREFILTER_YEARS,
    );

    let started = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.users.findMany({
        where: {
          active: true,
          birthday: { gt: oldestBirthday },
          supervised_login: { is: null },
          dependent_profile: { is: null },
          account: { some: {} },
          ...(cursor ? { user_id: { gt: cursor } } : {}),
        },
        orderBy: { user_id: 'asc' },
        take: BATCH_SIZE,
        select: { user_id: true, birthday: true, country_id: true },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].user_id;

      for (const user of batch) {
        try {
          if (!(await this.isUnderMajority(user, now))) continue;
          const linked = await this.hasLinkedGuardian(user.user_id);
          // skipDuplicates semantics: a row created meanwhile wins.
          const created = await this.prisma.supervised_logins.createMany({
            data: [
              {
                user_id: user.user_id,
                method: 'email',
                origin: 'self_registered',
                password_set_by: 'self',
                pending_since: linked ? null : now,
                pending_reminder_level: 0,
              },
            ],
            skipDuplicates: true,
          });
          started += created.count;
        } catch (error) {
          summary.failed += 1;
          this.logFailure('pending_teen_clock_failed', user.user_id, error);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
    return started;
  }

  // ---------------------------------------------------------------------------
  // 2 + 3. Reminders and freeze
  // ---------------------------------------------------------------------------

  private async processPending(
    now: Date,
    summary: PendingTeenSummary,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.supervised_logins.findMany({
        where: {
          pending_since: { not: null },
          disabled_at: null,
          ...(cursor ? { user_id: { gt: cursor } } : {}),
        },
        orderBy: { user_id: 'asc' },
        take: BATCH_SIZE,
        select: {
          user_id: true,
          pending_since: true,
          pending_reminder_level: true,
          user: {
            select: {
              birthday: true,
              country_id: true,
              active: true,
              dependent_profile: {
                select: { frozen_at: true, purged_at: true },
              },
            },
          },
        },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].user_id;

      for (const row of batch) {
        try {
          if (!row.pending_since || !row.user.active) continue;
          const profile = row.user.dependent_profile;
          if (profile?.frozen_at || profile?.purged_at) continue;
          // Majority ends the supervision; an unknown birthday is not a teen
          // this job can reason about.
          if (
            !row.user.birthday ||
            !(await this.isUnderMajority(
              { birthday: row.user.birthday, country_id: row.user.country_id },
              now,
            ))
          ) {
            continue;
          }
          // A linked guardian (even pending verification) stops the clock.
          if (await this.hasLinkedGuardian(row.user_id)) continue;

          const days = Math.floor(
            (now.getTime() - row.pending_since.getTime()) / DAY_MS,
          );
          if (days >= PENDING_TEEN_FREEZE_DAYS) {
            if (await this.freeze(row.user_id, row.pending_since, now)) {
              summary.frozen += 1;
            }
            continue;
          }
          const due = dueReminderLevel(days);
          if (due > row.pending_reminder_level) {
            if (
              await this.remind(
                row.user_id,
                row.pending_reminder_level,
                due,
                PENDING_TEEN_FREEZE_DAYS - days,
              )
            ) {
              summary.reminders += 1;
            }
          }
        } catch (error) {
          summary.failed += 1;
          this.logFailure('pending_teen_failed', row.user_id, error);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
  }

  /**
   * Claims the level first (a compare-and-set, so two instances cannot both
   * send), then notifies. A failed send gives the claim back so the next run
   * retries it.
   */
  private async remind(
    teenId: string,
    from: number,
    to: number,
    daysLeft: number,
  ): Promise<boolean> {
    const claim = await this.prisma.supervised_logins.updateMany({
      where: {
        user_id: teenId,
        pending_reminder_level: { lt: to },
        pending_since: { not: null },
        disabled_at: null,
      },
      data: { pending_reminder_level: to },
    });
    if (claim.count === 0) return false;

    try {
      await this.notifications.sendToUser(
        {
          userId: teenId,
          title: 'Vincula a un adulto como tu tutor',
          body: `Tu cuenta necesita un tutor. Si no lo vinculas, se eliminará en ${Math.max(
            daysLeft,
            0,
          )} días.`,
          data: {
            type: 'teen_guardian_reminder',
            event: 'teen_guardian_reminder',
            days_left: String(Math.max(daysLeft, 0)),
          },
        },
        'system',
        TEEN_REMINDER_SOURCE,
      );
      return true;
    } catch (error) {
      await this.prisma.supervised_logins.updateMany({
        where: { user_id: teenId, pending_reminder_level: to },
        data: { pending_reminder_level: from },
      });
      throw error;
    }
  }

  /**
   * One transaction. Re-checks under the dependent lock that the teen is still
   * guardian-less and on the same clock, so a guardian linked (or a clock
   * restart) between the read and the lock wins over the freeze.
   */
  private async freeze(
    teenId: string,
    pendingSince: Date,
    now: Date,
  ): Promise<boolean> {
    const frozen = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, teenId);

      const login = await tx.supervised_logins.findUnique({
        where: { user_id: teenId },
        select: { pending_since: true, disabled_at: true },
      });
      if (
        !login ||
        login.disabled_at ||
        !login.pending_since ||
        login.pending_since.getTime() !== pendingSince.getTime()
      ) {
        return false;
      }
      const linked = await tx.guardianships.count({
        where: { dependent_user_id: teenId, ...ACTIVE_USER_GUARDIAN },
      });
      if (linked > 0) return false;

      await tx.dependent_profiles.upsert({
        where: { user_id: teenId },
        update: {
          frozen_at: now,
          purge_after: new Date(
            now.getTime() + FROZEN_PURGE_AFTER_DAYS * DAY_MS,
          ),
        },
        create: {
          user_id: teenId,
          created_by_user_id: teenId,
          frozen_at: now,
          purge_after: new Date(
            now.getTime() + FROZEN_PURGE_AFTER_DAYS * DAY_MS,
          ),
        },
      });
      await tx.supervised_logins.update({
        where: { user_id: teenId },
        data: {
          disabled_at: now,
          disabled_reason: 'unlinked_purged',
          disabled_by_user_id: null,
        },
      });
      await tx.session.deleteMany({ where: { userId: teenId } });
      await this.deviceRevoker.revokeAllForDependent(
        tx,
        teenId,
        'dependent_frozen',
      );
      return true;
    });
    if (!frozen) return false;

    // After the commit: best effort, the sessions are already gone.
    try {
      await this.tokenBlacklist.blacklistAllUserTokens(teenId, JWT_TTL_SECONDS);
    } catch (error) {
      this.logFailure('pending_teen_blacklist_failed', teenId, error);
    }
    await this.actingForCache.bump(teenId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async isUnderMajority(
    user: { birthday: Date | null; country_id: number | null },
    now: Date,
  ): Promise<boolean> {
    if (!user.birthday) return false;
    const policy = await this.countryAgePolicy.getPolicy(user.country_id);
    return ageToday(user.birthday, policy.timeZone, now) < policy.ageOfMajority;
  }

  private async hasLinkedGuardian(teenId: string): Promise<boolean> {
    const count = await this.prisma.guardianships.count({
      where: { dependent_user_id: teenId, ...ACTIVE_USER_GUARDIAN },
    });
    return count > 0;
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

/** Highest reminder level (1..3) whose day has passed; 0 before day 7. */
export function dueReminderLevel(days: number): number {
  let level = 0;
  PENDING_TEEN_REMINDER_DAYS.forEach((threshold, index) => {
    if (days >= threshold) level = index + 1;
  });
  return level;
}
