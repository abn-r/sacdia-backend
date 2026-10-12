import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';
import {
  CERTIFICATE_OCR_QUEUE,
  certificateOcrJobId,
} from './ocr/certificate-ocr.queue';
import { isLiveOcrJobState } from './ocr/certificate-ocr-state';

type OcrJobHandle = { remove: () => Promise<unknown> };

/**
 * B11: el dueño descarta un borrador (cancelar durante la subida, PUT fallido).
 *
 * Las FK de items, files y events hacia el lote son ON DELETE CASCADE, así que
 * borrar el lote basta en la base. Los eventos de auditoría del lote también se
 * van en cascada: no existe otra tabla que sobreviva, y no se inventa una. La
 * traza de quién borró y cuándo queda solo en el log estructurado.
 */
@Injectable()
export class CertificateImportDraftDeletionService {
  private readonly logger = new Logger(
    CertificateImportDraftDeletionService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
    @Optional()
    @InjectQueue(CERTIFICATE_OCR_QUEUE)
    private readonly ocrQueue: Pick<Queue, 'getJob'> | null = null,
  ) {}

  async deleteDraft(userId: string, batchId: string) {
    // Dueño y estado primero: un no-dueño recibe 404 antes de saber nada del
    // lote (ni siquiera si tiene un job vivo).
    const batch = await this.prisma.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
      select: { status: true },
    });
    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }
    if (batch.status !== 'DRAFT') this.notDeletable();

    const finishedJob = await this.assertNoLiveOcrJob(batchId);
    const keys = await this.deleteRows(userId, batchId);

    await this.removeFinishedJob(finishedJob);
    await this.deleteObjects(batchId, keys);
    this.logger.log(
      `certificate import draft deleted batch=${batchId} by=${userId} at=${new Date().toISOString()}`,
    );
    return { batch_id: batchId, deleted: true };
  }

  /**
   * Un job en cola o en curso se rechaza (409 reintentable): borrar debajo de
   * un worker activo lo haría fallar a media lectura y gastaría el vendor. Un
   * job failed/completed se devuelve para eliminarlo después del commit. Si
   * Redis no responde se continúa: el job, de existir, falla sin efectos al no
   * encontrar el lote, y bloquear el borrado dejaría el huérfano que este
   * endpoint existe para evitar.
   */
  private async assertNoLiveOcrJob(
    batchId: string,
  ): Promise<OcrJobHandle | null> {
    if (!this.ocrQueue) return null;
    try {
      const job = await this.ocrQueue.getJob(certificateOcrJobId(batchId));
      if (!job) return null;
      const state = await job.getState();
      if (isLiveOcrJobState(state)) {
        throw new AppConflictException(
          ErrorCode.CERTIFICATE_IMPORT_OCR_IN_PROGRESS,
        );
      }
      return state === 'failed' || state === 'completed' ? job : null;
    } catch (error) {
      if (error instanceof AppConflictException) throw error;
      this.logger.warn(
        `certificate import OCR job lookup failed (${errorName(error)})`,
      );
      return null;
    }
  }

  /**
   * Un solo `deleteMany` condicionado por dueño y DRAFT: si `submit` ganó la
   * carrera, count es 0 y se responde 409 sin borrar nada. Una solicitud
   * institucional apunta al archivo y al lote (FK sin cascada) y es evidencia
   * del trámite: su presencia bloquea el borrado.
   */
  private async deleteRows(userId: string, batchId: string): Promise<string[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.certificate_bulk_import_batches.findFirst({
          where: { batch_id: batchId, user_id: userId, active: true },
          select: {
            status: true,
            files: {
              select: { staging_key: true, object_key: true, file_url: true },
            },
          },
        });
        if (!batch) {
          throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
        }
        if (batch.status !== 'DRAFT') this.notDeletable();

        const requests = await tx.institutional_certificate_requests.count({
          where: {
            OR: [{ batch_id: batchId }, { file: { batch_id: batchId } }],
          },
        });
        if (requests > 0) this.notDeletable();

        const deleted = await tx.certificate_bulk_import_batches.deleteMany({
          where: { batch_id: batchId, user_id: userId, status: 'DRAFT' },
        });
        if (deleted.count !== 1) this.notDeletable();

        const keys = batch.files.flatMap((file) => [
          file.staging_key,
          file.object_key,
          file.file_url,
        ]);
        return [...new Set(keys)].filter(
          (key): key is string => !!key && !/^https?:\/\//i.test(key),
        );
      });
    } catch (error) {
      // Una solicitud institucional creada entre el conteo y el borrado.
      if ((error as { code?: string } | null)?.code === 'P2003') {
        this.notDeletable();
      }
      throw error;
    }
  }

  private async removeFinishedJob(job: OcrJobHandle | null) {
    if (!job) return;
    try {
      await job.remove();
    } catch (error) {
      this.logger.warn(
        `certificate import OCR job cleanup failed (${errorName(error)})`,
      );
    }
  }

  /** Best effort tras el commit: un fallo de R2 no revierte ni cambia la respuesta. */
  private async deleteObjects(batchId: string, keys: string[]) {
    if (keys.length === 0) return;
    try {
      await this.storage.deleteMany(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        keys,
      );
    } catch (error) {
      this.logger.warn(
        `certificate import draft ${batchId} left ${keys.length} object(s) in storage (${errorName(error)})`,
      );
    }
  }

  private notDeletable(): never {
    throw new AppConflictException(
      ErrorCode.CERTIFICATE_IMPORT_BATCH_NOT_DELETABLE,
    );
  }
}

/** Solo el nombre del error: el mensaje puede traer claves, URLs o credenciales. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
