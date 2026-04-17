import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap, Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import { EmailService } from './email.service';

export const DATA_EXPORTS_QUEUE = 'data-exports';
export const DATA_EXPORT_GENERATE_JOB = 'data-export.generate';

export interface DataExportGenerateJobData {
  exportId: string;
  userId: string;
}

const SIX_MONTHS_AGO_SQL = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d;
};

@Processor(DATA_EXPORTS_QUEUE)
export class DataExportProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(DataExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  onApplicationBootstrap() {
    this.worker.on('error', (err: Error) => {
      this.logger.error(`DataExport worker error: ${err.message}`, err.stack);
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      this.logger.error(
        `DataExport job ${job?.id ?? 'unknown'} failed: ${err.message}`,
      );
    });
  }

  async process(
    job: Job<DataExportGenerateJobData, unknown, typeof DATA_EXPORT_GENERATE_JOB>,
  ) {
    const { exportId, userId } = job.data;
    this.logger.log(`Processing data export job: exportId=${exportId}, userId=${userId}`);

    // -----------------------------------------------------------------------
    // Step 1: Fetch row — abort if not pending (idempotency guard)
    // -----------------------------------------------------------------------
    const exportRow = await this.prisma.data_export_requests.findUnique({
      where: { export_id: exportId },
    });

    if (!exportRow) {
      this.logger.warn(`Export row not found: exportId=${exportId} — aborting`);
      return { skipped: true, reason: 'not_found' };
    }

    // Defense in depth: verify ownership
    if (exportRow.user_id !== userId) {
      this.logger.error(
        `Ownership mismatch: job userId=${userId} vs row userId=${exportRow.user_id} — aborting`,
      );
      return { skipped: true, reason: 'ownership_mismatch' };
    }

    if (exportRow.status !== 'pending') {
      this.logger.warn(
        `Export ${exportId} is ${exportRow.status}, not pending — aborting (idempotent)`,
      );
      return { skipped: true, reason: 'not_pending' };
    }

    // -----------------------------------------------------------------------
    // Step 2: Transition to 'processing'
    // -----------------------------------------------------------------------
    await this.prisma.data_export_requests.update({
      where: { export_id: exportId },
      data: { status: 'processing', started_at: new Date() },
    });

    try {
      // -------------------------------------------------------------------
      // Step 3: Collect user data from Prisma
      // -------------------------------------------------------------------
      const sixMonthsAgo = SIX_MONTHS_AGO_SQL();

      const [
        user,
        honors,
        classesProgress,
        clubRoles,
        fcmTokens,
        notificationDeliveries,
        sessions,
        notificationPreferences,
        evidenceFiles,
      ] = await Promise.all([
        // User profile — exclude sensitive auth fields
        this.prisma.users.findUnique({
          where: { user_id: userId },
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
            email: true,
            gender: true,
            birthday: true,
            blood: true,
            baptism: true,
            baptism_date: true,
            email_verified: true,
            user_image: true,
            active: true,
            approval_status: true,
            created_at: true,
            modified_at: true,
            country_id: true,
            union_id: true,
            local_field_id: true,
            access_app: true,
          },
        }),

        // Honors
        this.prisma.users_honors.findMany({
          where: { user_id: userId },
          select: {
            user_honor_id: true,
            honor_id: true,
            active: true,
            validate: true,
            validation_status: true,
            submitted_at: true,
            validated_at: true,
            rejection_reason: true,
            date: true,
            created_at: true,
            modified_at: true,
          },
        }),

        // Class section progress
        this.prisma.class_section_progress.findMany({
          where: { user_id: userId },
          select: {
            section_progress_id: true,
            class_id: true,
            module_id: true,
            section_id: true,
            score: true,
            active: true,
            status: true,
            submitted_at: true,
            validated_at: true,
            created_at: true,
            modified_at: true,
          },
        }),

        // Club role assignments
        this.prisma.club_role_assignments.findMany({
          where: { user_id: userId },
          select: {
            assignment_id: true,
            role_id: true,
            club_section_id: true,
            active: true,
            status: true,
            start_date: true,
            end_date: true,
          },
        }),

        // FCM tokens — mask first 10 chars of the token value
        this.prisma.user_fcm_tokens.findMany({
          where: { user_id: userId },
          select: {
            fcm_token_id: true,
            token: true,
            device_type: true,
            device_name: true,
            active: true,
            last_used: true,
            created_at: true,
          },
        }),

        // Notification deliveries — last 6 months only
        this.prisma.notification_deliveries.findMany({
          where: {
            user_id: userId,
            created_at: { gte: sixMonthsAgo },
          },
          select: {
            delivery_id: true,
            log_id: true,
            read_at: true,
            created_at: true,
          },
          orderBy: { created_at: 'desc' },
        }),

        // Sessions — exclude token value, include metadata only
        this.prisma.session.findMany({
          where: { userId },
          select: {
            id: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
            ipAddress: true,
            userAgent: true,
          },
          orderBy: { createdAt: 'desc' },
        }),

        // Notification preferences
        this.prisma.notification_preferences.findMany({
          where: { user_id: userId },
          select: {
            preference_id: true,
            category: true,
            enabled: true,
            created_at: true,
            modified_at: true,
          },
        }),

        // Evidence files metadata — NO file download, R2 path only
        this.prisma.evidence_files.findMany({
          where: { uploaded_by_id: userId },
          select: {
            evidence_file_id: true,
            file_url: true,
            file_name: true,
            file_type: true,
            uploaded_at: true,
            active: true,
            section_record_id: true,
            section_progress_id: true,
            user_honor_id: true,
          },
        }),
      ]);

      // -------------------------------------------------------------------
      // Step 4: Build JSON payload
      // -------------------------------------------------------------------
      const exportPayload = {
        export_metadata: {
          export_id: exportId,
          generated_at: new Date().toISOString(),
          format: 'json',
          schema_version: '1.0.0',
          app_version: process.env.npm_package_version ?? 'unknown',
          notice:
            'Evidence files (documents, images) are not included in this export. ' +
            'To request copies of your uploaded files, contact support@sacdia.app.',
        },
        user,
        honors,
        classes_progress: classesProgress,
        roles: clubRoles,
        devices: fcmTokens.map((t) => ({
          ...t,
          // Mask first 10 chars of the raw FCM token — rest is opaque to the user
          token: `${'*'.repeat(10)}${t.token.slice(10)}`,
        })),
        notifications_history: notificationDeliveries,
        sessions: sessions.map((s) => ({
          id: s.id,
          expires_at: s.expiresAt,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
          ip_address: s.ipAddress,
          user_agent: s.userAgent,
        })),
        notification_preferences: notificationPreferences,
        evidence_files_metadata: evidenceFiles,
      };

      // -------------------------------------------------------------------
      // Step 5: Serialize and checksum
      // -------------------------------------------------------------------
      const jsonString = JSON.stringify(exportPayload, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      // -------------------------------------------------------------------
      // Step 6: Upload to R2
      // -------------------------------------------------------------------
      const r2Key = `${userId}/${exportId}.json`;
      const uploadResult = await this.fileStorage.upload(
        StorageBucketAlias.DATA_EXPORTS,
        r2Key,
        buffer,
        { contentType: 'application/json', overwrite: true },
      );

      // -------------------------------------------------------------------
      // Step 7: Mark ready
      // -------------------------------------------------------------------
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1000); // +48h

      await this.prisma.data_export_requests.update({
        where: { export_id: exportId },
        data: {
          status: 'ready',
          r2_key: uploadResult.key,
          file_size_bytes: BigInt(buffer.byteLength),
          sha256_checksum: sha256,
          completed_at: now,
          expires_at: expiresAt,
        },
      });

      // -------------------------------------------------------------------
      // Step 8: Email notification (logger-only fallback)
      // -------------------------------------------------------------------
      if (user?.email) {
        await this.emailService.sendDataExportReady({
          userId,
          email: user.email,
          exportId,
          deepLink: `sacdia://data-export/${exportId}`,
          expiresAt,
        }).catch((err: Error) => {
          this.logger.warn(
            `Failed to send data export email for exportId=${exportId}: ${err.message}`,
          );
        });
      }

      this.logger.log(
        `Data export completed: exportId=${exportId}, bytes=${buffer.byteLength}, sha256=${sha256.slice(0, 8)}...`,
      );

      return {
        exportId,
        fileSizeBytes: buffer.byteLength,
        sha256: sha256.slice(0, 8) + '...',
      };
    } catch (err) {
      // -------------------------------------------------------------------
      // Fail closed — no retry, single attempt
      // -------------------------------------------------------------------
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Data export failed: exportId=${exportId}, error=${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      await this.prisma.data_export_requests
        .update({
          where: { export_id: exportId },
          data: { status: 'failed', failure_reason: errorMessage.slice(0, 1000) },
        })
        .catch((updateErr: Error) => {
          this.logger.error(
            `Failed to mark export as failed: exportId=${exportId}, ${updateErr.message}`,
          );
        });

      // Do NOT throw — worker should not retry (attempts: 1)
      return { exportId, failed: true, reason: errorMessage };
    }
  }
}
