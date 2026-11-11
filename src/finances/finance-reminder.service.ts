import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { manualTriggerPayload } from '../common/services/cron-run-context';
import {
  BACKGROUND_JOBS_QUEUE,
  BackgroundJobName,
  FinanceReminderPayload,
} from '../background-jobs/background-jobs.types';
import { ClubRole } from '../common/authorization/roles';

export const FINANCE_REMINDER_SOURCE = 'finances:reminder';
export const FINANCE_REMINDER_CRON_KEY = 'finance-month-end-reminder';
export const FINANCE_REMINDER_TITLE = 'Registra tus movimientos del mes';
export const FINANCE_REMINDER_ROLES = [
  ClubRole.TREASURER,
  ClubRole.SECRETARY_TREASURER,
  ClubRole.DIRECTOR,
] as const;
export const FINANCE_REMINDER_TIME_ZONE = 'America/Mexico_City';

const SECTION_BATCH_SIZE = 500;

const SPANISH_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Year and month of `date` in the product time zone (Mexico City). */
export function financeReminderPeriod(date: Date): {
  year: number;
  month: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FINANCE_REMINDER_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const pick = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month') };
}

/**
 * Month-end reminder (day 25, 10:00 Mexico City): tells the treasurer,
 * secretary-treasurer and director of every active club section that has no
 * active movement in the current month to register them before the automatic
 * closing on day 1.
 *
 * Like the period closing, the cron enqueues a BullMQ job (retries + backoff)
 * and falls back to running inline when Redis is not available.
 *
 * Idempotency: a section that already has a `finances:reminder` notification
 * log created this month is skipped, so retries and a second run never send
 * the reminder twice. User preferences (reminders category) are applied by
 * NotificationsService.
 */
@Injectable()
export class FinanceReminderService {
  private readonly logger = new Logger(FinanceReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    @Optional()
    @InjectQueue(BACKGROUND_JOBS_QUEUE)
    private readonly queue: Queue | null,
  ) {}

  @Cron('0 10 25 * *', {
    name: FINANCE_REMINDER_CRON_KEY,
    timeZone: FINANCE_REMINDER_TIME_ZONE,
  })
  async handleMonthEndReminder(): Promise<void> {
    const { year, month } = financeReminderPeriod(new Date());
    const period = `${year}-${String(month).padStart(2, '0')}`;

    if (this.queue) {
      const jobData: FinanceReminderPayload = {
        triggeredAt: new Date().toISOString(),
        year,
        month,
        ...manualTriggerPayload(),
      };
      await this.queue.add(BackgroundJobName.FINANCE_REMINDER, jobData, {
        // Same job id for the month: a double fire of the cron is one job.
        jobId: `finance-reminder-${period}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 7 * 86_400 },
        removeOnFail: { age: 30 * 86_400 },
      });
      this.logger.log(`finance-reminder job enqueued for ${period}`);
      return;
    }

    this.logger.warn(
      `BullMQ queue unavailable — running finance reminders for ${period} directly (no retry)`,
    );
    const lockKey = `cron:${FINANCE_REMINDER_CRON_KEY}`;
    const acquired = await this.lockService.tryAcquire(
      lockKey,
      23 * 60 * 60 * 1000,
    );
    if (!acquired) {
      await this.cronLogger.trackSkipped(
        FINANCE_REMINDER_CRON_KEY,
        'lock_not_acquired',
      );
      return;
    }
    try {
      await this.runMonthEndReminders(year, month);
    } catch (error) {
      this.logger.error(
        `Fatal error in finance reminders cron: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await this.lockService.release(lockKey);
    }
  }

  /** Runs the reminders for one month. Called by the BullMQ processor and by the inline fallback. */
  async runMonthEndReminders(
    year: number,
    month: number,
  ): Promise<{ itemsProcessed: number }> {
    return this.cronLogger.track(FINANCE_REMINDER_CRON_KEY, async () => {
      const sections = await this.prisma.club_sections.findMany({
        where: {
          active: true,
          main_club_id: { not: null },
          clubs: { is: { active: true } },
        },
        select: {
          club_section_id: true,
          clubs: { select: { name: true } },
          club_types: { select: { name: true } },
        },
        orderBy: { club_section_id: 'asc' },
      });

      let sent = 0;
      for (let i = 0; i < sections.length; i += SECTION_BATCH_SIZE) {
        const batch = sections.slice(i, i + SECTION_BATCH_SIZE);
        const ids = batch.map((s) => s.club_section_id);

        const withMovements = await this.sectionsWithMovements(
          ids,
          year,
          month,
        );
        const alreadyNotified = await this.sectionsAlreadyNotified(
          ids,
          year,
          month,
        );

        for (const section of batch) {
          const id = section.club_section_id;
          if (withMovements.has(id) || alreadyNotified.has(id)) continue;

          await this.notificationsService.sendToSectionRole(
            id,
            [...FINANCE_REMINDER_ROLES],
            FINANCE_REMINDER_TITLE,
            this.buildBody(
              section.clubs?.name ?? '',
              section.club_types?.name ?? '',
              month,
            ),
            {
              type: 'finances_reminder',
              club_section_id: String(id),
              year: String(year),
              month: String(month),
            },
            FINANCE_REMINDER_SOURCE,
          );
          sent++;
        }
      }

      this.logger.log(
        `Finance reminders ${year}-${String(month).padStart(2, '0')}: ${sent} sections notified of ${sections.length}`,
      );
      return { itemsProcessed: sent };
    });
  }

  buildBody(clubName: string, sectionName: string, month: number): string {
    const monthName = SPANISH_MONTHS[month - 1] ?? String(month);
    return `${clubName} (${sectionName}) aún no tiene movimientos de ${monthName}. Se cierra automáticamente el día 1.`;
  }

  private async sectionsWithMovements(
    sectionIds: number[],
    year: number,
    month: number,
  ): Promise<Set<number>> {
    const rows = await this.prisma.finances.groupBy({
      by: ['club_section_id'],
      where: {
        active: true,
        year,
        month,
        club_section_id: { in: sectionIds },
      },
    });
    return new Set(
      rows
        .map((r) => r.club_section_id)
        .filter((id): id is number => id != null),
    );
  }

  /** Sections that already got this month's reminder (log created since the 1st). */
  private async sectionsAlreadyNotified(
    sectionIds: number[],
    year: number,
    month: number,
  ): Promise<Set<number>> {
    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const rows = await this.prisma.notification_logs.findMany({
      where: {
        source: FINANCE_REMINDER_SOURCE,
        target_type: 'section_role',
        target_id: { in: sectionIds.map(String) },
        created_at: { gte: monthStart },
      },
      select: { target_id: true },
      distinct: ['target_id'],
    });
    return new Set(
      rows.map((r) => Number(r.target_id)).filter((id) => Number.isInteger(id)),
    );
  }
}
