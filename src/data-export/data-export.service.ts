import {
  Injectable,
  Logger,
  GoneException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  DATA_EXPORTS_QUEUE,
  DATA_EXPORT_GENERATE_JOB,
} from './data-export.processor';
import { EmailService } from '../common/email/email.service';
import type {
  DataExportItemDto,
  DataExportStatus,
} from './dto/data-export-response.dto';
import { CronRunLogger } from '../common/services/cron-run-logger.service';

const PRESIGNED_URL_TTL_SECONDS = 15 * 60; // 15 minutes
const EXPORT_COOLDOWN_HOURS = 24;

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    @Optional()
    @InjectQueue(DATA_EXPORTS_QUEUE)
    private readonly dataExportsQueue: Queue | undefined,
    private readonly cronLogger: CronRunLogger,
    private readonly emailService: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // POST /users/me/data-export
  // ---------------------------------------------------------------------------

  async requestExport(userId: string, format: string = 'json') {
    // Check if there's a 'ready' export within the last 24h (rate limit)
    const recentReady = await this.prisma.data_export_requests.findFirst({
      where: {
        user_id: userId,
        status: 'ready',
        created_at: {
          gte: new Date(Date.now() - EXPORT_COOLDOWN_HOURS * 60 * 60 * 1000),
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (recentReady) {
      const expiresAt = recentReady.expires_at;
      const retryAfterSeconds = expiresAt
        ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
        : EXPORT_COOLDOWN_HOURS * 3600;

      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'A completed export already exists for the last 24 hours.',
          retry_after_seconds: retryAfterSeconds,
          export_id: recentReady.export_id,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // If there's already a pending or processing export, return it (200)
    const inProgress = await this.prisma.data_export_requests.findFirst({
      where: {
        user_id: userId,
        status: { in: ['pending', 'processing'] },
      },
      orderBy: { created_at: 'desc' },
    });

    if (inProgress) {
      return {
        status: 200,
        data: {
          export_id: inProgress.export_id,
          status: inProgress.status as DataExportStatus,
          created_at: inProgress.created_at.toISOString(),
        },
      };
    }

    // Create new export row
    const exportRow = await this.prisma.data_export_requests.create({
      data: {
        user_id: userId,
        status: 'pending',
        format,
      },
    });

    // Enqueue job — fail closed, single attempt
    if (!this.dataExportsQueue) {
      // Roll back the pending row so the user can retry later
      await this.prisma.data_export_requests
        .delete({ where: { export_id: exportRow.export_id } })
        .catch(() => undefined);
      throw new ServiceUnavailableException(
        'Data export queue unavailable. Configure REDIS_URL to enable async exports.',
      );
    }
    await this.dataExportsQueue.add(
      DATA_EXPORT_GENERATE_JOB,
      { exportId: exportRow.export_id, userId },
      {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `Data export enqueued: exportId=${exportRow.export_id}, userId=${userId}`,
    );

    return {
      status: 201,
      data: {
        export_id: exportRow.export_id,
        status: 'pending' as DataExportStatus,
        created_at: exportRow.created_at.toISOString(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // GET /users/me/data-exports
  // ---------------------------------------------------------------------------

  async listExports(userId: string): Promise<{ exports: DataExportItemDto[] }> {
    const rows = await this.prisma.data_export_requests.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        export_id: true,
        status: true,
        format: true,
        file_size_bytes: true,
        created_at: true,
        completed_at: true,
        expires_at: true,
        failure_reason: true,
      },
    });

    return {
      exports: rows.map((r) => ({
        export_id: r.export_id,
        status: r.status as DataExportStatus,
        format: r.format,
        file_size_bytes:
          r.file_size_bytes !== null ? Number(r.file_size_bytes) : null,
        created_at: r.created_at.toISOString(),
        completed_at: r.completed_at ? r.completed_at.toISOString() : null,
        expires_at: r.expires_at ? r.expires_at.toISOString() : null,
        failure_reason: r.failure_reason ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /users/me/data-exports/:exportId/download
  // ---------------------------------------------------------------------------

  async getDownloadUrl(
    userId: string,
    exportId: string,
    ipAddress?: string,
  ): Promise<{ url: string; expires_at: string }> {
    const exportRow = await this.prisma.data_export_requests.findUnique({
      where: { export_id: exportId },
    });

    // 404: not found or cross-user
    if (!exportRow || exportRow.user_id !== userId) {
      throw new AppNotFoundException(ErrorCode.EXPORT_NOT_FOUND);
    }

    const status = exportRow.status as DataExportStatus;

    switch (status) {
      case 'pending':
      case 'processing':
        throw new AppConflictException(ErrorCode.EXPORT_ALREADY_PROCESSING);
      case 'expired':
        throw new GoneException(
          'This export has expired and is no longer available.',
        );
      case 'failed':
        throw new UnprocessableEntityException(
          `Export failed: ${exportRow.failure_reason ?? 'unknown error'}`,
        );
      case 'ready':
        break;
      default:
        throw new UnprocessableEntityException(
          `Unknown export status: ${status}`,
        );
    }

    if (!exportRow.r2_key) {
      throw new UnprocessableEntityException('Export has no associated file.');
    }

    // Generate presigned URL — TTL 15 min
    const signedUrl = await this.fileStorage.getSignedDownloadUrl(
      StorageBucketAlias.DATA_EXPORTS,
      exportRow.r2_key,
      { expiresInSeconds: PRESIGNED_URL_TTL_SECONDS },
    );

    const urlExpiresAt = new Date(
      Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000,
    );

    // Audit log: increment counter + update last_downloaded_at (fire-and-forget)
    this.prisma.data_export_requests
      .update({
        where: { export_id: exportId },
        data: {
          downloaded_count: { increment: 1 },
          last_downloaded_at: new Date(),
        },
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Failed to update download count for exportId=${exportId}: ${err.message}`,
        );
      });

    // Structured audit log — never log the full signed URL
    const maskedUrl = signedUrl.split('?')[0].slice(-40);
    this.logger.log(
      JSON.stringify({
        event: 'data_export_downloaded',
        user_id: userId,
        export_id: exportId,
        ip_address: ipAddress ?? null,
        url_suffix: `...${maskedUrl}`,
        timestamp: new Date().toISOString(),
      }),
    );

    return {
      url: signedUrl,
      expires_at: urlExpiresAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Core export execution — called by BackgroundJobsProcessor
  // ---------------------------------------------------------------------------

  /**
   * Executes the full data-export pipeline for a given exportId/userId pair.
   *
   * Steps:
   *   1. Fetch row — abort if not pending (idempotency guard)
   *   2. Transition to 'processing'
   *   3. Collect user data from Prisma
   *   4. Build JSON payload
   *   5. Serialize and checksum
   *   6. Upload to R2
   *   7. Mark ready
   *   8. Email notification (best-effort)
   *
   * Called by BackgroundJobsProcessor for the DATA_EXPORT_GENERATE job.
   * Does NOT rethrow on business errors — returns a result object.
   * Fatal infrastructure errors are caught and the row is marked 'failed'.
   */
  async runExport(
    exportId: string,
    userId: string,
  ): Promise<{
    exportId: string;
    fileSizeBytes?: number;
    sha256?: string;
    failed?: boolean;
    reason?: string;
    skipped?: boolean;
  }> {
    // Step 1: Fetch row — abort if not pending (idempotency guard)
    const exportRow = await this.prisma.data_export_requests.findUnique({
      where: { export_id: exportId },
    });

    if (!exportRow) {
      this.logger.warn(`Export row not found: exportId=${exportId} — aborting`);
      return { exportId, skipped: true, reason: 'not_found' };
    }

    if (exportRow.user_id !== userId) {
      this.logger.error(
        `Ownership mismatch: job userId=${userId} vs row userId=${exportRow.user_id} — aborting`,
      );
      return { exportId, skipped: true, reason: 'ownership_mismatch' };
    }

    if (exportRow.status !== 'pending') {
      this.logger.warn(
        `Export ${exportId} is ${exportRow.status}, not pending — aborting (idempotent)`,
      );
      return { exportId, skipped: true, reason: 'not_pending' };
    }

    // Step 2: Transition to 'processing'
    await this.prisma.data_export_requests.update({
      where: { export_id: exportId },
      data: { status: 'processing', started_at: new Date() },
    });

    try {
      // Step 3: Collect user data from Prisma
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

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

      // Step 4: Build JSON payload
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

      // Step 5: Serialize and checksum
      const jsonString = JSON.stringify(exportPayload, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      // Step 6: Upload to R2
      const r2Key = `${userId}/${exportId}.json`;
      const uploadResult = await this.fileStorage.upload(
        StorageBucketAlias.DATA_EXPORTS,
        r2Key,
        buffer,
        { contentType: 'application/json', overwrite: true },
      );

      // Step 7: Mark ready
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

      // Step 8: Email notification (best-effort)
      if (user?.email) {
        await this.emailService
          .sendDataExportReady({
            userId,
            email: user.email,
            exportId,
            deepLink: `sacdia://data-export/${exportId}`,
            expiresAt,
          })
          .catch((err: Error) => {
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
      // Fail closed — no retry, single attempt
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Data export failed: exportId=${exportId}, error=${errorMessage}`,
        err instanceof Error ? err.stack : undefined,
      );

      await this.prisma.data_export_requests
        .update({
          where: { export_id: exportId },
          data: {
            status: 'failed',
            failure_reason: errorMessage.slice(0, 1000),
          },
        })
        .catch((updateErr: Error) => {
          this.logger.error(
            `Failed to mark export as failed: exportId=${exportId}, ${updateErr.message}`,
          );
        });

      return { exportId, failed: true, reason: errorMessage };
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup cron — daily 4am UTC
  // ---------------------------------------------------------------------------

  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async cleanupExpiredExports(): Promise<void> {
    this.logger.log('DataExport cleanup cron started');

    await this.cronLogger.track('data-export-cleanup', async () => {
      const now = new Date();

      // 1. Find ready exports that have passed their expires_at → mark as expired + delete R2
      const expiredReady = await this.prisma.data_export_requests.findMany({
        where: {
          status: 'ready',
          expires_at: { lt: now },
        },
        select: { export_id: true, r2_key: true },
      });

      let markedExpiredCount = 0;
      let r2DeletedCount = 0;

      for (const row of expiredReady) {
        // Delete R2 object first (best effort)
        if (row.r2_key) {
          await this.fileStorage
            .deleteMany(StorageBucketAlias.DATA_EXPORTS, [row.r2_key])
            .then(() => r2DeletedCount++)
            .catch((err: Error) => {
              this.logger.warn(
                `Failed to delete R2 object for exportId=${row.export_id}: ${err.message}`,
              );
            });
        }

        // Mark as expired
        await this.prisma.data_export_requests
          .update({
            where: { export_id: row.export_id },
            data: { status: 'expired' },
          })
          .then(() => markedExpiredCount++)
          .catch((err: Error) => {
            this.logger.warn(
              `Failed to mark exportId=${row.export_id} as expired: ${err.message}`,
            );
          });
      }

      // 2. Hard-delete expired rows older than 6 months
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const { count: hardDeletedCount } =
        await this.prisma.data_export_requests.deleteMany({
          where: {
            status: 'expired',
            completed_at: { lt: sixMonthsAgo },
          },
        });

      this.logger.log(
        JSON.stringify({
          event: 'data_export_cleanup',
          marked_expired: markedExpiredCount,
          r2_deleted: r2DeletedCount,
          hard_deleted: hardDeletedCount,
          ran_at: now.toISOString(),
        }),
      );

      return { itemsProcessed: markedExpiredCount };
    });
  }
}
