import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

@Injectable()
export class ActivitiesReminderService {
  private readonly logger = new Logger(ActivitiesReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs every 5 minutes.
   * Finds activities whose reminder has not been sent yet and whose
   * activity_date is today and activity_time is within the configured
   * reminder window from now. Sends a push notification to all section
   * members and marks the activity as reminder_sent = true.
   */
  @Cron('*/5 * * * *', { name: 'activities-reminder', timeZone: 'UTC' })
  async handleActivityReminders(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:activities-reminder',
      4 * 60 * 1000, // 4 min — slightly less than the 5-min interval
    );
    if (!acquired) {
      this.logger.debug(
        'Another instance is handling activity reminders — skipping',
      );
      await this.cronLogger.trackSkipped('activities-reminder', 'lock_not_acquired');
      return;
    }

    // IMPORTANT: Reminder times are calculated in server timezone.
    // If the server runs in UTC and clubs operate in a different timezone,
    // reminders may fire at incorrect times. Future improvement: store
    // timezone per club/section and adjust calculations accordingly.
    this.logger.debug('Activity reminder cron triggered');

    try {
      await this.cronLogger.track('activities-reminder', async () => {
        // 1. Read reminder minutes from system_config (default: 60)
        const config = await this.prisma.system_config.findUnique({
          where: { config_key: 'activity_reminder_minutes_before' },
        });

        const reminderMinutes = config ? parseInt(config.config_value, 10) : 60;

        const effectiveMinutes =
          isNaN(reminderMinutes) || reminderMinutes < 0 ? 60 : reminderMinutes;

        // 2. Build the current date boundaries (start-of-day / end-of-day)
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        // 3. Query activities: active, reminder not sent, date is today
        const candidates = await this.prisma.activities.findMany({
          where: {
            active: true,
            reminder_sent: false,
            activity_date: {
              gte: startOfToday,
              lte: endOfToday,
            },
            club_section_id: { not: null },
          },
          select: {
            activity_id: true,
            name: true,
            activity_time: true,
            club_section_id: true,
          },
        });

        if (candidates.length === 0) {
          this.logger.debug('No candidate activities for reminder today');
          return { itemsProcessed: 0 };
        }

        // 4. Filter by reminder window: now + reminderMinutes >= activity datetime
        const nowMs = now.getTime();
        const windowMs = effectiveMinutes * 60 * 1000;

        const toNotify = candidates.filter((activity) => {
          const [hours, minutes] = activity.activity_time.split(':').map(Number);
          if (isNaN(hours) || isNaN(minutes)) return false;

          const activityDatetime = new Date(now);
          activityDatetime.setHours(hours, minutes, 0, 0);

          const activityMs = activityDatetime.getTime();

          // Send reminder if activity starts within the window and hasn't started yet
          return activityMs > nowMs && activityMs - nowMs <= windowMs;
        });

        if (toNotify.length === 0) {
          this.logger.debug(
            `No activities within the ${effectiveMinutes}-minute reminder window`,
          );
          return { itemsProcessed: 0 };
        }

        this.logger.log(
          `Sending reminders for ${toNotify.length} activity(ies) (window: ${effectiveMinutes} min)`,
        );

        let sentCount = 0;

        for (const activity of toNotify) {
          try {
            const sectionId = activity.club_section_id;
            if (sectionId == null) continue;

            // 5. Send notification to section members
            await this.notificationsService.sendToClubMembers(
              sectionId,
              {
                title: 'Recordatorio de actividad',
                body: `${activity.name} comienza a las ${activity.activity_time}`,
                data: {
                  type: 'activity',
                  entity_id: String(activity.activity_id),
                  action: 'reminder',
                },
              },
              'system',
              'activities:reminder',
            );

            // 6. Mark reminder as sent
            await this.prisma.activities.update({
              where: { activity_id: activity.activity_id },
              data: { reminder_sent: true },
            });

            sentCount++;
            this.logger.log(
              `Reminder sent for activity ${activity.activity_id} "${activity.name}" at ${activity.activity_time}`,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to process reminder for activity ${activity.activity_id}: ${message}`,
            );
          }
        }

        this.logger.log(`Activity reminders complete: ${sentCount} sent`);
        return { itemsProcessed: sentCount };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Fatal error in activity reminder cron: ${message}`);
    } finally {
      await this.lockService.release('cron:activities-reminder');
    }
  }
}
