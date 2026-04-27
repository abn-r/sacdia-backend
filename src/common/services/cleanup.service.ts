import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { CronRunLogger } from './cron-run-logger.service';

/**
 * CleanupService — Scheduled cleanup of expired database records.
 *
 * Runs every 6 hours to delete:
 *   - Expired sessions (`sessions.expires_at < NOW()`)
 *   - Expired verification tokens (`verification.expires_at < NOW()`)
 *     (TOTP records use expiresAt = 2099-01-01, so they are safe from cleanup.)
 *
 * Runs nightly at 03:00 UTC to delete:
 *   - Inactive FCM tokens (`active = false` and `modified_at < NOW() - 90 days`)
 *     Tokens are marked inactive by NotificationsProcessor when FCM returns permanent error codes.
 *
 * Uses Prisma `deleteMany` with a `where` clause — no raw SQL, no table scans.
 * Logs the count of deleted rows for observability.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Deletes sessions and verification tokens that have already expired.
   * Runs every 6 hours.
   *
   * Schedule: 0 * /6 * * * (every 6 hours, on the hour)
   * Using EVERY_6_HOURS from CronExpression as a readable constant.
   */
  @Cron(CronExpression.EVERY_6_HOURS, { timeZone: 'UTC' })
  async cleanupExpiredRecords(): Promise<void> {
    const now = new Date();

    try {
      await this.cronLogger.track('cleanup-expired-records', async () => {
        const [deletedSessions, deletedVerifications] = await Promise.all([
          this.prisma.session.deleteMany({
            where: { expiresAt: { lt: now } },
          }),
          this.prisma.verification.deleteMany({
            where: { expiresAt: { lt: now } },
          }),
        ]);

        this.logger.log(
          `Expired record cleanup completed: removed ${deletedSessions.count} session(s) and ${deletedVerifications.count} verification token(s)`,
        );

        return {
          itemsProcessed: deletedSessions.count + deletedVerifications.count,
        };
      });
    } catch (error) {
      this.logger.error(
        `Expired record cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Deletes FCM tokens that have been marked inactive for more than 90 days.
   * Tokens are deactivated by NotificationsProcessor when FCM returns a permanent
   * error code (e.g. UNREGISTERED, INVALID_ARGUMENT) for a given token.
   *
   * Schedule: 0 3 * * * (daily at 03:00 UTC — outside peak windows of other jobs)
   * Using CronExpression.EVERY_DAY_AT_3AM.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'fcm-tokens-cleanup',
    timeZone: 'UTC',
  })
  async cleanupInactiveFcmTokens(): Promise<void> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    this.logger.log(
      `FCM token cleanup started: targeting inactive tokens with modified_at < ${cutoff.toISOString()}`,
    );

    try {
      await this.cronLogger.track('fcm-tokens-cleanup', async () => {
        const { count } = await this.prisma.user_fcm_tokens.deleteMany({
          where: {
            active: false,
            modified_at: { lt: cutoff },
          },
        });

        this.logger.log(
          `FCM token cleanup completed: removed ${count} inactive token(s) older than 90 days`,
        );

        return { itemsProcessed: count };
      });
    } catch (error) {
      this.logger.error(
        `FCM token cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
