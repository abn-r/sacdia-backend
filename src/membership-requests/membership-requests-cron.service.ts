import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MembershipRequestsService } from './membership-requests.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';

@Injectable()
export class MembershipRequestsCronService {
  private readonly logger = new Logger(MembershipRequestsCronService.name);

  constructor(
    private readonly membershipRequestsService: MembershipRequestsService,
    private readonly lockService: DistributedLockService,
  ) {}

  /**
   * Runs every hour to expire stale pending membership requests.
   * Reads timeout from system_config (default: 8 days).
   */
  @Cron('0 * * * *', { name: 'membership-requests-expiry' })
  async handleExpiry(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(
      'cron:membership-requests-expiry',
      55 * 60 * 1000, // 55 min — slightly less than the 1-hour interval
    );
    if (!acquired) {
      this.logger.debug(
        'Another instance is handling membership request expiry — skipping',
      );
      return;
    }

    try {
      const count = await this.membershipRequestsService.expireStaleRequests();

      if (count > 0) {
        this.logger.log(`Expired ${count} stale membership request(s)`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error expiring stale membership requests: ${errorMessage}`,
      );
    } finally {
      await this.lockService.release('cron:membership-requests-expiry');
    }
  }
}
