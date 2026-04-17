import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CleanupService — Scheduled cleanup of expired database records.
 *
 * Runs every 6 hours to delete:
 *   - Expired sessions (`sessions.expires_at < NOW()`)
 *   - Expired verification tokens (`verification.expires_at < NOW()`)
 *     (TOTP records use expiresAt = 2099-01-01, so they are safe from cleanup.)
 *
 * Uses Prisma `deleteMany` with a `where` clause — no raw SQL, no table scans.
 * Logs the count of deleted rows for observability.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deletes sessions and verification tokens that have already expired.
   * Runs every 6 hours.
   *
   * Schedule: 0 * /6 * * * (every 6 hours, on the hour)
   * Using EVERY_6_HOURS from CronExpression as a readable constant.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async cleanupExpiredRecords(): Promise<void> {
    const now = new Date();

    try {
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
    } catch (error) {
      this.logger.error(
        `Expired record cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
