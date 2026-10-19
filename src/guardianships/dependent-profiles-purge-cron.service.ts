import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { isCertificateImportObjectKey } from '../certificate-bulk-imports/certificate-import-file-ref';
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
 *   1. R2 objects first: consent evidence files, the profile picture and the
 *      class / honor evidence files (class section evidence, honor requirement
 *      evidence and the honor certificate / document / images). If R2 fails the
 *      dependent is left untouched (nothing deleted in the DB, `purged_at` NOT
 *      set) so the next run retries it, and the run is reported as failed.
 *   2. One transaction: anonymize the users row (email stays NULL,
 *      active=false), delete health data (allergies, diseases, medicines),
 *      emergency contacts, the consent evidence rows, the class / honor
 *      evidence rows and the notification inbox rows, blank the honor file
 *      columns, null the external holder's name / phone on the guardianship
 *      rows, null IP/user agent on the legal acceptances, set
 *      `dependent_profiles.purged_at`.
 *
 * The users row is NOT hard-deleted (foreign keys from class progress, audit
 * and the guardianship rows kept for legal history). The guardianship rows
 * stay as evidence of who held the child, minus the external holder's contact
 * data; the class / honor progress rows stay, minus every file attached to them.
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
    const targets = await this.collectStorageTargets(dependentId);
    for (const [bucket, keys] of targets) {
      await this.fileStorage.deleteMany(bucket, [...keys]);
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
      // Class section evidence and honor evidence files (objects already gone).
      await tx.evidence_files.deleteMany({
        where: {
          OR: [
            { class_section_progress: { is: { user_id: dependentId } } },
            { users_honors: { is: { user_id: dependentId } } },
          ],
        },
      });
      await tx.requirement_evidence.deleteMany({
        where: { progress: { users_honors: { user_id: dependentId } } },
      });
      // The honor record stays; the files attached to it do not.
      await tx.users_honors.updateMany({
        where: { user_id: dependentId },
        data: { certificate: '', document: null, images: [] },
      });
      await tx.notification_deliveries.deleteMany({
        where: { user_id: dependentId },
      });
      // Who held the child stays on record; the external holder's contact data
      // does not.
      await tx.guardianships.updateMany({
        where: { dependent_user_id: dependentId },
        data: { external_name: null, external_phone: null },
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

  /**
   * Every R2 object that belongs to the dependent, grouped by bucket. LINK
   * evidence is an external URL and has no object. Values may be public URLs
   * or bare keys, so the key is extracted when the value is a URL of the
   * bucket and used as is otherwise.
   */
  private async collectStorageTargets(
    dependentId: string,
  ): Promise<Map<StorageBucketAlias, Set<string>>> {
    const [consentEvidence, user, evidenceFiles, requirementEvidence, honors] =
      await Promise.all([
        this.prisma.guardianship_consent_evidences.findMany({
          where: { guardianship: { dependent_user_id: dependentId } },
          select: { file_key: true },
        }),
        this.prisma.users.findUnique({
          where: { user_id: dependentId },
          select: { user_image: true },
        }),
        this.prisma.evidence_files.findMany({
          where: {
            OR: [
              { class_section_progress: { is: { user_id: dependentId } } },
              { users_honors: { is: { user_id: dependentId } } },
            ],
          },
          select: { file_url: true, section_progress_id: true },
        }),
        this.prisma.requirement_evidence.findMany({
          where: { progress: { users_honors: { user_id: dependentId } } },
          select: { url: true, evidence_type: true },
        }),
        this.prisma.users_honors.findMany({
          where: { user_id: dependentId },
          select: { certificate: true, document: true, images: true },
        }),
      ]);

    const targets = new Map<StorageBucketAlias, Set<string>>();
    const add = (bucket: StorageBucketAlias, key: string | null) => {
      if (!key) return;
      const keys = targets.get(bucket) ?? new Set<string>();
      keys.add(key);
      targets.set(bucket, keys);
    };
    const addValue = (bucket: StorageBucketAlias, value: unknown) => {
      if (typeof value !== 'string' || value.trim() === '') return;
      add(
        bucket,
        this.fileStorage.extractKeyFromPublicUrl(bucket, value) ?? value,
      );
    };
    // Honor files uploaded through a certificate import live in their own bucket.
    const honorBucket = (fallback: StorageBucketAlias, value: unknown) =>
      typeof value === 'string' && isCertificateImportObjectKey(value)
        ? StorageBucketAlias.CERTIFICATE_IMPORTS
        : fallback;

    for (const row of consentEvidence) {
      add(StorageBucketAlias.GUARDIANSHIP_EVIDENCE, row.file_key);
    }
    addValue(StorageBucketAlias.USER_PROFILES, user?.user_image);

    for (const file of evidenceFiles) {
      addValue(
        file.section_progress_id !== null
          ? StorageBucketAlias.CLASS_EVIDENCE
          : honorBucket(StorageBucketAlias.USERS_HONORS, file.file_url),
        file.file_url,
      );
    }
    for (const evidence of requirementEvidence) {
      if (evidence.evidence_type !== 'LINK') {
        addValue(StorageBucketAlias.EVIDENCE_FILES, evidence.url);
      }
    }
    for (const honor of honors) {
      addValue(
        honorBucket(StorageBucketAlias.USERS_HONORS_CERT, honor.certificate),
        honor.certificate,
      );
      addValue(
        honorBucket(StorageBucketAlias.USERS_HONORS, honor.document),
        honor.document,
      );
      const images: unknown[] = Array.isArray(honor.images) ? honor.images : [];
      for (const image of images) {
        addValue(honorBucket(StorageBucketAlias.USERS_HONORS, image), image);
      }
    }
    return targets;
  }
}
