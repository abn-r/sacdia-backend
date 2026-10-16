import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { CronRunLogger } from '../common/services/cron-run-logger.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';

export const DEPENDENT_PROFILES_PURGE_JOB = 'dependent-profiles-purge';
const LOCK_KEY = 'cron:dependent-profiles-purge';
/** Slightly under the 24h interval, like the other daily crons. */
const LOCK_TTL_MS = 23 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

export interface PurgeSummary {
  purged: number;
  failed: number;
}

/**
 * Daily purge of FROZEN dependents whose 90 days elapsed (ruling A9: the
 * profile is anonymized AND its personal data is hard-deleted).
 *
 * Per dependent:
 *   1. R2 objects first: consent evidence files and the profile picture. If R2
 *      fails the dependent is left untouched (nothing deleted in the DB,
 *      `purged_at` NOT set) so the next run retries it, and the run is
 *      reported as failed.
 *   2. One transaction: anonymize the users row (email stays NULL,
 *      active=false), delete health data (allergies, diseases, medicines),
 *      emergency contacts and the consent evidence rows, null IP/user agent on
 *      the legal acceptances, set `dependent_profiles.purged_at`.
 *
 * The users row is NOT hard-deleted (foreign keys from class progress, audit
 * and the guardianship rows kept for legal history). The guardianship rows
 * stay as evidence of who held the child.
 */
@Injectable()
export class DependentProfilesPurgeCronService {
  private readonly logger = new Logger(DependentProfilesPurgeCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: DistributedLockService,
    private readonly cronLogger: CronRunLogger,
    private readonly actingForCache: ActingForCache,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  @Cron('20 4 * * *', { name: DEPENDENT_PROFILES_PURGE_JOB, timeZone: 'UTC' })
  async handlePurge(): Promise<void> {
    const acquired = await this.lockService.tryAcquire(LOCK_KEY, LOCK_TTL_MS);
    if (!acquired) {
      this.logger.debug(
        'Another instance is purging dependent profiles — skipping',
      );
      await this.cronLogger.trackSkipped(
        DEPENDENT_PROFILES_PURGE_JOB,
        'lock_not_acquired',
      );
      return;
    }

    try {
      await this.cronLogger.track(DEPENDENT_PROFILES_PURGE_JOB, async () => {
        const summary = await this.purgeDue();
        if (summary.purged > 0) {
          this.logger.log(`Purged ${summary.purged} dependent profile(s)`);
        }
        if (summary.failed > 0) {
          // Fail the run so cron_run_log / CronAlertService report it. The
          // failed dependents keep purged_at NULL and are retried next run.
          throw new Error(
            `${summary.failed} dependent profile(s) could not be purged (retry next run); ${summary.purged} purged`,
          );
        }
        return { itemsProcessed: summary.purged };
      });
    } catch (error) {
      this.logger.error(
        `Error purging dependent profiles: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await this.lockService.release(LOCK_KEY);
    }
  }

  /** Purges every due dependent in batches of 100. */
  async purgeDue(now: Date = new Date()): Promise<PurgeSummary> {
    let purged = 0;
    const failedIds: string[] = [];

    for (;;) {
      const batch = await this.prisma.dependent_profiles.findMany({
        where: {
          frozen_at: { not: null },
          purged_at: null,
          purge_after: { lte: now },
          ...(failedIds.length > 0 ? { user_id: { notIn: failedIds } } : {}),
        },
        orderBy: { purge_after: 'asc' },
        take: BATCH_SIZE,
        select: { user_id: true },
      });
      if (batch.length === 0) break;

      for (const { user_id: dependentId } of batch) {
        try {
          await this.purgeOne(dependentId, now);
          purged += 1;
        } catch (error) {
          failedIds.push(dependentId);
          this.logger.error(
            JSON.stringify({
              event: 'dependent_purge_failed',
              dependent: dependentId,
              reason: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      if (batch.length < BATCH_SIZE) break;
    }

    return { purged, failed: failedIds.length };
  }

  private async purgeOne(dependentId: string, now: Date): Promise<void> {
    // R2 first: if it fails nothing else changed and the next run retries.
    const [evidence, user] = await Promise.all([
      this.prisma.guardianship_consent_evidences.findMany({
        where: { guardianship: { dependent_user_id: dependentId } },
        select: { file_key: true },
      }),
      this.prisma.users.findUnique({
        where: { user_id: dependentId },
        select: { user_image: true },
      }),
    ]);

    const evidenceKeys = evidence.map((row) => row.file_key);
    if (evidenceKeys.length > 0) {
      await this.fileStorage.deleteMany(
        StorageBucketAlias.GUARDIANSHIP_EVIDENCE,
        evidenceKeys,
      );
    }
    if (user?.user_image) {
      const key = this.fileStorage.extractKeyFromPublicUrl(
        StorageBucketAlias.USER_PROFILES,
        user.user_image,
      );
      await this.fileStorage.deleteMany(StorageBucketAlias.USER_PROFILES, [
        key ?? user.user_image,
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.users.update({
        where: { user_id: dependentId },
        data: {
          active: false,
          email: null,
          name: null,
          paternal_last_name: null,
          maternal_last_name: null,
          birthday: null,
          blood: null,
          user_image: null,
          gender: null,
          baptism_date: null,
          country_id: null,
          union_id: null,
          local_field_id: null,
        },
      });
      await tx.emergency_contacts.deleteMany({
        where: { owner_id: dependentId },
      });
      await tx.users_allergies.deleteMany({ where: { user_id: dependentId } });
      await tx.users_diseases.deleteMany({ where: { user_id: dependentId } });
      await tx.users_medicines.deleteMany({ where: { user_id: dependentId } });
      await tx.guardianship_consent_evidences.deleteMany({
        where: { guardianship: { dependent_user_id: dependentId } },
      });
      await tx.legal_acceptances.updateMany({
        where: { user_id: dependentId },
        data: { ip_address: null, user_agent: null },
      });
      await tx.dependent_profiles.update({
        where: { user_id: dependentId },
        data: { purged_at: now },
      });
    });

    await this.actingForCache.bump(dependentId);
  }
}
