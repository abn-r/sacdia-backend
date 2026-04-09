import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MemberOfMonthService } from './member-of-month.service';

@Injectable()
export class MemberOfMonthCronService {
  private readonly logger = new Logger(MemberOfMonthCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberOfMonthService: MemberOfMonthService,
  ) {}

  /**
   * Runs on the 1st of each month at 00:05 UTC.
   * Evaluates the previous month's member of the month for all active club sections.
   * The slight offset (00:05 instead of 00:00) avoids any midnight boundary race conditions.
   */
  @Cron('5 0 1 * *', { name: 'member-of-month-auto-evaluate' })
  async handleAutoEvaluate(): Promise<void> {
    this.logger.log('Member of Month cron triggered — starting auto-evaluation...');

    const now = new Date();
    const { month: prevMonth, year: prevYear } = this.getPreviousMonth(now);

    this.logger.log(`Evaluating member of the month for ${prevYear}-${String(prevMonth).padStart(2, '0')}`);

    // Get all active club sections
    const activeSections = await this.prisma.club_sections.findMany({
      where: { active: true },
      select: { club_section_id: true, name: true },
    });

    if (activeSections.length === 0) {
      this.logger.log('No active club sections found. Skipping.');
      return;
    }

    this.logger.log(`Found ${activeSections.length} active section(s). Processing...`);

    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const section of activeSections) {
      try {
        const result = await this.memberOfMonthService.runEvaluation(
          section.club_section_id,
          prevMonth,
          prevYear,
        );

        if (result.winners.length === 0) {
          skipCount++;
          this.logger.debug(
            `Section ${section.club_section_id} (${section.name ?? 'unnamed'}): no winners found`,
          );
        } else {
          successCount++;
          this.logger.log(
            `Section ${section.club_section_id} (${section.name ?? 'unnamed'}): ${result.winners.length} winner(s) selected`,
          );
        }
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to evaluate section ${section.club_section_id}: ${errorMessage}`,
        );
      }
    }

    this.logger.log(
      `Auto-evaluation complete for ${prevYear}-${String(prevMonth).padStart(2, '0')}: ` +
        `${successCount} with winners, ${skipCount} with no data, ${errorCount} errors`,
    );
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
