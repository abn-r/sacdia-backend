import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  ageToday,
  calendarDateIn,
  isInMajorityNoticeWindow,
  majorityDateOf,
} from '../common/age/age.util';
import {
  CountryAgePolicyService,
  type CountryAgePolicy,
} from '../common/age/country-age-policy.service';
import { ClubRole } from '../common/authorization/roles';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import {
  EmailService,
  type SendMajorityReleaseParams,
} from '../common/email/email.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { FamilyFeatureFlagsService } from './family-feature-flags.service';
import { GuardianSecurityNotificationsService } from './guardian-security-notifications.service';
import {
  NOT_REVOKED,
  findLiveAssignment,
  lockDependent,
} from './guardianship-queries';
import {
  MAJORITY_NOTICE_DAYS,
  MAJORITY_RELEASE_FROZEN_REASON,
  MIN_MAJORITY_PREFILTER_YEARS,
  RELEASE_ACCEPTANCE_DAYS,
  RELEASE_REMINDER_DAYS,
} from './guardianships.constants';
import {
  LINKED_DEVICE_REVOKER,
  type LinkedDeviceRevoker,
} from './linked-device-revoker.port';

export const FAMILY_MAJORITY_RELEASE_JOB = 'family-majority-release';
const LOCK_KEY = 'cron:family-majority-release';
/** Slightly under the 24h interval, like the other daily crons. */
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Club roles told about a custody-only minor (same as the custody transfer notice). */
const DIRECTOR_ROLES = [ClubRole.DIRECTOR, ClubRole.DEPUTY_DIRECTOR];

export const MAJORITY_NOTICE_SOURCE = 'family:majority:notice';
export const MAJORITY_RELEASED_SOURCE = 'family:majority:released';
export const MAJORITY_REMINDER_SOURCE = 'family:majority:reminder';
export const MAJORITY_FROZEN_SOURCE = 'family:majority:frozen';
export const MAJORITY_HANDOVER_SOURCE = 'family:majority:handover';

export type MajorityReleaseStep = 'notice' | 'release' | 'reminder' | 'freeze';

export interface MajorityReleaseSummary {
  noticed: number;
  released: number;
  reminded: number;
  frozen: number;
  /** Nobody to tell (no account, no verified guardian, no director). */
  skippedNoRecipient: number;
  /** NULL birthday or inactive user: never processed. */
  skippedNoBirthday: number;
  failed: number;
}

/** One row of the dry-run report: uuid only, never a name or an email. */
export interface MajorityReleaseDryRunItem {
  user_id: string;
  step: MajorityReleaseStep;
  /** ISO date (YYYY-MM-DD) of the majority; null when unreadable. */
  majorityDate: string | null;
  /** Only for the release step. */
  source?: 'cron' | 'catchup';
  country_id: number | null;
}

export interface MajorityReleaseRunOptions {
  dryRun?: boolean;
  /** Restricts every step to ONE dependent (QA, manual replays). */
  onlyDependentId?: string;
}

export interface MajorityReleaseRunResult {
  summary: MajorityReleaseSummary;
  /** Filled only on a dry run. */
  items: MajorityReleaseDryRunItem[];
}

interface ScanUser {
  name: string | null;
  email: string | null;
  birthday: Date | null;
  country_id: number | null;
  active: boolean | null;
  account: Array<{ id: string }>;
  supervised_login: { method: string } | null;
}

interface ScanRow {
  user_id: string;
  majority_notice_sent_at: Date | null;
  released_at: Date | null;
  release_deadline_at: Date | null;
  release_completed_at: Date | null;
  release_reminder_level: number;
  user: ScanUser | null;
}

type SendTask = () => Promise<unknown>;

const SCAN_USER_SELECT = {
  name: true,
  email: true,
  birthday: true,
  country_id: true,
  active: true,
  account: { select: { id: true }, take: 1 },
  supervised_login: { select: { method: true } },
} as const;

const SCAN_SELECT = {
  user_id: true,
  majority_notice_sent_at: true,
  released_at: true,
  release_deadline_at: true,
  release_completed_at: true,
  release_reminder_level: true,
  user: { select: SCAN_USER_SELECT },
} as const;

const formatDate = (date: Date): string =>
  `${String(date.getUTCDate()).padStart(2, '0')}/${String(
    date.getUTCMonth() + 1,
  ).padStart(2, '0')}/${date.getUTCFullYear()}`;

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Daily release at majority (Phase 4). Behind FAMILY_MAJORITY_RELEASE_ENABLED
 * (off => a recorded no-op) and FAMILY_MAJORITY_RELEASE_DRY_RUN (computes and
 * logs only). Steps (each idempotent, claimed with a compare-and-set):
 *
 *  0. ENSURE every guardianship dependent / supervised login has a
 *     `dependent_profiles` row (the tracking invariant; same SQL as migration
 *     20261113140000).
 *  1. NOTICE (T-30): the person (account holders), the verified guardians and,
 *     for a custody-only minor, the club directors.
 *  2. RELEASE (majority reached, per-country age policy and calendar): ONE
 *     transaction per person, under the dependent advisory lock, revokes EVERY
 *     guardianship with reason `released` (guardians, club custody, pending
 *     ones; no custody row is created, nobody is promoted), revokes the open
 *     link codes (never `adult_claim`) and the paired devices, stops the
 *     guardian-less clock and audits. After the commit the acting-for epoch is
 *     bumped and the person is told ("now independent"); an account-less
 *     person's former guardians / directors get the claim-code handover.
 *     The same path is the backfill/catch-up for adults found late (source
 *     'catchup', deadline = now + 30 days).
 *  3. REMINDERS at deadline-7d and deadline-1d (ruling R2: levels 1 and 2).
 *  4. FREEZE when the deadline passed without completing: `frozen_at` +
 *     `frozen_reason = 'majority_release'`, NEVER `purge_after` (ruling R6:
 *     never auto-deleted), sessions untouched (the person must still log in to
 *     accept, add an email, export or delete: R1 thaw), only the PERSON is
 *     told (ruling R3). `adult_claim` codes are NOT revoked: a claim is allowed
 *     while frozen, with no deadline (R6).
 *
 * Zero new `club_role_assignments` predicates: club custody directors are
 * found with {@link findLiveAssignment} and told with `sendToSectionRole`.
 */
@Injectable()
export class FamilyMajorityReleaseCronService {
  private readonly logger = new Logger(FamilyMajorityReleaseCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    private readonly countryAgePolicy: CountryAgePolicyService,
    private readonly notifications: NotificationsService,
    private readonly security: GuardianSecurityNotificationsService,
    private readonly flags: FamilyFeatureFlagsService,
    private readonly actingForCache: ActingForCache,
    private readonly audit: AuditLogsService,
    @Inject(LINKED_DEVICE_REVOKER)
    private readonly deviceRevoker: LinkedDeviceRevoker,
    private readonly email: EmailService,
  ) {}

  @Cron('30 9 * * *', { name: FAMILY_MAJORITY_RELEASE_JOB, timeZone: 'UTC' })
  async handleDaily(): Promise<void> {
    if (!this.flags.isEnabled('majority_release')) {
      await this.cronLogger.trackSkipped(
        FAMILY_MAJORITY_RELEASE_JOB,
        'flag_disabled',
      );
      return;
    }

    const acquired = await this.lockService.tryAcquire(LOCK_KEY, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.debug(
        'Another instance runs the family majority release job — skipping',
      );
      await this.cronLogger.trackSkipped(
        FAMILY_MAJORITY_RELEASE_JOB,
        'lock_not_acquired',
      );
      return;
    }

    try {
      await this.cronLogger.track(FAMILY_MAJORITY_RELEASE_JOB, async () => {
        const dryRun = this.flags.isMajorityReleaseDryRun();
        const { summary, items } = await this.run(new Date(), { dryRun });
        if (dryRun) {
          this.logger.log(
            JSON.stringify({
              event: 'majority_release_dry_run',
              planned: items.length,
              summary,
            }),
          );
        }
        if (summary.failed > 0) {
          // Fail the run so cron_run_log / CronAlertService report it. Every
          // step is idempotent and gave its claim back: tomorrow retries.
          throw new Error(
            `${summary.failed} majority release item(s) failed (retry next run); ${summary.noticed} noticed, ${summary.released} released, ${summary.reminded} reminded, ${summary.frozen} frozen`,
          );
        }
        return {
          itemsProcessed:
            summary.noticed +
            summary.released +
            summary.reminded +
            summary.frozen,
        };
      });
    } catch (error) {
      this.logger.error(
        `Error in the family majority release job: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await this.lockService.release(LOCK_KEY);
    }
  }

  async run(
    now: Date = new Date(),
    options: MajorityReleaseRunOptions = {},
  ): Promise<MajorityReleaseRunResult> {
    const ctx: RunContext = {
      now,
      dryRun: options.dryRun === true,
      onlyDependentId: options.onlyDependentId,
      policies: new Map(),
      summary: {
        noticed: 0,
        released: 0,
        reminded: 0,
        frozen: 0,
        skippedNoRecipient: 0,
        skippedNoBirthday: 0,
        failed: 0,
      },
      items: [],
    };

    if (!ctx.dryRun) {
      await this.ensureProfiles(ctx);
    }
    await this.noticeAndRelease(ctx);
    await this.remind(ctx);
    await this.freeze(ctx);
    return { summary: ctx.summary, items: ctx.items };
  }

  // ---------------------------------------------------------------------------
  // 0. Tracking invariant
  // ---------------------------------------------------------------------------

  private async ensureProfiles(ctx: RunContext): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO dependent_profiles (user_id, created_by_user_id, created_at)
        SELECT DISTINCT d.uid, d.uid, now()
        FROM (
          SELECT dependent_user_id AS uid FROM guardianships
          UNION
          SELECT user_id AS uid FROM supervised_logins
        ) d
        WHERE NOT EXISTS (SELECT 1 FROM dependent_profiles p WHERE p.user_id = d.uid)
        ON CONFLICT (user_id) DO NOTHING`;
    } catch (error) {
      ctx.summary.failed += 1;
      this.logFailure('majority_ensure_profiles_failed', null, error);
    }
  }

  // ---------------------------------------------------------------------------
  // 1 + 2. Notice (T-30) and release
  // ---------------------------------------------------------------------------

  private async noticeAndRelease(ctx: RunContext): Promise<void> {
    // Coarse prefilter: nobody born after this can reach ANY country's
    // majority within the notice window. The exact test is the country policy.
    const cutoff = new Date(
      ctx.now.getTime() + (MAJORITY_NOTICE_DAYS + 1) * DAY_MS,
    );
    cutoff.setUTCFullYear(
      cutoff.getUTCFullYear() - MIN_MAJORITY_PREFILTER_YEARS,
    );

    await this.forEachBatch(
      (cursor) =>
        this.prisma.dependent_profiles.findMany({
          where: {
            released_at: null,
            frozen_at: null,
            purged_at: null,
            user: {
              is: { active: true, birthday: { not: null, lte: cutoff } },
            },
            ...(ctx.onlyDependentId ? { user_id: ctx.onlyDependentId } : {}),
            ...(cursor ? { user_id: { gt: cursor } } : {}),
          },
          orderBy: { user_id: 'asc' },
          take: BATCH_SIZE,
          select: SCAN_SELECT,
        }),
      async (row) => {
        const user = row.user;
        if (!user || !user.birthday || user.active === false) {
          ctx.summary.skippedNoBirthday += 1;
          return;
        }
        const policy = await this.policyOf(ctx, user.country_id);
        const age = ageToday(user.birthday, policy.timeZone, ctx.now);
        if (age >= policy.ageOfMajority) {
          await this.releaseOne(ctx, row, user, policy);
          return;
        }
        if (
          row.majority_notice_sent_at === null &&
          isInMajorityNoticeWindow(
            user.birthday,
            policy.ageOfMajority,
            policy.timeZone,
            MAJORITY_NOTICE_DAYS,
            ctx.now,
          )
        ) {
          await this.noticeOne(ctx, row, user, policy);
        }
      },
      ctx,
      'majority_scan_failed',
    );
  }

  private async noticeOne(
    ctx: RunContext,
    row: ScanRow,
    user: ScanUser,
    policy: CountryAgePolicy,
  ): Promise<void> {
    const majority = majorityDateOf(
      user.birthday as Date,
      policy.ageOfMajority,
    );
    const majorityText = majority ? formatDate(majority) : '';
    if (ctx.dryRun) {
      ctx.items.push({
        user_id: row.user_id,
        step: 'notice',
        majorityDate: majority ? isoDate(majority) : null,
        country_id: user.country_id,
      });
      return;
    }

    const firstName = user.name?.trim() || 'Tu dependiente';
    const tasks: SendTask[] = [];
    if (this.holdsAccount(user)) {
      tasks.push(() =>
        this.send(
          row.user_id,
          'Pronto serás mayor de edad',
          `El ${majorityText} cumples la mayoría de edad. Ese día tus tutores dejarán de gestionar tu cuenta y tendrás ${RELEASE_ACCEPTANCE_DAYS} días para aceptar los términos vigentes.`,
          {
            type: 'majority_notice',
            majority_date: majority ? isoDate(majority) : '',
          },
          MAJORITY_NOTICE_SOURCE,
        ),
      );
    }
    const guardians = await this.security.recipientsOf(row.user_id);
    for (const guardianId of guardians?.guardianIds ?? []) {
      tasks.push(() =>
        this.send(
          guardianId,
          `${firstName} cumple la mayoría de edad`,
          `El ${majorityText} dejarás de gestionar el perfil de ${firstName}: pasará a ser una cuenta independiente.`,
          {
            type: 'majority_notice',
            dependent_user_id: row.user_id,
            majority_date: majority ? isoDate(majority) : '',
          },
          MAJORITY_NOTICE_SOURCE,
        ),
      );
    }
    if (!guardians) {
      // Custody-only minor: the club directors of the custodian section.
      const live = await findLiveAssignment(this.prisma, row.user_id);
      if (live) {
        tasks.push(() =>
          this.notifications.sendToSectionRole(
            live.clubSectionId,
            DIRECTOR_ROLES,
            'Un menor bajo custodia del club cumple la mayoría de edad',
            `${firstName} cumple la mayoría de edad el ${majorityText}. Dejará de estar bajo custodia del club.`,
            {
              type: 'majority_notice',
              dependent_user_id: row.user_id,
              clubSectionId: String(live.clubSectionId),
            },
            MAJORITY_NOTICE_SOURCE,
          ),
        );
      }
    }
    if (tasks.length === 0) {
      ctx.summary.skippedNoRecipient += 1;
      return;
    }

    // Claim first: only the instance that flips NULL -> now sends.
    const claim = await this.prisma.dependent_profiles.updateMany({
      where: {
        user_id: row.user_id,
        majority_notice_sent_at: null,
        released_at: null,
        frozen_at: null,
        purged_at: null,
      },
      data: { majority_notice_sent_at: ctx.now },
    });
    if (claim.count === 0) return;

    if (await this.allFailed(tasks)) {
      // Nothing got through: give the claim back so tomorrow tries again.
      await this.prisma.dependent_profiles.updateMany({
        where: { user_id: row.user_id, majority_notice_sent_at: ctx.now },
        data: { majority_notice_sent_at: null },
      });
      throw new Error('no majority notice could be sent');
    }
    ctx.summary.noticed += 1;
    // Email channel: the person only, after the claim is won (never twice).
    await this.mail(user.email, {
      kind: 'notice',
      majorityDate: majority ? isoDate(majority) : undefined,
    });
  }

  private async releaseOne(
    ctx: RunContext,
    row: ScanRow,
    user: ScanUser,
    policy: CountryAgePolicy,
  ): Promise<void> {
    const birthday = user.birthday as Date;
    const majority = majorityDateOf(birthday, policy.ageOfMajority);
    const today = calendarDateIn(policy.timeZone, ctx.now);
    // Majority older than one day = missed days or the backfill of an adult
    // found late: same release, shortened notice (the deadline is now + 30d).
    const source: 'cron' | 'catchup' =
      majority && today.getTime() - majority.getTime() > DAY_MS
        ? 'catchup'
        : 'cron';

    if (ctx.dryRun) {
      ctx.items.push({
        user_id: row.user_id,
        step: 'release',
        majorityDate: majority ? isoDate(majority) : null,
        source,
        country_id: user.country_id,
      });
      return;
    }

    const deadline = new Date(
      ctx.now.getTime() + RELEASE_ACCEPTANCE_DAYS * DAY_MS,
    );
    const revoked = await this.prisma.$transaction(async (tx) => {
      await lockDependent(tx, row.user_id);

      // Re-check under the lock: a corrected birthday wins over the scan.
      const fresh = await tx.users.findUnique({
        where: { user_id: row.user_id },
        select: { birthday: true, country_id: true, active: true },
      });
      if (!fresh?.birthday || fresh.active === false) return null;
      const freshPolicy = await this.policyOf(ctx, fresh.country_id);
      if (
        ageToday(fresh.birthday, freshPolicy.timeZone, ctx.now) <
        freshPolicy.ageOfMajority
      ) {
        return null;
      }

      const claim = await tx.dependent_profiles.updateMany({
        where: {
          user_id: row.user_id,
          released_at: null,
          frozen_at: null,
          purged_at: null,
        },
        data: {
          released_at: ctx.now,
          release_deadline_at: deadline,
          release_source: source,
          release_reminder_level: 0,
        },
      });
      if (claim.count === 0) return null;

      // ALL non-revoked rows (guardians, club custody, pending ones). No custody
      // row is created and nobody is promoted: the person is independent now.
      const holders = await tx.guardianships.findMany({
        where: { dependent_user_id: row.user_id, ...NOT_REVOKED },
        select: {
          guardianship_id: true,
          guardian_user_id: true,
          is_custodian: true,
          custodian_club_id: true,
        },
      });
      await tx.guardianships.updateMany({
        where: { dependent_user_id: row.user_id, ...NOT_REVOKED },
        data: {
          consent_status: 'revoked',
          revoked_at: ctx.now,
          revoked_reason: 'released',
        },
      });
      // Open codes die with the guardianship; an adult_claim code is the one
      // that must survive (it is how an account-less adult gets in).
      await tx.guardianship_link_codes.updateMany({
        where: {
          dependent_user_id: row.user_id,
          consumed_at: null,
          revoked_at: null,
          purpose: { not: 'adult_claim' },
        },
        data: { revoked_at: ctx.now },
      });
      await this.deviceRevoker.revokeAllForDependent(
        tx,
        row.user_id,
        'majority',
      );
      await tx.supervised_logins.updateMany({
        where: { user_id: row.user_id },
        data: { pending_since: null, pending_reminder_level: 0 },
      });
      await this.audit.recordEventOrThrow(
        {
          entity_type: 'dependent_profile',
          entity_id: row.user_id,
          action:
            source === 'catchup'
              ? 'family.majority.backfill_released'
              : 'family.majority.released',
          actor_kind: 'system',
          target_user_id: row.user_id,
          changes: {
            source,
            majority_date: majority ? isoDate(majority) : null,
            revoked_guardianships: holders.length,
            deadline_at: deadline.toISOString(),
          },
        },
        tx,
      );
      return holders;
    });
    if (revoked === null) return;

    // After the commit: acting grants and the supervised state moved.
    await this.actingForCache.bump(row.user_id);
    ctx.summary.released += 1;

    await this.afterRelease(ctx, row, user, revoked, deadline);
  }

  /** Notices after a committed release. A failure here never undoes the release. */
  private async afterRelease(
    ctx: RunContext,
    row: ScanRow,
    user: ScanUser,
    revoked: Array<{
      guardian_user_id: string | null;
      is_custodian: boolean;
    }>,
    deadline: Date,
  ): Promise<void> {
    try {
      const firstName = user.name?.trim() || 'Tu dependiente';
      if (this.holdsAccount(user)) {
        // Already completed under the lazy gate: nothing left to ask.
        if (row.release_completed_at) return;
        await this.send(
          row.user_id,
          'Ahora eres independiente',
          `Ya eres mayor de edad y tu cuenta es solo tuya. Acepta los términos vigentes antes del ${formatDate(deadline)} para seguir usando SACDIA.`,
          {
            type: 'majority_released',
            deadline_at: deadline.toISOString(),
          },
          MAJORITY_RELEASED_SOURCE,
        );
        await this.mail(user.email, { kind: 'released', deadlineAt: deadline });
        return;
      }

      // Account-less person: the claim code can only be issued on demand (the
      // plaintext leaves once in an HTTP response), so the former guardians and
      // the custody directors get a one-shot handover notice.
      const tasks: SendTask[] = [];
      const guardianIds = [
        ...new Set(
          revoked
            .map((holder) => holder.guardian_user_id)
            .filter((id): id is string => id !== null),
        ),
      ];
      for (const guardianId of guardianIds) {
        tasks.push(() =>
          this.send(
            guardianId,
            `${firstName} ya es mayor de edad`,
            `${firstName} dejó de estar bajo tu tutoría. Genera un código de acceso para que reclame su cuenta.`,
            { type: 'majority_handover', dependent_user_id: row.user_id },
            MAJORITY_HANDOVER_SOURCE,
          ),
        );
      }
      if (revoked.some((holder) => holder.is_custodian)) {
        const live = await findLiveAssignment(this.prisma, row.user_id);
        if (live) {
          tasks.push(() =>
            this.notifications.sendToSectionRole(
              live.clubSectionId,
              DIRECTOR_ROLES,
              `${firstName} ya es mayor de edad`,
              `${firstName} dejó la custodia del club. Genera un código de acceso para que reclame su cuenta.`,
              {
                type: 'majority_handover',
                dependent_user_id: row.user_id,
                clubSectionId: String(live.clubSectionId),
              },
              MAJORITY_HANDOVER_SOURCE,
            ),
          );
        }
      }
      if (tasks.length === 0) {
        ctx.summary.skippedNoRecipient += 1;
        return;
      }
      await Promise.allSettled(tasks.map((task) => task()));
    } catch (error) {
      this.logFailure('majority_release_notice_failed', row.user_id, error);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Reminders (deadline-7d and deadline-1d, ruling R2)
  // ---------------------------------------------------------------------------

  private async remind(ctx: RunContext): Promise<void> {
    await this.forEachBatch(
      (cursor) =>
        this.prisma.dependent_profiles.findMany({
          where: {
            released_at: { not: null },
            release_deadline_at: { gt: ctx.now },
            release_completed_at: null,
            frozen_at: null,
            purged_at: null,
            ...(ctx.onlyDependentId ? { user_id: ctx.onlyDependentId } : {}),
            ...(cursor ? { user_id: { gt: cursor } } : {}),
          },
          orderBy: { user_id: 'asc' },
          take: BATCH_SIZE,
          select: SCAN_SELECT,
        }),
      async (row) => {
        if (!row.released_at || !row.release_deadline_at) return;
        const days = Math.floor(
          (ctx.now.getTime() - row.released_at.getTime()) / DAY_MS,
        );
        const due = RELEASE_REMINDER_DAYS.filter((min) => days >= min).length;
        if (due <= row.release_reminder_level) return;

        if (ctx.dryRun) {
          ctx.items.push({
            user_id: row.user_id,
            step: 'reminder',
            majorityDate: null,
            country_id: row.user?.country_id ?? null,
          });
          return;
        }

        const user = row.user;
        const daysLeft = Math.max(
          1,
          Math.ceil(
            (row.release_deadline_at.getTime() - ctx.now.getTime()) / DAY_MS,
          ),
        );
        const recipients = await this.reminderRecipients(row, user);
        if (recipients.length === 0) {
          ctx.summary.skippedNoRecipient += 1;
          return;
        }

        const claim = await this.prisma.dependent_profiles.updateMany({
          where: {
            user_id: row.user_id,
            release_reminder_level: { lt: due },
            release_completed_at: null,
            frozen_at: null,
            purged_at: null,
          },
          data: { release_reminder_level: due },
        });
        if (claim.count === 0) return;

        const firstName = user?.name?.trim() || 'Tu dependiente';
        const holdsAccount = user ? this.holdsAccount(user) : false;
        const tasks = recipients.map(
          (recipientId) => () =>
            this.send(
              recipientId,
              holdsAccount
                ? 'Acepta los términos para mantener tu cuenta'
                : `${firstName} aún no reclama su cuenta`,
              holdsAccount
                ? `Te ${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft} días`} para aceptar los términos vigentes (fecha límite ${formatDate(row.release_deadline_at as Date)}).`
                : `${firstName} aún no reclama su cuenta. Puedes generar un código de acceso cuando quieras para que la reclame.`,
              {
                type: 'majority_reminder',
                days_left: String(daysLeft),
                deadline_at: (row.release_deadline_at as Date).toISOString(),
                ...(holdsAccount ? {} : { dependent_user_id: row.user_id }),
              },
              MAJORITY_REMINDER_SOURCE,
            ),
        );
        if (await this.allFailed(tasks)) {
          await this.prisma.dependent_profiles.updateMany({
            where: { user_id: row.user_id, release_reminder_level: due },
            data: { release_reminder_level: row.release_reminder_level },
          });
          throw new Error('no release reminder could be sent');
        }
        ctx.summary.reminded += 1;
        if (holdsAccount) {
          await this.mail(user?.email ?? null, {
            kind: 'reminder',
            daysLeft,
            deadlineAt: row.release_deadline_at,
          });
        }
      },
      ctx,
      'majority_reminder_failed',
    );
  }

  /** The person (account holders) or, for an account-less person, the former guardians. */
  private async reminderRecipients(
    row: ScanRow,
    user: ScanUser | null,
  ): Promise<string[]> {
    if (user && this.holdsAccount(user)) return [row.user_id];
    const former = await this.prisma.guardianships.findMany({
      where: {
        dependent_user_id: row.user_id,
        revoked_reason: 'released',
        guardian_user_id: { not: null },
      },
      select: { guardian_user_id: true },
    });
    return [
      ...new Set(
        former
          .map((holder) => holder.guardian_user_id)
          .filter((id): id is string => id !== null),
      ),
    ];
  }

  // ---------------------------------------------------------------------------
  // 4. Freeze
  // ---------------------------------------------------------------------------

  private async freeze(ctx: RunContext): Promise<void> {
    await this.forEachBatch(
      (cursor) =>
        this.prisma.dependent_profiles.findMany({
          where: {
            release_deadline_at: { lte: ctx.now },
            release_completed_at: null,
            frozen_at: null,
            purged_at: null,
            ...(ctx.onlyDependentId ? { user_id: ctx.onlyDependentId } : {}),
            ...(cursor ? { user_id: { gt: cursor } } : {}),
          },
          orderBy: { user_id: 'asc' },
          take: BATCH_SIZE,
          select: SCAN_SELECT,
        }),
      async (row) => {
        if (ctx.dryRun) {
          ctx.items.push({
            user_id: row.user_id,
            step: 'freeze',
            majorityDate: null,
            country_id: row.user?.country_id ?? null,
          });
          return;
        }
        const frozen = await this.prisma.$transaction(async (tx) => {
          await lockDependent(tx, row.user_id);
          // Re-check inside the lock: an accept that raced us wins.
          const claim = await tx.dependent_profiles.updateMany({
            where: {
              user_id: row.user_id,
              release_deadline_at: { lte: ctx.now },
              release_completed_at: null,
              frozen_at: null,
              purged_at: null,
            },
            // R6: NO purge_after. The freeze keeps data hidden and unprocessed
            // until the person returns; only they can ask for deletion.
            data: {
              frozen_at: ctx.now,
              frozen_reason: MAJORITY_RELEASE_FROZEN_REASON,
            },
          });
          if (claim.count === 0) return false;
          await this.audit.recordEventOrThrow(
            {
              entity_type: 'dependent_profile',
              entity_id: row.user_id,
              action: 'family.majority.frozen',
              actor_kind: 'system',
              target_user_id: row.user_id,
              changes: { frozen_reason: MAJORITY_RELEASE_FROZEN_REASON },
            },
            tx,
          );
          return true;
        });
        if (!frozen) return;

        await this.actingForCache.bump(row.user_id);
        ctx.summary.frozen += 1;
        // Ruling R3: only the PERSON is told, never the former guardians.
        if (row.user && this.holdsAccount(row.user)) {
          try {
            await this.send(
              row.user_id,
              'Tu cuenta está en pausa',
              'No aceptaste los términos a tiempo. Tus datos no se usan ni se eliminan: acepta los términos vigentes para reactivar tu cuenta.',
              { type: 'majority_frozen' },
              MAJORITY_FROZEN_SOURCE,
            );
            await this.mail(row.user.email, { kind: 'frozen' });
          } catch (error) {
            this.logFailure(
              'majority_freeze_notice_failed',
              row.user_id,
              error,
            );
          }
        }
      },
      ctx,
      'majority_freeze_failed',
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Keyset batches of 100 with a per-row try/catch (one bad row never stops the run). */
  private async forEachBatch(
    load: (cursor: string | undefined) => Promise<ScanRow[]>,
    handle: (row: ScanRow) => Promise<void>,
    ctx: RunContext,
    failureEvent: string,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const batch = await load(cursor);
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].user_id;
      for (const row of batch) {
        try {
          await handle(row);
        } catch (error) {
          ctx.summary.failed += 1;
          this.logFailure(failureEvent, row.user_id, error);
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }
  }

  private holdsAccount(user: ScanUser): boolean {
    return user.account.length > 0 || user.supervised_login !== null;
  }

  private async policyOf(
    ctx: RunContext,
    countryId: number | null,
  ): Promise<CountryAgePolicy> {
    const cached = ctx.policies.get(countryId);
    if (cached) return cached;
    const policy = await this.countryAgePolicy.getPolicy(countryId);
    ctx.policies.set(countryId, policy);
    return policy;
  }

  /**
   * Email channel of a PERSON notice (never of a guardian one): only when an
   * address is on file. EMAIL_ENABLED=false is handled by the queue processor.
   * A failure is logged and never blocks the step.
   */
  private async mail(
    to: string | null | undefined,
    params: Omit<SendMajorityReleaseParams, 'to'>,
  ): Promise<void> {
    if (!to) return;
    try {
      await this.email.sendMajorityRelease({ to, ...params });
    } catch (error) {
      this.logFailure('majority_release_email_failed', null, error);
    }
  }

  private send(
    userId: string,
    title: string,
    body: string,
    data: Record<string, string>,
    source: string,
  ): Promise<unknown> {
    return this.notifications.sendToUser(
      { userId, title, body, data },
      'system',
      source,
    );
  }

  /** True when EVERY send rejected (a partial delivery still counts as sent). */
  private async allFailed(tasks: SendTask[]): Promise<boolean> {
    const results = await Promise.allSettled(tasks.map((task) => task()));
    return results.every((result) => result.status === 'rejected');
  }

  private logFailure(event: string, userId: string | null, error: unknown) {
    this.logger.error(
      JSON.stringify({
        event,
        ...(userId ? { dependent: userId } : {}),
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

interface RunContext {
  now: Date;
  dryRun: boolean;
  onlyDependentId?: string;
  policies: Map<number | null, CountryAgePolicy>;
  summary: MajorityReleaseSummary;
  items: MajorityReleaseDryRunItem[];
}
