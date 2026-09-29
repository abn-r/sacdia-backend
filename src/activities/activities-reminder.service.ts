import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ACTIVITY_BOARD_ROLE_NAMES, classIdsFromJson, parseActivityAudience } from './activity-audience';
import { calendarDateInTimeZone, toUtcDate } from './activity-series-dates';
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
   * Runs every 15 minutes.
   * Finds activities whose reminder has not been sent yet and whose
   * activity_date is today and activity_time is within the configured
   * reminder window from now. Sends a push notification to all section
   * members and marks the activity as reminder_sent = true.
   */
  @Cron('*/15 * * * *', { name: 'activities-reminder', timeZone: 'UTC' })
  async handleActivityReminders(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:activities-reminder',
      14 * 60 * 1000, // 14 min — slightly less than the 15-min interval
    );
    if (!acquired) {
      this.logger.debug(
        'Another instance is handling activity reminders — skipping',
      );
      await this.cronLogger.trackSkipped(
        'activities-reminder',
        'lock_not_acquired',
      );
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
            audience: true,
            classes: true,
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
          const [hours, minutes] = activity.activity_time
            .split(':')
            .map(Number);
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

            const payload = {
              title: 'Tu actividad está por comenzar',
              body: `${activity.name} empieza a las ${activity.activity_time}`,
              data: {
                type: 'activity',
                entity_id: String(activity.activity_id),
                action: 'reminder',
              },
            };
            const audience = parseActivityAudience(activity.audience);
            if (audience === 'board') {
              await this.notificationsService.sendToSectionRole(
                sectionId,
                [...ACTIVITY_BOARD_ROLE_NAMES],
                payload.title,
                payload.body,
                payload.data,
                'activities:reminder',
              );
            } else if (audience === 'classes') {
              await this.sendClassReminder(
                sectionId,
                classIdsFromJson(activity.classes),
                payload,
              );
            } else {
              await this.notificationsService.sendToClubMembers(
                sectionId,
                payload,
                'system',
                'activities:reminder',
              );
            }

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

  private async sendClassReminder(
    sectionId: number,
    classIds: number[],
    payload: {
      title: string;
      body: string;
      data: Record<string, string>;
    },
  ) {
    if (classIds.length === 0) return;

    const today = toUtcDate(calendarDateInTimeZone(new Date()));
    const year = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: today },
        end_date: { gte: today },
      },
      select: { year_id: true },
    });
    if (!year) return;

    const members = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        active: true,
        status: 'active',
        ecclesiastical_year_id: year.year_id,
      },
      select: { user_id: true },
    });
    const memberIds = [...new Set(members.map((row) => row.user_id))];
    if (memberIds.length === 0) return;

    const enrolled = await this.prisma.enrollments.findMany({
      where: {
        user_id: { in: memberIds },
        class_id: { in: classIds },
        active: true,
        record_kind: 'OPERATIONAL',
        ecclesiastical_year_id: year.year_id,
      },
      select: { user_id: true },
    });
    const recipients = new Set(enrolled.map((row) => row.user_id));
    const board = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        active: true,
        status: 'active',
        ecclesiastical_year_id: year.year_id,
        user_id: { in: memberIds },
        roles: { role_name: { in: [...ACTIVITY_BOARD_ROLE_NAMES] } },
      },
      select: { user_id: true },
    });
    for (const row of board) recipients.add(row.user_id);

    await Promise.all(
      [...recipients].map((userId) =>
        this.notificationsService.sendToUser(
          {
            userId,
            title: payload.title,
            body: payload.body,
            data: payload.data,
          },
          'system',
          'activities:reminder',
        ),
      ),
    );
  }
}
