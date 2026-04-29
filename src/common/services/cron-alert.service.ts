import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { CronAlertCondition } from '../email/templates/cron-alert';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum consecutive failures before an alert fires. */
const CONSECUTIVE_FAILURES_THRESHOLD = 3;

/** Default maximum acceptable duration in ms (5 minutes). */
const DEFAULT_DURATION_THRESHOLD_MS = 5 * 60 * 1000;

/** Fraction of failures in 24 h that triggers a failure_rate alert. */
const FAILURE_RATE_THRESHOLD = 0.5;

/** Hours to wait before re-alerting the same (job_name, condition) pair. */
const DEDUPE_WINDOW_HOURS = 6;

/** Number of recent failed runs to include in the alert email body. */
const MAX_RECENT_FAILURES_IN_EMAIL = 5;

/** Global role names considered "super admin" for alert targeting. */
const ADMIN_ROLE_NAMES = ['super_admin'];

/** Source tag used when creating in-app notifications for system alerts. */
const ALERT_NOTIFICATION_SOURCE = 'system_alert:cron_failure';

// ─────────────────────────────────────────────────────────────────────────────
// Per-job duration overrides (ms). Add job names here to override the default.
// ─────────────────────────────────────────────────────────────────────────────
const JOB_DURATION_THRESHOLDS: Record<string, number> = {
  // Example: 'monthly-report-generation': 15 * 60 * 1000, // 15 min
};

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

interface FailedRun {
  run_id: number;
  started_at: Date;
  error_message: string | null;
  duration_ms: number | null;
}

interface AlertTrigger {
  jobName: string;
  condition: CronAlertCondition;
  conditionDetail: string;
  recentFailures: FailedRun[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CronAlertService
 *
 * Polls cron_run_log every 15 minutes and fires email + in-app alerts to
 * super_admin users when any of these conditions are met for a job:
 *
 *   1. consecutive_failures  — 3+ failures in a row (no successful run between them)
 *   2. duration              — latest run exceeded the expected duration threshold
 *   3. failure_rate          — >50% failure rate in the last 24 hours
 *
 * Deduplication: same (job_name, condition) pair will not re-alert within 6 h.
 * Alert history is persisted to cron_alerts_log for admin inspection.
 */
@Injectable()
export class CronAlertService {
  private readonly logger = new Logger(CronAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    @Optional()
    private readonly notificationsService: NotificationsService | null,
  ) {}

  // ── Scheduled check ────────────────────────────────────────────────────────

  @Cron('*/15 * * * *', { name: 'cron-alert-check' })
  async checkAndAlertFailures(): Promise<void> {
    this.logger.debug('CronAlertService: running failure check');

    try {
      const triggers = await this.detectAlertTriggers();

      if (triggers.length === 0) {
        this.logger.debug('CronAlertService: no alert conditions detected');
        return;
      }

      const adminUsers = await this.resolveAdminUsers();

      if (adminUsers.length === 0) {
        this.logger.warn(
          'CronAlertService: alert conditions found but no super_admin users to notify',
        );
        return;
      }

      for (const trigger of triggers) {
        await this.processAlert(trigger, adminUsers);
      }
    } catch (err) {
      this.logger.error(
        `CronAlertService: check failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Detection ──────────────────────────────────────────────────────────────

  private async detectAlertTriggers(): Promise<AlertTrigger[]> {
    const triggers: AlertTrigger[] = [];

    // Fetch all distinct job names that have at least one run in the last 24 h
    const jobNames = await this.prisma.$queryRaw<Array<{ job_name: string }>>`
      SELECT DISTINCT job_name
      FROM cron_run_log
      WHERE started_at > NOW() - INTERVAL '24 hours'
    `;

    for (const { job_name } of jobNames) {
      // ── 1. Consecutive failures ─────────────────────────────────────────
      const consecutiveTrigger = await this.checkConsecutiveFailures(job_name);
      if (consecutiveTrigger) triggers.push(consecutiveTrigger);

      // ── 2. Duration exceeded ────────────────────────────────────────────
      const durationTrigger = await this.checkDurationThreshold(job_name);
      if (durationTrigger) triggers.push(durationTrigger);

      // ── 3. Failure rate 24 h ────────────────────────────────────────────
      const rateTrigger = await this.checkFailureRate24h(job_name);
      if (rateTrigger) triggers.push(rateTrigger);
    }

    return triggers;
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async checkConsecutiveFailures(
    jobName: string,
  ): Promise<AlertTrigger | null> {
    // Fetch the last N runs ordered by most recent first
    const recentRuns = await this.prisma.cron_run_log.findMany({
      where: { job_name: jobName, status: { in: ['completed', 'failed'] } },
      orderBy: { started_at: 'desc' },
      take: CONSECUTIVE_FAILURES_THRESHOLD + 5, // small buffer
      select: {
        run_id: true,
        started_at: true,
        status: true,
        error_message: true,
        duration_ms: true,
      },
    });

    // Count consecutive failures from the most recent run
    let consecutiveCount = 0;
    const failedRuns: FailedRun[] = [];

    for (const run of recentRuns) {
      if (run.status === 'failed') {
        consecutiveCount++;
        failedRuns.push({
          run_id: run.run_id,
          started_at: run.started_at,
          error_message: run.error_message,
          duration_ms: run.duration_ms,
        });
      } else {
        break; // hit a success — streak ends
      }
    }

    if (consecutiveCount < CONSECUTIVE_FAILURES_THRESHOLD) {
      return null;
    }

    // Dedupe check
    const alreadyAlerted = await this.isRecentlyAlerted(
      jobName,
      'consecutive_failures',
    );
    if (alreadyAlerted) return null;

    return {
      jobName,
      condition: 'consecutive_failures',
      conditionDetail: `${consecutiveCount} consecutive failures (threshold: ${CONSECUTIVE_FAILURES_THRESHOLD})`,
      recentFailures: failedRuns.slice(0, MAX_RECENT_FAILURES_IN_EMAIL),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async checkDurationThreshold(
    jobName: string,
  ): Promise<AlertTrigger | null> {
    const threshold =
      JOB_DURATION_THRESHOLDS[jobName] ?? DEFAULT_DURATION_THRESHOLD_MS;

    // Look at runs in the last 1 hour that exceeded the threshold
    const slowRuns = await this.prisma.cron_run_log.findMany({
      where: {
        job_name: jobName,
        started_at: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        duration_ms: { gte: threshold },
        status: 'completed', // only completed runs — failed runs covered by other condition
      },
      orderBy: { started_at: 'desc' },
      take: 1,
      select: {
        run_id: true,
        started_at: true,
        error_message: true,
        duration_ms: true,
      },
    });

    if (slowRuns.length === 0) return null;

    const alreadyAlerted = await this.isRecentlyAlerted(jobName, 'duration');
    if (alreadyAlerted) return null;

    const run = slowRuns[0];
    return {
      jobName,
      condition: 'duration',
      conditionDetail: `Last run took ${run.duration_ms} ms (threshold: ${threshold} ms)`,
      recentFailures: [
        {
          run_id: run.run_id,
          started_at: run.started_at,
          error_message: run.error_message,
          duration_ms: run.duration_ms,
        },
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async checkFailureRate24h(
    jobName: string,
  ): Promise<AlertTrigger | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ total: bigint; failed: bigint }>
    >`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed
      FROM cron_run_log
      WHERE job_name = ${jobName}
        AND started_at > NOW() - INTERVAL '24 hours'
        AND status IN ('completed', 'failed')
    `;

    const { total, failed } = rows[0];
    const totalN = Number(total);
    const failedN = Number(failed);

    if (totalN === 0) return null;

    const rate = failedN / totalN;
    if (rate <= FAILURE_RATE_THRESHOLD) return null;

    const alreadyAlerted = await this.isRecentlyAlerted(
      jobName,
      'failure_rate',
    );
    if (alreadyAlerted) return null;

    // Get recent failed runs for the email body
    const recentFailures = await this.prisma.cron_run_log.findMany({
      where: {
        job_name: jobName,
        status: 'failed',
        started_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { started_at: 'desc' },
      take: MAX_RECENT_FAILURES_IN_EMAIL,
      select: {
        run_id: true,
        started_at: true,
        error_message: true,
        duration_ms: true,
      },
    });

    return {
      jobName,
      condition: 'failure_rate',
      conditionDetail: `${Math.round(rate * 100)}% failure rate over last 24 h (${failedN}/${totalN} runs failed; threshold: ${FAILURE_RATE_THRESHOLD * 100}%)`,
      recentFailures,
    };
  }

  // ── Deduplication ──────────────────────────────────────────────────────────

  private async isRecentlyAlerted(
    jobName: string,
    condition: CronAlertCondition,
  ): Promise<boolean> {
    const windowStart = new Date(
      Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count
      FROM cron_alerts_log
      WHERE job_name = ${jobName}
        AND condition = ${condition}
        AND alerted_at >= ${windowStart}
        AND resolved_at IS NULL
    `;

    return Number(rows[0]?.count ?? 0) > 0;
  }

  // ── Alert dispatch ─────────────────────────────────────────────────────────

  private async processAlert(
    trigger: AlertTrigger,
    adminUsers: Array<{ user_id: string; email: string }>,
  ): Promise<void> {
    const { jobName, condition, conditionDetail, recentFailures } = trigger;

    this.logger.warn(
      `CronAlertService: firing alert job=${jobName} condition=${condition}`,
    );

    // Persist alert record (deduplication anchor)
    const detailsJson = JSON.stringify({
      conditionDetail,
      runIds: recentFailures.map((r) => r.run_id),
    });

    const insertResult = await this.prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO cron_alerts_log (job_name, condition, details)
      VALUES (${jobName}, ${condition}, ${detailsJson}::jsonb)
      RETURNING id
    `;

    const alertRecord = { id: insertResult[0]?.id ?? 0 };

    this.logger.log(
      `CronAlertService: alert id=${alertRecord.id} persisted for job=${jobName}`,
    );

    // Build serializable failures for email payload
    const emailFailures = recentFailures.map((r) => ({
      run_id: r.run_id,
      started_at: r.started_at.toISOString(),
      error_message: r.error_message,
      duration_ms: r.duration_ms,
    }));

    // Send email + in-app notification to each admin user
    await Promise.allSettled(
      adminUsers.map(async (admin) => {
        // Email
        try {
          await this.emailService.sendCronAlert({
            email: admin.email,
            jobName,
            condition,
            conditionDetail,
            recentFailures: emailFailures,
            locale: 'es',
          });
        } catch (err) {
          this.logger.error(
            `CronAlertService: failed to enqueue email for user=${admin.user_id} — ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // In-app notification
        if (this.notificationsService) {
          try {
            await this.notificationsService.notifySafe(
              admin.user_id,
              `[SACDIA] Job ${jobName}: alerta`,
              conditionDetail,
              { alertId: String(alertRecord.id), jobName, condition },
              ALERT_NOTIFICATION_SOURCE,
            );
          } catch (err) {
            this.logger.error(
              `CronAlertService: failed to enqueue in-app notification for user=${admin.user_id} — ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else {
          this.logger.debug(
            `CronAlertService: NotificationsService not available — skipping in-app notification for user=${admin.user_id}`,
          );
        }
      }),
    );
  }

  // ── Admin user resolution ──────────────────────────────────────────────────

  private async resolveAdminUsers(): Promise<
    Array<{ user_id: string; email: string }>
  > {
    const assignments = await this.prisma.users_roles.findMany({
      where: {
        active: true,
        roles: {
          role_name: { in: ADMIN_ROLE_NAMES },
          role_category: 'GLOBAL',
          active: true,
        },
      },
      select: {
        user_id: true,
        users: {
          select: { email: true, active: true },
        },
      },
    });

    return assignments
      .filter(
        (a): a is typeof a & { users: { email: string; active: boolean } } =>
          !!a.users?.email && a.users.active === true,
      )
      .map((a) => ({ user_id: a.user_id, email: a.users.email }));
  }
}
