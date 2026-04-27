import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MemberOfMonthService } from './member-of-month.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

@Injectable()
export class MemberOfMonthCronService {
  private readonly logger = new Logger(MemberOfMonthCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberOfMonthService: MemberOfMonthService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Runs on the 1st of each month at 00:05 UTC.
   * Evaluates the previous month's member of the month for all active club sections.
   * The slight offset (00:05 instead of 00:00) avoids any midnight boundary race conditions.
   *
   * Sections are processed in batches of BATCH_SIZE (parallel within each batch).
   * If total wall-clock time exceeds TIMEOUT_MS the cron stops and logs a warning.
   */
  @Cron('5 0 1 * *', { name: 'member-of-month-auto-evaluate', timeZone: 'UTC' })
  async handleAutoEvaluate(): Promise<void> {
    this.logger.log(
      'Member of Month cron triggered — starting auto-evaluation...',
    );

    await this.cronLogger.track('member-of-month-auto-evaluate', async () => {
      const BATCH_SIZE = 10;
      const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const startTime = Date.now();

      const now = new Date();
      const { month: prevMonth, year: prevYear } = this.getPreviousMonth(now);

      this.logger.log(
        `Evaluating member of the month for ${prevYear}-${String(prevMonth).padStart(2, '0')}`,
      );

      // Get all active club sections
      const activeSections = await this.prisma.club_sections.findMany({
        where: { active: true },
        select: { club_section_id: true, name: true },
      });

      if (activeSections.length === 0) {
        this.logger.log('No active club sections found. Skipping.');
        return { itemsProcessed: 0 };
      }

      this.logger.log(
        `Found ${activeSections.length} active section(s). Processing in batches of ${BATCH_SIZE}...`,
      );

      let successCount = 0;
      let skipCount = 0;
      let errorCount = 0;
      let processedCount = 0;

      for (let i = 0; i < activeSections.length; i += BATCH_SIZE) {
        if (Date.now() - startTime > TIMEOUT_MS) {
          this.logger.warn(
            `Cron timeout after ${processedCount} sections processed. ` +
              `${activeSections.length - i} section(s) remaining — will be evaluated next month's run.`,
          );
          break;
        }

        const batch = activeSections.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.allSettled(
          batch.map((section) =>
            this.memberOfMonthService.runEvaluation(
              section.club_section_id,
              prevMonth,
              prevYear,
            ),
          ),
        );

        batchResults.forEach((outcome, idx) => {
          const section = batch[idx];
          processedCount++;

          if (outcome.status === 'fulfilled') {
            if (outcome.value.winners.length === 0) {
              skipCount++;
              this.logger.debug(
                `Section ${section.club_section_id} (${section.name ?? 'unnamed'}): no winners found`,
              );
            } else {
              successCount++;
              this.logger.log(
                `Section ${section.club_section_id} (${section.name ?? 'unnamed'}): ${outcome.value.winners.length} winner(s) selected`,
              );
            }
          } else {
            errorCount++;
            const errorMessage =
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason);
            this.logger.error(
              `Failed to evaluate section ${section.club_section_id}: ${errorMessage}`,
            );
          }
        });
      }

      const elapsedMs = Date.now() - startTime;
      this.logger.log(
        `Cron completed: ${processedCount}/${activeSections.length} sections in ${elapsedMs}ms — ` +
          `${successCount} with winners, ${skipCount} with no data, ${errorCount} errors`,
      );

      return { itemsProcessed: successCount };
    });
  }

  private getPreviousMonth(date: Date): { month: number; year: number } {
    const currentMonth = date.getMonth() + 1;
    const currentYear = date.getFullYear();

    if (currentMonth === 1) {
      return { month: 12, year: currentYear - 1 };
    }

    return { month: currentMonth - 1, year: currentYear };
  }
}
