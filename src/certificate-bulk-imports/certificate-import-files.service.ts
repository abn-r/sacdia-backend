import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { certificate_import_file_status_enum, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppInternalServerErrorException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  assertCertificateImportObject,
  assertCertificateImportPresign,
  CERTIFICATE_IMPORT_MAGIC_SAMPLE_BYTES,
  CERTIFICATE_IMPORT_MAX_BYTES,
  CERTIFICATE_IMPORT_SIGNED_TTL_SECONDS,
  EDITABLE_CERTIFICATE_IMPORT_BATCH_STATUSES,
  extensionForCertificateMime,
} from './certificate-import-files.constants';
import {
  assertCertificateImportPdf,
  PDF_CONFIRM_QUEUE_WAIT_MS,
} from './certificate-import-pdf';
import type { PresignCertificateImportFileDto } from './dto/presign-certificate-import-file.dto';

const LOCKED_ITEM_STATUSES = ['SUBMITTED', 'APPROVED', 'RESUBMITTED'] as const;

type FileRow = {
  file_id: string;
  batch_id: string;
  file_name: string;
  file_type: string;
  file_url: string;
  upload_status: certificate_import_file_status_enum;
  staging_key: string | null;
  object_key: string | null;
  size_bytes: bigint | null;
  confirmed_at: Date | null;
  jurisdiction: string;
  active: boolean;
  batch: {
    user_id: string;
    local_field_id: number | null;
    status: string;
  };
};

@Injectable()
export class CertificateImportFilesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
  ) {}

  async presign(
    userId: string,
    batchId: string,
    dto: PresignCertificateImportFileDto,
  ) {
    assertCertificateImportPresign(dto.mime_type, dto.file_size);
    const extension = extensionForCertificateMime(dto.mime_type);
    const fileId = randomUUID();
    const relativeStagingKey = `batches/${batchId}/staging/${fileId}${extension}`;

    return this.prisma.$transaction(async (tx) => {
      const batch = await this.ownedEditableBatch(tx, userId, batchId);
      await this.assertSingleDocument(tx, batch.batch_id);

      const signed = await this.callStorage(() =>
        this.storage.getSignedUploadUrl(
          StorageBucketAlias.CERTIFICATE_IMPORTS,
          relativeStagingKey,
          {
            contentType: dto.mime_type,
            contentLength: dto.file_size,
            expiresInSeconds: CERTIFICATE_IMPORT_SIGNED_TTL_SECONDS,
          },
        ),
      );

      const file = await tx.certificate_bulk_import_files.create({
        data: {
          file_id: fileId,
          batch_id: batch.batch_id,
          file_url: signed.key,
          file_name: dto.file_name,
          file_type: dto.mime_type,
          uploaded_by_id: userId,
          upload_status: 'PENDING_UPLOAD',
          staging_key: signed.key,
          size_bytes: BigInt(dto.file_size),
          jurisdiction: 'CAMPO_LOCAL',
        },
      });

      return {
        file_id: file.file_id,
        upload_url: signed.url,
        expires_in: signed.expiresInSeconds,
        required_headers: { 'Content-Type': dto.mime_type },
      };
    });
  }

  async confirm(userId: string, batchId: string, fileId: string) {
    const existing = await this.ownedFile(userId, batchId, fileId);
    if (
      existing.upload_status === 'CONFIRMED' &&
      existing.object_key &&
      existing.size_bytes != null
    ) {
      return this.confirmedView(existing);
    }
    this.assertEditable(existing.batch.status);
    if (!existing.staging_key || existing.size_bytes == null) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }

    const stored = await this.callStorage(() =>
      this.storage.getObjectInfo(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        existing.staging_key!,
      ),
    );
    const prefix = await this.callStorage(() =>
      this.storage.getObjectPrefix(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        existing.staging_key!,
        CERTIFICATE_IMPORT_MAGIC_SAMPLE_BYTES,
      ),
    );
    assertCertificateImportObject(
      stored,
      Number(existing.size_bytes),
      existing.file_type,
      prefix,
    );

    const extension = extensionForCertificateMime(existing.file_type);
    const sealId = `${fileId}-${randomUUID()}`;
    const destination = `batches/${batchId}/sealed/${sealId}${extension}`;
    let pdfBytes: Buffer | undefined;
    if (existing.file_type === 'application/pdf') {
      const downloaded = await this.callStorage(() =>
        this.storage.getObject(
          StorageBucketAlias.CERTIFICATE_IMPORTS,
          existing.staging_key!,
          CERTIFICATE_IMPORT_MAX_BYTES,
        ),
      );
      if (!downloaded) {
        throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
      }
      assertCertificateImportObject(
        { size: downloaded.length, contentType: existing.file_type },
        Number(existing.size_bytes),
        existing.file_type,
        downloaded,
      );
      if (downloaded.length !== stored!.size) {
        throw new BadRequestException(
          'CERTIFICATE_IMPORT_FILE_CONTENT_MISMATCH',
        );
      }
      await assertCertificateImportPdf(downloaded, {
        queueWaitMs: PDF_CONFIRM_QUEUE_WAIT_MS,
        queueFullCode: ErrorCode.CERTIFICATE_IMPORT_PDF_BUSY,
      });
      pdfBytes = downloaded;
    }
    // A signed staging PUT remains mutable. PDF seals the validated bytes.
    // Every attempt, including images, writes a distinct object key so a
    // later copy cannot replace the object the winning claim stored.
    const sealed = await this.callStorage(() =>
      pdfBytes
        ? this.storage.upload(
            StorageBucketAlias.CERTIFICATE_IMPORTS,
            destination,
            pdfBytes,
            {
              contentType: existing.file_type,
              overwrite: false,
            },
          )
        : this.storage.copyObject(
            StorageBucketAlias.CERTIFICATE_IMPORTS,
            existing.staging_key!,
            destination,
          ),
    );

    // Both callers can observe PENDING. Claim the snapshot once; the loser
    // returns the committed seal instead of replacing object_key or confirmed_at.
    const claimedAt = existing.confirmed_at ?? new Date();
    const claim = await this.prisma.certificate_bulk_import_files
      .updateMany({
        where: {
          file_id: existing.file_id,
          upload_status: existing.upload_status,
          object_key: existing.object_key,
          confirmed_at: existing.confirmed_at,
          staging_key: existing.staging_key,
          size_bytes: existing.size_bytes,
        },
        data: {
          upload_status: 'CONFIRMED',
          object_key: sealed.key,
          file_url: sealed.key,
          size_bytes: BigInt(stored!.size),
          confirmed_at: claimedAt,
        },
      })
      .catch(async (error: unknown) => {
        // A connectivity error may occur after commit. Only remove this
        // attempt's seal if a successful reread proves it is unreferenced.
        // Unknown commit state preserves evidence (an orphan is safer).
        // PDFs and images both seal under a unique `fileId-<uuid>` key.
        const current = await this.prisma.certificate_bulk_import_files
          .findFirst({
            where: { file_id: existing.file_id },
            select: { object_key: true },
          })
          .catch(() => undefined);
        if (current !== undefined && current?.object_key !== sealed.key) {
          await this.callStorage(() =>
            this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, [
              sealed.key,
            ]),
          ).catch(() => undefined);
        }
        throw error;
      });

    if (claim.count !== 1) {
      const current = await this.prisma.certificate_bulk_import_files
        .findFirst({
          where: { file_id: existing.file_id },
          select: {
            object_key: true,
            upload_status: true,
            size_bytes: true,
            confirmed_at: true,
          },
        })
        .catch(() => undefined);
      if (current != null && current.object_key !== sealed.key) {
        await this.callStorage(() =>
          this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, [
            sealed.key,
          ]),
        ).catch(() => undefined);
      }
      if (
        current?.upload_status === 'CONFIRMED' &&
        current.object_key &&
        current.size_bytes != null &&
        current.confirmed_at
      ) {
        await this.callStorage(() =>
          this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, [
            existing.staging_key!,
          ]),
        ).catch(() => undefined);
        return this.confirmedView({
          file_id: existing.file_id,
          object_key: current.object_key,
          size_bytes: current.size_bytes,
          file_type: existing.file_type,
          confirmed_at: current.confirmed_at,
        });
      }
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }

    await this.callStorage(() =>
      this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, [
        existing.staging_key!,
      ]),
    ).catch(() => undefined);

    return this.confirmedView({
      file_id: existing.file_id,
      object_key: sealed.key,
      size_bytes: BigInt(stored!.size),
      file_type: existing.file_type,
      confirmed_at: claimedAt,
    });
  }

  async download(actorId: string, batchId: string, fileId: string) {
    const file = await this.visibleFile(batchId, fileId);
    await this.assertCanRead(actorId, file);
    if (file.upload_status !== 'CONFIRMED' || !file.object_key) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }
    if (/^https?:\/\//i.test(file.object_key)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }

    const downloadUrl = await this.callStorage(() =>
      this.storage.getSignedDownloadUrl(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        file.object_key!,
        { expiresInSeconds: CERTIFICATE_IMPORT_SIGNED_TTL_SECONDS },
      ),
    );

    return {
      file_id: file.file_id,
      download_url: downloadUrl,
      expires_in: CERTIFICATE_IMPORT_SIGNED_TTL_SECONDS,
    };
  }

  async remove(userId: string, batchId: string, fileId: string) {
    const file = await this.ownedFile(userId, batchId, fileId);
    this.assertEditable(file.batch.status);
    const lockedItems = await this.prisma.certificate_bulk_import_items.count({
      where: {
        batch_id: batchId,
        active: true,
        status: { in: [...LOCKED_ITEM_STATUSES] },
      },
    });
    if (lockedItems > 0) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_SEALED');
    }

    await this.prisma.certificate_bulk_import_files.update({
      where: { file_id: file.file_id },
      data: { active: false, upload_status: 'REJECTED' },
    });

    const keys = [file.staging_key, file.object_key].filter(
      (key): key is string => !!key && !/^https?:\/\//i.test(key),
    );
    if (keys.length > 0) {
      await this.callStorage(() =>
        this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, keys),
      ).catch(() => undefined);
    }

    return { file_id: file.file_id, active: false };
  }

  async purgeAbandoned(olderThan: Date) {
    const stale = await this.prisma.certificate_bulk_import_files.findMany({
      where: {
        active: true,
        upload_status: 'PENDING_UPLOAD',
        uploaded_at: { lt: olderThan },
        batch: { status: 'DRAFT' },
      },
      select: { file_id: true, staging_key: true },
    });
    if (stale.length === 0) return { purged: 0 };

    await this.prisma.certificate_bulk_import_files.updateMany({
      where: { file_id: { in: stale.map((file) => file.file_id) } },
      data: { active: false, upload_status: 'REJECTED' },
    });

    const keys = stale
      .map((file) => file.staging_key)
      .filter((key): key is string => !!key);
    if (keys.length > 0) {
      await this.callStorage(() =>
        this.storage.deleteMany(StorageBucketAlias.CERTIFICATE_IMPORTS, keys),
      ).catch(() => undefined);
    }

    return { purged: stale.length };
  }

  private async ownedEditableBatch(
    tx: Prisma.TransactionClient,
    userId: string,
    batchId: string,
  ) {
    const batch = await tx.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
      select: { batch_id: true, status: true },
    });
    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }
    this.assertEditable(batch.status);
    return batch;
  }

  private async assertSingleDocument(
    tx: Prisma.TransactionClient,
    batchId: string,
  ) {
    const activeFiles = await tx.certificate_bulk_import_files.count({
      where: { batch_id: batchId, active: true },
    });
    if (activeFiles > 0) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_LIMIT');
    }
  }

  private async ownedFile(userId: string, batchId: string, fileId: string) {
    const file = await this.visibleFile(batchId, fileId);
    if (file.batch.user_id !== userId) {
      throw new NotFoundException('CERTIFICATE_IMPORT_FILE_NOT_FOUND');
    }
    return file;
  }

  private async visibleFile(batchId: string, fileId: string): Promise<FileRow> {
    const file = await this.prisma.certificate_bulk_import_files.findFirst({
      where: { file_id: fileId, batch_id: batchId, active: true },
      include: {
        batch: {
          select: { user_id: true, local_field_id: true, status: true },
        },
      },
    });
    if (!file) {
      throw new NotFoundException('CERTIFICATE_IMPORT_FILE_NOT_FOUND');
    }
    return file;
  }

  private async assertCanRead(actorId: string, file: FileRow) {
    if (actorId === file.batch.user_id) return;

    const actor = await this.prisma.users.findUnique({
      where: { user_id: actorId },
      select: {
        local_field_id: true,
        users_roles: {
          where: { active: true },
          select: { roles: { select: { role_name: true } } },
        },
      },
    });
    const roles = new Set(
      (actor?.users_roles ?? []).map((entry) =>
        entry.roles.role_name.toLowerCase(),
      ),
    );

    if (file.jurisdiction === 'INSTITUTIONAL') {
      if (!roles.has('super-admin')) {
        throw new ForbiddenException('CERTIFICATE_IMPORT_FILE_FORBIDDEN');
      }
      return;
    }

    if (roles.has('super-admin')) return;
    const fieldReviewer =
      roles.has('director-lf') ||
      roles.has('assistant-lf') ||
      ((roles.has('admin') || roles.has('assistant-admin')) &&
        actor?.local_field_id != null);
    if (
      fieldReviewer &&
      actor?.local_field_id &&
      actor.local_field_id === file.batch.local_field_id
    ) {
      return;
    }
    if (
      (roles.has('admin') || roles.has('assistant-admin')) &&
      actor?.local_field_id == null
    ) {
      return;
    }

    throw new ForbiddenException('CERTIFICATE_IMPORT_FILE_FORBIDDEN');
  }

  private assertEditable(status: string) {
    if (
      !(
        EDITABLE_CERTIFICATE_IMPORT_BATCH_STATUSES as readonly string[]
      ).includes(status)
    ) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_EDITABLE');
    }
  }

  private confirmedView(file: {
    file_id: string;
    object_key: string | null;
    size_bytes: bigint | null;
    file_type: string;
    confirmed_at: Date | null;
  }) {
    return {
      file_id: file.file_id,
      object_key: file.object_key,
      size_bytes: file.size_bytes == null ? null : Number(file.size_bytes),
      mime_type: file.file_type,
      confirmed_at: file.confirmed_at,
    };
  }

  private async callStorage<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AppInternalServerErrorException) {
        throw new BadRequestException('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE');
      }
      throw error;
    }
  }
}
