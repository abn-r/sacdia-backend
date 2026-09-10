import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { YearCutService } from './year-cut.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

/** Distributed lock TTL (~23 hours in ms) — appropriate for a daily job. */
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;

/** Stable job name stored in cron_run_log. */
export const YEAR_CUT_JOB_NAME = 'ecclesiastical-year-cut';

/** Distributed lock key. */
export const YEAR_CUT_LOCK_KEY = 'cron:ecclesiastical-year-cut';

@Injectable()
export class YearCutCronService implements OnModuleInit {
  private readonly logger = new Logger(YearCutCronService.name);

  constructor(
    private readonly yearCutService: YearCutService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
  ) {}

  /**
   * Recover a missed cut after restart. Same applyCut path as the daily job;
   * idempotent via club/year ledger.
   */
  async onModuleInit(): Promise<void> {
    await this.handleYearCut();
  }

  /**
   * Daily ecclesiastical-year cut at 06:05 UTC (~00:05 CST / ~23:05 CDT Mexico).
   *
   * Ends expired cargos by calendar date, activates scheduled director plans,
   * and leaves returning people not enrolled. Does not activate leftover
   * designated CRA rows.
   *
   * Does NOT call YearEndService.closeYear.
   * Does NOT blacklist JWT tokens.
   */
  @Cron('5 6 * * *', { name: YEAR_CUT_JOB_NAME, timeZone: 'UTC' })
  async handleYearCut(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      YEAR_CUT_LOCK_KEY,
      LOCK_TTL_MS,
    );

    if (!acquired) {
      this.logger.debug(
        'Another instance is handling the year cut — skipping',
      );
      await this.cronLogger.trackSkipped(YEAR_CUT_JOB_NAME, 'lock_not_acquired');
      return;
    }

    try {
      await this.cronLogger.track(YEAR_CUT_JOB_NAME, async () => {
        const summary = await this.yearCutService.applyCut();

        this.logger.log(
          `Year cut finished: ended=${summary.ended}, activated=${summary.activated}, ` +
            `returnedNotEnrolled=${summary.returnedNotEnrolled}, usersInvalidated=${summary.usersInvalidated}`,
        );

        return {
          itemsProcessed:
            summary.ended + summary.activated + summary.returnedNotEnrolled,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Year cut cron failed: ${message}`);
    } finally {
      await this.lockService.release(YEAR_CUT_LOCK_KEY);
    }
  }
}
