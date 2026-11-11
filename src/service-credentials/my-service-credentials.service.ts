import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { CLOCK, type Clock } from '../common/clock/clock';
import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import { ECCLESIASTICAL_YEAR_TIMEZONE } from '../common/services/ecclesiastical-year.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
  type FileStorageService,
} from '../common/services/file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateServiceCredentialDto } from './dto/create-service-credential.dto';
import {
  CREDENTIAL_SELECT,
  toCredentialView,
  type CredentialView,
} from './service-credential.mapper';
import {
  SERVICE_CREDENTIAL_MAGIC_SAMPLE_BYTES,
  SERVICE_CREDENTIAL_MAX_BYTES,
  SERVICE_CREDENTIAL_UPLOAD_TTL_SECONDS,
  type ServiceCredentialMimeType,
  extensionForServiceCredentialMime,
  isServiceCredentialMime,
  parseDateOnly,
  serviceCredentialMagicMatches,
} from './service-credentials.constants';

/**
 * Private bucket that already holds personal training evidence
 * (certification requirement/closeout evidence). No new infra; never public.
 */
export const SERVICE_CREDENTIAL_BUCKET =
  StorageBucketAlias.CERTIFICATION_EVIDENCE;

export type ServiceCredentialUpload = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_in: number;
};

/** Self-service of the counselor «constancia» (`/users/me/service-credentials`). */
@Injectable()
export class MyServiceCredentialsService {
  private readonly logger = new Logger(MyServiceCredentialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly zonedTime: ZonedBusinessTimeService,
  ) {}

  async list(userId: string): Promise<{ items: CredentialView[] }> {
    const rows = await this.prisma.service_credentials.findMany({
      where: { user_id: userId, active: true },
      orderBy: [{ created_at: 'desc' }],
      select: CREDENTIAL_SELECT,
    });
    return { items: rows.map(toCredentialView) };
  }

  async create(
    userId: string,
    dto: CreateServiceCredentialDto,
  ): Promise<{ credential: CredentialView; upload: ServiceCredentialUpload }> {
    if (
      !isServiceCredentialMime(dto.mime_type) ||
      !Number.isInteger(dto.size_bytes) ||
      dto.size_bytes <= 0 ||
      dto.size_bytes > SERVICE_CREDENTIAL_MAX_BYTES
    ) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
    }
    const mime = dto.mime_type;

    const completedAt = parseDateOnly(dto.completed_at);
    if (!completedAt || dto.completed_at > this.today()) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_DATE_INVALID,
      );
    }

    const credentialId = randomUUID();
    // Signing is local (no network): do it first so the row stores the full
    // object key (bucket prefix included), the only form `deleteMany` accepts.
    const signed = await this.storage.getSignedUploadUrl(
      SERVICE_CREDENTIAL_BUCKET,
      this.stagingKey(userId, credentialId, mime),
      {
        contentType: mime,
        contentLength: dto.size_bytes,
        expiresInSeconds: SERVICE_CREDENTIAL_UPLOAD_TTL_SECONDS,
      },
    );

    // One active credential under review per type. An attempt whose file was
    // never confirmed does not count (the owner abandoned it): it is retired.
    // A concurrent double submit can still slip a second pending row in; the
    // owner can withdraw it.
    const created = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.service_credentials.findFirst({
        where: {
          user_id: userId,
          credential_type: dto.type,
          active: true,
          status: 'PENDING_REVIEW',
          upload_status: 'CONFIRMED',
        },
        select: { credential_id: true },
      });
      if (pending) {
        throw new AppConflictException(
          ErrorCode.SERVICE_CREDENTIAL_PENDING_EXISTS,
        );
      }
      await tx.service_credentials.updateMany({
        where: {
          user_id: userId,
          credential_type: dto.type,
          active: true,
          status: 'PENDING_REVIEW',
          upload_status: 'PENDING_UPLOAD',
        },
        data: { active: false },
      });
      return tx.service_credentials.create({
        data: {
          credential_id: credentialId,
          user_id: userId,
          credential_type: dto.type,
          completed_at: completedAt,
          object_key: signed.key,
          original_filename: dto.file_name.trim().slice(0, 255),
          mime_type: mime,
          size_bytes: BigInt(dto.size_bytes),
          upload_status: 'PENDING_UPLOAD',
          status: 'PENDING_REVIEW',
        },
        select: CREDENTIAL_SELECT,
      });
    });

    return {
      credential: toCredentialView(created),
      upload: {
        url: signed.url,
        method: 'PUT',
        headers: { 'Content-Type': mime },
        expires_in: signed.expiresInSeconds,
      },
    };
  }

  async confirm(userId: string, credentialId: string): Promise<CredentialView> {
    const row = await this.findOwned(userId, credentialId);
    if (row.upload_status === 'CONFIRMED') {
      return toCredentialView(row);
    }
    if (!row.object_key || !row.mime_type || row.size_bytes === null) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_UPLOAD_MISSING,
      );
    }
    const mime = row.mime_type;
    if (!isServiceCredentialMime(mime)) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
    }

    const info = await this.storage.getObjectInfo(
      SERVICE_CREDENTIAL_BUCKET,
      row.object_key,
    );
    if (!info) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_UPLOAD_MISSING,
      );
    }
    const declared = Number(row.size_bytes);
    if (
      info.size <= 0 ||
      info.size > SERVICE_CREDENTIAL_MAX_BYTES ||
      Math.abs(info.size - declared) > Math.max(1024, declared * 0.01)
    ) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
    }
    const prefix = await this.storage.getObjectPrefix(
      SERVICE_CREDENTIAL_BUCKET,
      row.object_key,
      SERVICE_CREDENTIAL_MAGIC_SAMPLE_BYTES,
    );
    if (!prefix || !serviceCredentialMagicMatches(mime, prefix)) {
      throw new AppBadRequestException(
        ErrorCode.SERVICE_CREDENTIAL_FILE_INVALID,
      );
    }

    // A signed PUT stays valid until it expires: seal a copy under a fresh
    // key so the file the reviewer sees cannot be replaced afterwards.
    const sealedKey = `service-credentials/${userId}/${credentialId}/${randomUUID()}.${extensionForServiceCredentialMime(mime)}`;
    const sealed = await this.storage.copyObject(
      SERVICE_CREDENTIAL_BUCKET,
      row.object_key,
      sealedKey,
    );
    const claimed = await this.prisma.service_credentials.updateMany({
      where: {
        credential_id: credentialId,
        user_id: userId,
        active: true,
        upload_status: 'PENDING_UPLOAD',
      },
      data: {
        upload_status: 'CONFIRMED',
        object_key: sealed.key,
        size_bytes: BigInt(info.size),
      },
    });
    const stagingKey = row.object_key;
    if (claimed.count !== 1) {
      await this.deleteQuietly([sealed.key]);
      return toCredentialView(await this.findOwned(userId, credentialId));
    }
    await this.deleteQuietly([stagingKey]);
    return toCredentialView(await this.findOwned(userId, credentialId));
  }

  async withdraw(userId: string, credentialId: string): Promise<void> {
    const row = await this.findOwned(userId, credentialId);
    if (row.status === 'APPROVED') {
      throw new AppConflictException(
        ErrorCode.SERVICE_CREDENTIAL_APPROVED_LOCKED,
      );
    }
    const result = await this.prisma.service_credentials.updateMany({
      where: {
        credential_id: credentialId,
        user_id: userId,
        active: true,
        status: { not: 'APPROVED' },
      },
      data: { active: false },
    });
    if (result.count !== 1) {
      // Approved between the read and the write.
      throw new AppConflictException(
        ErrorCode.SERVICE_CREDENTIAL_APPROVED_LOCKED,
      );
    }
  }

  /** Owner's active row; someone else's id is the same 404 as a missing one. */
  private async findOwned(userId: string, credentialId: string) {
    const row = await this.prisma.service_credentials.findFirst({
      where: { credential_id: credentialId, user_id: userId, active: true },
      select: {
        ...CREDENTIAL_SELECT,
        object_key: true,
        mime_type: true,
        size_bytes: true,
      },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND);
    }
    return row;
  }

  private stagingKey(
    userId: string,
    credentialId: string,
    mime: ServiceCredentialMimeType,
  ) {
    return `service-credentials/${userId}/${credentialId}/upload.${extensionForServiceCredentialMime(mime)}`;
  }

  private today(): string {
    return this.zonedTime.businessDate(
      this.clock.now(),
      ECCLESIASTICAL_YEAR_TIMEZONE,
    );
  }

  private async deleteQuietly(keys: string[]): Promise<void> {
    try {
      await this.storage.deleteMany(SERVICE_CREDENTIAL_BUCKET, keys);
    } catch (error) {
      this.logger.warn(
        `Could not delete service credential object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
