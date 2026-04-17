import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  GoneException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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
import type {
  DataExportItemDto,
  DataExportStatus,
} from './dto/data-export-response.dto';

const PRESIGNED_URL_TTL_SECONDS = 15 * 60; // 15 minutes
const EXPORT_COOLDOWN_HOURS = 24;

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
    @InjectQueue(DATA_EXPORTS_QUEUE)
    private readonly dataExportsQueue: Queue,
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
      throw new NotFoundException('Export not found');
    }

    const status = exportRow.status as DataExportStatus;

    switch (status) {
      case 'pending':
      case 'processing':
        throw new ConflictException(
          `Export is ${status}. Please wait and try again.`,
        );
      case 'expired':
        throw new GoneException('This export has expired and is no longer available.');
      case 'failed':
        throw new UnprocessableEntityException(
          `Export failed: ${exportRow.failure_reason ?? 'unknown error'}`,
        );
      case 'ready':
        break;
      default:
        throw new UnprocessableEntityException(`Unknown export status: ${status}`);
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

    const urlExpiresAt = new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000);

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
  // Cleanup cron — daily 4am UTC
  // ---------------------------------------------------------------------------

  @Cron('0 4 * * *', { timeZone: 'UTC' })
  async cleanupExpiredExports(): Promise<void> {
    this.logger.log('DataExport cleanup cron started');

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
  }
}
