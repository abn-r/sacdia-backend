import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  CreateCertificateBulkImportDto,
  UpdateCertificateImportItemDto,
} from './dto';
import {
  CertificateBulkImportItemStatus,
  CertificateBulkImportItemType,
} from './certificate-bulk-imports.types';
import type { CertificateOcrProvider } from './ocr/certificate-ocr.provider';
import { CERTIFICATE_OCR_PROVIDER } from './ocr/certificate-ocr.provider';
import {
  CERTIFICATE_OCR_JOB,
  CERTIFICATE_OCR_QUEUE,
} from './ocr/certificate-ocr.queue';
import { Inject } from '@nestjs/common';
import { normalizeCertificateImportFileRef } from './certificate-import-file-ref';
import {
  assertClassCertificateHistoricalAge,
  ecclesiasticalYearIdsCovering,
  isCertificateHistoricalGateError,
  lockInvestitureYearsAscending,
  type CertificateYearLockOptions,
} from './class-certificate-historical-age';
import {
  isCertificateAuthorizationPending,
  rejectSameYearLiveAuthorization,
} from './class-certificate-live-authorization';
import { INSTITUTIONAL_CLASS_ASSET_CODES } from './institutional-class-codes';
import {
  catalogItemInclude,
  localizedName,
  toPublicImportBatch,
  toPublicImportItem,
} from './certificate-import-response.mapper';
import { InstructorsService } from '../instructors/instructors.service';
import { TranslationService } from '../common/services/translation.service';
import { checkDateInRange } from '../common/utils/honor-date-range';

type InstructorFields = {
  instructor_user_id: string | null;
  instructor_name: string | null;
};
const NO_INSTRUCTOR: InstructorFields = {
  instructor_user_id: null,
  instructor_name: null,
};

/** Campos de la fila que `changed_fields` puede nombrar en la auditoría (sin valores). */
const AUDITED_ITEM_FIELDS = [
  'item_type',
  'honor_id',
  'class_id',
  'instructor_user_id',
  'instructor_name',
  'detected_name',
  'detected_date',
  'completed_at',
  'ocr_confidence',
  'field_confidence',
] as const;

@Injectable()
export class CertificateBulkImportsService {
  private readonly logger = new Logger(CertificateBulkImportsService.name);
  /** Sin estado: solo lee el idioma de la petición. No necesita inyección. */
  private readonly translations = new TranslationService();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CERTIFICATE_OCR_PROVIDER)
    private readonly ocrProvider: CertificateOcrProvider,
    @Optional()
    @InjectQueue(CERTIFICATE_OCR_QUEUE)
    private readonly ocrQueue: Pick<Queue, 'add'> | null = null,
    private readonly instructors: InstructorsService,
  ) {}

  async createDraft(userId: string, dto: CreateCertificateBulkImportDto) {
    const files = (dto.files ?? []).map((file) => ({
      ...file,
      file_url: normalizeCertificateImportFileRef(file.file_url),
    }));

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { local_field_id: true },
    });

    if (!user) {
      throw new NotFoundException('USER_NOT_FOUND');
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.certificate_bulk_import_batches.create({
        data: {
          user_id: userId,
          local_field_id: user.local_field_id,
          raw_ocr_payload: this.toInputJson(dto.raw_ocr_payload),
          ...(files.length > 0
            ? {
                files: {
                  create: files.map((file) => ({
                    file_url: file.file_url,
                    file_name: file.file_name,
                    file_type: file.file_type,
                    ocr_raw_text: file.ocr_raw_text,
                    uploaded_by_id: userId,
                    upload_status: 'PENDING_UPLOAD' as const,
                  })),
                },
              }
            : {}),
        },
        include: this.batchInclude(),
      });

      if (dto.items?.length) {
        const rows: Prisma.certificate_bulk_import_itemsCreateManyInput[] = [];
        for (const item of dto.items) {
          // BC-9: un instructor inválido no rompe el alta; la fila nace NEEDS_REVIEW.
          const { instructor, reason } = await this.settleCreateInstructor(
            userId,
            item,
          );
          const row = this.toItemCreateData(batch.batch_id, item, instructor);
          if (reason) {
            row.status = CertificateBulkImportItemStatus.NEEDS_REVIEW;
            row.rejection_reason = reason;
          }
          rows.push(row);
        }
        await tx.certificate_bulk_import_items.createMany({ data: rows });
        await this.downgradeInvalidReadyItems(tx, userId, batch.batch_id);
      }

      await this.recordEvent(tx, batch.batch_id, null, 'DRAFT_CREATED', userId);

      return toPublicImportBatch(batch, this.translations.getCurrentLocale());
    });
  }

  async processOcr(userId: string, batchId: string) {
    await this.loadReadableOcrBatch(userId, batchId);
    if (!this.ocrQueue) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    }

    try {
      await this.ocrQueue.add(
        CERTIFICATE_OCR_JOB,
        { userId, batchId },
        {
          jobId: `certificate-ocr-${batchId}`,
          attempts: 2,
          backoff: { type: 'fixed', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail: { age: 3_600, count: 20 },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/already exists|already waiting|jobid/i.test(message)) {
        this.logger.error('certificate OCR enqueue failed');
        throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
      }
      return this.getBatch(userId, batchId);
    }

    await this.recordEvent(this.prisma, batchId, null, 'OCR_QUEUED', userId, {
      queued: true,
    });
    return this.getBatch(userId, batchId);
  }

  async runQueuedOcr(userId: string, batchId: string) {
    const { batch, readable } = await this.loadReadableOcrBatch(
      userId,
      batchId,
    );
    const started = Date.now();
    const ocrResult = await this.ocrProvider.extract(
      readable.map((file) => ({
        fileUrl: file.object_key as string,
        fileName: file.file_name,
        fileType: file.file_type,
        objectKey: file.object_key,
        sizeBytes: file.size_bytes == null ? null : Number(file.size_bytes),
        fileId: file.file_id,
        confirmedAt: file.confirmed_at,
      })),
    );

    const stored = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.certificate_bulk_import_items.findMany({
        where: { batch_id: batchId, active: true },
        select: {
          item_id: true,
          status: true,
          honor_id: true,
          class_id: true,
          revision: true,
          instructor_user_id: true,
          instructor_name: true,
        },
      });
      // Solo se descartan las filas que el miembro todavía no tocó: un reproceso
      // no borra lo que ya completó (catálogo, instructor o cualquier edición).
      const disposableIds = existing
        .filter(
          (item) =>
            item.status === 'NEEDS_REVIEW' &&
            !item.honor_id &&
            !item.class_id &&
            !item.instructor_user_id &&
            !item.instructor_name &&
            (item.revision ?? 0) === 0,
        )
        .map((item) => item.item_id);
      if (disposableIds.length > 0) {
        await tx.certificate_bulk_import_items.updateMany({
          where: { item_id: { in: disposableIds } },
          data: { active: false },
        });
      }

      if (ocrResult.items.length > 0) {
        // Solo se guarda un archivo de origen que sigue siendo del lote; la página
        // no tiene sentido sin su archivo (D4, D12).
        const readableIds = new Set(readable.map((file) => file.file_id));
        await tx.certificate_bulk_import_items.createMany({
          data: ocrResult.items.map((item) => {
            const sourceFileId =
              item.sourceFileId && readableIds.has(item.sourceFileId)
                ? item.sourceFileId
                : null;
            return {
              source_file_id: sourceFileId,
              source_page: sourceFileId ? (item.sourcePage ?? null) : null,
              batch_id: batch.batch_id,
              item_type: item.type,
              detected_name: item.detectedName,
              detected_date: this.toDate(item.detectedDate ?? item.completedAt),
              completed_at: this.toDate(item.completedAt),
              ocr_confidence: item.confidence,
              field_confidence: this.toInputJson(item.fieldConfidence),
              status: CertificateBulkImportItemStatus.NEEDS_REVIEW,
            };
          }),
        });
      }

      await this.recordEvent(tx, batchId, null, 'OCR_PROCESSED', userId, {
        item_count: ocrResult.items.length,
        institutional_count: ocrResult.items.filter(
          (item) => item.fieldConfidence.institutional === 1,
        ).length,
      });

      const updated = await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: {
          raw_ocr_payload: this.toInputJson({
            rawText: ocrResult.rawText,
            items: ocrResult.items,
          }),
        },
        include: this.batchInclude(),
      });
      return updated;
    });
    this.logger.log(
      `certificate OCR stored ${ocrResult.items.length} suggestions in ${Date.now() - started}ms`,
    );
    return stored;
  }

  private async loadReadableOcrBatch(userId: string, batchId: string) {
    const batch = await this.findOwnedBatchWithFiles(
      this.prisma,
      userId,
      batchId,
    );
    this.assertDraftLike(batch.status, 'process OCR');

    const activeFiles = batch.files.filter((file) => file.active !== false);
    for (const file of activeFiles) {
      normalizeCertificateImportFileRef(file.file_url);
    }
    const readable = activeFiles.filter(
      (file) =>
        file.upload_status === 'CONFIRMED' &&
        !!file.object_key &&
        !/^https?:\/\//i.test(file.object_key),
    );
    if (readable.length === 0) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }
    return { batch, readable };
  }

  async getBatch(userId: string, batchId: string) {
    const batch = await this.prisma.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
      include: this.batchInclude(),
    });
    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }
    return toPublicImportBatch(
      batch,
      this.translations.getCurrentLocale(),
      await this.instructorPhotos(batch.items),
    );
  }

  /**
   * Clases que este flujo permite elegir. Misma regla que `assertCatalogChoice`:
   * activas, más las institucionales aunque estén inactivas, y SIN ventana de
   * disponibilidad por año. `GET /classes` oculta las clases retiradas, y un
   * certificado histórico puede ser de una de ellas.
   */
  async listClassCatalog(clubTypeId?: number) {
    const locale = this.translations.getCurrentLocale();
    const rows = await this.prisma.classes.findMany({
      where: {
        ...(clubTypeId ? { club_type_id: clubTypeId } : {}),
        OR: [
          { active: true },
          { asset_code: { in: [...INSTITUTIONAL_CLASS_ASSET_CODES] } },
        ],
      },
      select: {
        class_id: true,
        name: true,
        asset_code: true,
        club_type_id: true,
        translations: {
          where: { locale },
          select: { locale: true, name: true },
        },
      },
      orderBy: [
        { club_type_id: 'asc' },
        { display_order: 'asc' },
        { class_id: 'asc' },
      ],
    });
    return rows.map((row) => ({
      class_id: row.class_id,
      name: localizedName(row, locale),
      asset_code: row.asset_code,
      club_type_id: row.club_type_id,
      institutional: INSTITUTIONAL_CLASS_ASSET_CODES.has(row.asset_code ?? ''),
    }));
  }

  async listMine(userId: string, page = 1, limit = 20) {
    const take = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;
    const where = { user_id: userId, active: true };
    const [items, total] = await Promise.all([
      this.prisma.certificate_bulk_import_batches.findMany({
        where,
        orderBy: { modified_at: 'desc' },
        skip,
        take,
        include: {
          files: {
            where: { active: true },
            select: { file_id: true, upload_status: true },
          },
          items: {
            where: { active: true },
            select: { item_id: true, status: true },
          },
        },
      }),
      this.prisma.certificate_bulk_import_batches.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), limit: take };
  }

  async addItem(
    userId: string,
    batchId: string,
    dto: UpdateCertificateImportItemDto,
  ) {
    const created = await this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'add item');
      this.assertRevision(batch.revision, dto.expected_revision);
      // BC-9 / BCR-9 / BCR33-N5: at creation (addItem, createDraft items[])
      // per-item validation never fails the call: the item is born NEEDS_REVIEW
      // with the code as rejection_reason, whether or not mark_as_ready is set.
      // updateItem is the explicit edit path and keeps answering 400 for the
      // same future date or invalid catalog on purpose.
      let reviewReason: string | null = this.dateRangeReason(dto.completed_at);
      // El instructor se resuelve aparte: si el catálogo falla, uno válido igual se guarda.
      const { instructor, reason: instructorReason } =
        await this.settleCreateInstructor(batch.user_id, dto);
      if (!reviewReason) {
        try {
          await this.assertCatalogChoice(tx, dto);
          await this.assertClubTypeMatches(tx, dto);
          await this.assertClassAgeIfReady(tx, batch.user_id, dto);
        } catch (error) {
          reviewReason = this.reviewReason(error);
          if (!reviewReason) {
            throw error;
          }
        }
      }
      const count = await tx.certificate_bulk_import_items.count({
        where: { batch_id: batchId, active: true },
      });
      if (count >= 100) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_LIMIT');
      }
      reviewReason ??= instructorReason;
      const data = this.toItemCreateData(batchId, dto, instructor);
      if (reviewReason) {
        data.status = CertificateBulkImportItemStatus.NEEDS_REVIEW;
        data.rejection_reason = reviewReason;
      }
      const item = await tx.certificate_bulk_import_items.create({
        data,
        include: this.itemInclude(),
      });
      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { revision: (batch.revision ?? 0) + 1 },
      });
      await this.recordEvent(tx, batchId, item.item_id, 'ITEM_ADDED', userId, {
        changed_fields: this.changedFields(null, item),
      });
      return item;
    });
    return this.presentItem(created);
  }

  async removeItem(userId: string, batchId: string, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'remove item');
      const item = await this.findOwnedItem(tx, batchId, itemId);
      if (
        item.status === CertificateBulkImportItemStatus.APPROVED ||
        item.status === CertificateBulkImportItemStatus.SUBMITTED ||
        item.status === CertificateBulkImportItemStatus.RESUBMITTED
      ) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_LOCKED');
      }
      await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: { active: false, revision: (item.revision ?? 0) + 1 },
      });
      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { revision: (batch.revision ?? 0) + 1 },
      });
      await this.recordEvent(tx, batchId, itemId, 'ITEM_REMOVED', userId);
      return { item_id: itemId, active: false };
    });
  }

  async updateItem(
    userId: string,
    batchId: string,
    itemId: string,
    dto: UpdateCertificateImportItemDto,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'update item');
      const existing = await this.findOwnedItem(tx, batchId, itemId);
      this.assertRevision(existing.revision, dto.expected_revision);

      const merged = this.mergeItem(existing, dto);
      this.assertDateInRange(merged.completed_at);
      await this.assertInstructorChoice(batch.user_id, existing, dto);
      await this.assertClubTypeMatches(tx, merged);
      if (dto.mark_as_ready) {
        await this.assertCatalogChoice(tx, merged);
        await this.assertClassAgeIfReady(tx, batch.user_id, merged);
      }

      let status = dto.mark_as_ready
        ? this.isReady(merged)
          ? CertificateBulkImportItemStatus.READY
          : CertificateBulkImportItemStatus.NEEDS_REVIEW
        : existing.status;
      if (
        !dto.mark_as_ready &&
        existing.status === CertificateBulkImportItemStatus.READY &&
        merged.item_type === CertificateBulkImportItemType.CLASS
      ) {
        status = await this.readyStatusAfterClassEdit(
          tx,
          batch.user_id,
          merged,
        );
      }

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          ...this.toItemUpdateData(dto, merged),
          ...(dto.mark_as_ready
            ? { status, rejection_reason: null }
            : { status }),
          revision: (existing.revision ?? 0) + 1,
        },
        include: this.itemInclude(),
      });

      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { revision: (batch.revision ?? 0) + 1 },
      });

      await this.recordEvent(tx, batchId, itemId, 'ITEM_UPDATED', userId, {
        status,
        changed_fields: this.changedFields(existing, item),
      });

      return item;
    });
    return this.presentItem(updated);
  }

  async submit(userId: string, batchId: string) {
    const submittedBatch = await this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'submit');

      const activeCount = await tx.certificate_bulk_import_items.count({
        where: { batch_id: batch.batch_id, active: true },
      });
      if (activeCount === 0) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEMS_INCOMPLETE');
      }

      const confirmedFiles = await tx.certificate_bulk_import_files.count({
        where: {
          batch_id: batch.batch_id,
          active: true,
          upload_status: 'CONFIRMED',
          object_key: { not: null },
        },
      });
      if (confirmedFiles === 0) {
        throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
      }

      const classItems = await tx.certificate_bulk_import_items.findMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
          item_type: CertificateBulkImportItemType.CLASS,
        },
        select: {
          item_id: true,
          class: { select: { asset_code: true } },
        },
      });
      const institutionalIds = classItems
        .filter((item) =>
          INSTITUTIONAL_CLASS_ASSET_CODES.has(item.class?.asset_code ?? ''),
        )
        .map((item) => item.item_id);
      if (institutionalIds.length === activeCount) {
        throw new BadRequestException(
          'CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED',
        );
      }

      const incompleteItems = await tx.certificate_bulk_import_items.findMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
          item_id: { notIn: institutionalIds },
          status: {
            notIn: [
              CertificateBulkImportItemStatus.READY,
              CertificateBulkImportItemStatus.RESUBMITTED,
            ],
          },
        },
        select: { item_id: true, status: true },
      });

      if (incompleteItems.length > 0) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEMS_INCOMPLETE');
      }

      const readyClassItems = await tx.certificate_bulk_import_items.findMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
          item_type: CertificateBulkImportItemType.CLASS,
          item_id: { notIn: institutionalIds },
          status: {
            in: [
              CertificateBulkImportItemStatus.READY,
              CertificateBulkImportItemStatus.RESUBMITTED,
            ],
          },
        },
        select: {
          class_id: true,
          completed_at: true,
        },
      });
      await lockInvestitureYearsAscending(
        tx,
        await ecclesiasticalYearIdsCovering(
          tx,
          readyClassItems.map((item) => item.completed_at),
        ),
      );
      for (const readyClassItem of readyClassItems) {
        if (!readyClassItem.class_id) {
          throw new BadRequestException(
            'CERTIFICATE_IMPORT_ITEM_MISSING_CLASS',
          );
        }
        await this.assertClassCertificateMayProceed(
          tx,
          {
            userId: batch.user_id,
            classId: readyClassItem.class_id,
            completedAt: readyClassItem.completed_at,
          },
          { skipYearAdvisory: true },
        );
      }

      await tx.certificate_bulk_import_items.updateMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
          item_id: { notIn: institutionalIds },
          status: {
            in: [
              CertificateBulkImportItemStatus.READY,
              CertificateBulkImportItemStatus.RESUBMITTED,
            ],
          },
        },
        data: { status: CertificateBulkImportItemStatus.SUBMITTED },
      });

      await this.recordEvent(tx, batchId, null, 'BATCH_SUBMITTED', userId);

      const submitted = await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batch.batch_id },
        data: {
          status: 'SUBMITTED',
          submitted_at: new Date(),
          revision: (batch.revision ?? 0) + 1,
        },
        include: this.batchInclude(),
      });
      return submitted;
    });
    return toPublicImportBatch(
      submittedBatch,
      this.translations.getCurrentLocale(),
      await this.instructorPhotos(submittedBatch.items),
    );
  }

  async resubmitItem(
    userId: string,
    batchId: string,
    itemId: string,
    dto: UpdateCertificateImportItemDto,
  ) {
    const resubmitted = await this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      const existingItem = await this.findOwnedItem(tx, batchId, itemId);

      if (existingItem.status !== CertificateBulkImportItemStatus.REJECTED) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_NOT_REJECTED');
      }

      const merged = this.mergeItem(existingItem, dto);
      this.assertDateInRange(merged.completed_at);
      if (!this.isReady({ ...merged, mark_as_ready: true })) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_INCOMPLETE');
      }
      await this.assertInstructorChoice(batch.user_id, existingItem, dto);
      await this.assertClubTypeMatches(tx, merged);
      await this.assertCatalogChoice(tx, merged);
      await lockInvestitureYearsAscending(
        tx,
        await ecclesiasticalYearIdsCovering(tx, [merged.completed_at]),
      );
      await this.assertClassAgeIfReady(
        tx,
        batch.user_id,
        {
          ...merged,
          mark_as_ready: true,
        },
        { skipYearAdvisory: true },
      );

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          ...this.toItemUpdateData(dto, merged),
          status: CertificateBulkImportItemStatus.RESUBMITTED,
          rejection_reason: null,
          revision: (existingItem.revision ?? 0) + 1,
        },
        include: this.itemInclude(),
      });

      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batch.batch_id },
        data: { status: 'SUBMITTED' },
      });

      await this.recordEvent(tx, batchId, itemId, 'ITEM_RESUBMITTED', userId, {
        changed_fields: this.changedFields(existingItem, item),
      });

      return item;
    });
    return this.presentItem(resubmitted);
  }

  private async findOwnedBatch(
    tx: Pick<
      PrismaService | Prisma.TransactionClient,
      'certificate_bulk_import_batches'
    >,
    userId: string,
    batchId: string,
  ) {
    const batch = await tx.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
    });

    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }

    return batch;
  }

  private async findOwnedBatchWithFiles(
    tx: Pick<Prisma.TransactionClient, 'certificate_bulk_import_batches'>,
    userId: string,
    batchId: string,
  ) {
    const batch = await tx.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
      include: { files: true },
    });

    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }

    return batch;
  }

  private async findOwnedItem(
    tx: Pick<
      PrismaService | Prisma.TransactionClient,
      'certificate_bulk_import_items'
    >,
    batchId: string,
    itemId: string,
  ) {
    const item = await tx.certificate_bulk_import_items.findFirst({
      where: { item_id: itemId, batch_id: batchId, active: true },
    });

    if (!item) {
      throw new NotFoundException('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
    }

    return item;
  }

  private assertDraftLike(status: string, action: string): void {
    if (!['DRAFT', 'NEEDS_CORRECTION'].includes(status)) {
      throw new BadRequestException(
        `CERTIFICATE_IMPORT_CANNOT_${action.toUpperCase().replaceAll(' ', '_')}`,
      );
    }
  }

  private reviewReason(error: unknown): string | null {
    if (
      error instanceof AppBadRequestException ||
      error instanceof AppConflictException
    ) {
      return error.code;
    }
    if (error instanceof BadRequestException) {
      // BCR33-N3: Nest 11 builds `{ message, error, statusCode }` for
      // `new BadRequestException('CODE')`; older shapes returned the string.
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }
      const message = (response as { message?: unknown }).message;
      if (typeof message === 'string' && /^[A-Z][A-Z0-9_]+$/.test(message)) {
        return message;
      }
    }
    return null;
  }

  private async downgradeInvalidReadyItems(
    tx: Prisma.TransactionClient,
    userId: string,
    batchId: string,
  ): Promise<void> {
    const ready = await tx.certificate_bulk_import_items.findMany({
      where: { batch_id: batchId, status: 'READY' },
    });
    for (const item of ready) {
      const futureReason = this.dateRangeReason(
        this.civilDate(item.completed_at),
      );
      if (futureReason) {
        await tx.certificate_bulk_import_items.update({
          where: { item_id: item.item_id },
          data: {
            status: CertificateBulkImportItemStatus.NEEDS_REVIEW,
            rejection_reason: futureReason,
          },
        });
        continue;
      }
      try {
        await this.assertCatalogChoice(tx, item);
        if (item.class_id) {
          await this.assertClassCertificateMayProceed(tx, {
            userId,
            classId: item.class_id,
            completedAt: item.completed_at,
          });
        }
      } catch (error) {
        const reason = this.reviewReason(error);
        if (!reason) {
          throw error;
        }
        await tx.certificate_bulk_import_items.update({
          where: { item_id: item.item_id },
          data: {
            status: CertificateBulkImportItemStatus.NEEDS_REVIEW,
            rejection_reason: reason,
          },
        });
      }
    }
  }

  private toItemCreateData(
    batchId: string,
    item: UpdateCertificateImportItemDto,
    instructor: InstructorFields = NO_INSTRUCTOR,
  ): Prisma.certificate_bulk_import_itemsCreateManyInput {
    if (!item.item_type) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_TYPE_REQUIRED');
    }

    return {
      batch_id: batchId,
      item_type: item.item_type,
      honor_id:
        item.item_type === CertificateBulkImportItemType.HONOR
          ? (item.honor_id ?? null)
          : null,
      class_id:
        item.item_type === CertificateBulkImportItemType.CLASS
          ? (item.class_id ?? null)
          : null,
      instructor_user_id: instructor.instructor_user_id,
      instructor_name: instructor.instructor_name,
      detected_name: item.detected_name,
      detected_date: this.toDate(item.detected_date),
      completed_at: this.toDate(item.completed_at),
      ocr_confidence: item.ocr_confidence,
      field_confidence: this.toInputJson(item.field_confidence),
      status: this.isReady(item)
        ? CertificateBulkImportItemStatus.READY
        : CertificateBulkImportItemStatus.NEEDS_REVIEW,
    };
  }

  /**
   * Inconsistencia 4: tipo, catálogo e instructor salen de `mergeItem`
   * ("undefined = no cambia"), no de que el body traiga `item_type`. Cambiar el
   * tipo limpia el id del tipo anterior y el instructor si pasa a CLASS; un
   * PATCH que no los menciona los deja como estaban.
   */
  private toItemUpdateData(
    dto: UpdateCertificateImportItemDto,
    merged: ReturnType<CertificateBulkImportsService['mergeItem']>,
  ): Prisma.certificate_bulk_import_itemsUncheckedUpdateInput {
    const data: Prisma.certificate_bulk_import_itemsUncheckedUpdateInput = {
      item_type: merged.item_type as CertificateBulkImportItemType,
      honor_id: merged.honor_id,
      class_id: merged.class_id,
      instructor_user_id: merged.instructor_user_id,
      instructor_name: merged.instructor_name,
    };

    if (dto.detected_name !== undefined) {
      data.detected_name = dto.detected_name;
    }

    if (dto.detected_date !== undefined) {
      data.detected_date = this.toDate(dto.detected_date);
    }

    if (dto.completed_at !== undefined) {
      data.completed_at = this.toDate(dto.completed_at);
    }

    if (dto.ocr_confidence !== undefined) {
      data.ocr_confidence = dto.ocr_confidence;
    }

    if (dto.field_confidence !== undefined) {
      data.field_confidence = this.toInputJson(dto.field_confidence);
    }

    return data;
  }

  private mergeItem(
    existing: {
      item_type: string;
      honor_id?: number | null;
      class_id?: number | null;
      completed_at?: Date | null;
      instructor_user_id?: string | null;
      instructor_name?: string | null;
    },
    dto: UpdateCertificateImportItemDto,
  ) {
    const itemType = dto.item_type ?? existing.item_type;
    return {
      ...this.resolveInstructor(existing, dto, itemType),
      club_type_id: dto.club_type_id,
      item_type: itemType,
      honor_id:
        itemType === CertificateBulkImportItemType.HONOR
          ? (dto.honor_id ?? existing.honor_id ?? null)
          : null,
      class_id:
        itemType === CertificateBulkImportItemType.CLASS
          ? (dto.class_id ?? existing.class_id ?? null)
          : null,
      completed_at: dto.completed_at ?? this.civilDate(existing.completed_at),
      mark_as_ready: dto.mark_as_ready,
    };
  }

  /**
   * Instructor resultante de aplicar `dto` sobre `existing` (undefined = no
   * cambia, null = borra, valor = asigna y limpia el otro). Solo validación
   * sincrónica: la elegibilidad la decide `InstructorsService` al elegirlo.
   */
  private resolveInstructor(
    existing: Partial<InstructorFields> | null,
    dto: UpdateCertificateImportItemDto,
    itemType: string | undefined,
  ): InstructorFields {
    const givenUser = typeof dto.instructor_user_id === 'string';
    const givenName = typeof dto.instructor_name === 'string';
    if (givenUser && givenName) {
      throw new AppBadRequestException(ErrorCode.HONOR_INSTRUCTOR_AMBIGUOUS);
    }
    if (itemType === CertificateBulkImportItemType.CLASS) {
      if (givenUser || givenName) {
        throw new AppBadRequestException(
          ErrorCode.CERTIFICATE_IMPORT_HONOR_INSTRUCTOR_NOT_ALLOWED,
        );
      }
      return NO_INSTRUCTOR;
    }
    let user = existing?.instructor_user_id ?? null;
    let name = existing?.instructor_name ?? null;
    if (dto.instructor_user_id !== undefined) {
      user = dto.instructor_user_id;
      if (givenUser) name = null;
    }
    if (dto.instructor_name !== undefined) {
      name = dto.instructor_name;
      if (givenName) user = null;
    }
    return { instructor_user_id: user, instructor_name: name };
  }

  /**
   * Alta (BC-9): un instructor inválido no rompe la llamada. Devuelve el
   * instructor a guardar (ninguno si falló) y el código para `rejection_reason`.
   */
  private async settleCreateInstructor(
    ownerUserId: string,
    dto: UpdateCertificateImportItemDto,
  ): Promise<{ instructor: InstructorFields; reason: string | null }> {
    try {
      const instructor = this.resolveInstructor(null, dto, dto.item_type);
      await this.assertInstructorChoice(ownerUserId, null, dto);
      return { instructor, reason: null };
    } catch (error) {
      const reason = this.reviewReason(error);
      if (!reason) throw error;
      return { instructor: NO_INSTRUCTOR, reason };
    }
  }

  /** Elegibilidad contra el DUEÑO del lote, solo si el cliente asigna un usuario nuevo. */
  private async assertInstructorChoice(
    ownerUserId: string,
    existing: Partial<InstructorFields> | null,
    dto: UpdateCertificateImportItemDto,
  ) {
    const chosen = dto.instructor_user_id;
    if (typeof chosen === 'string' && chosen !== existing?.instructor_user_id) {
      await this.instructors.assertEligible(ownerUserId, chosen);
    }
  }

  /** `club_type_id` es solo una verificación de coherencia; no se guarda. */
  private async assertClubTypeMatches(
    tx: Prisma.TransactionClient,
    item: {
      item_type?: string | null;
      class_id?: number | null;
      club_type_id?: number;
    },
  ) {
    if (
      item.club_type_id === undefined ||
      !item.class_id ||
      item.item_type !== CertificateBulkImportItemType.CLASS
    ) {
      return;
    }
    const klass = await tx.classes.findUnique({
      where: { class_id: item.class_id },
      select: { club_type_id: true },
    });
    if (klass && klass.club_type_id !== item.club_type_id) {
      throw new AppBadRequestException(
        ErrorCode.CERTIFICATE_IMPORT_CLASS_CLUB_TYPE_MISMATCH,
      );
    }
  }

  /** Nombres de los campos que cambiaron, sin valores (el nombre libre no va a la auditoría). */
  private changedFields(
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): string[] {
    const comparable = (value: unknown) =>
      value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value ?? null);
    return AUDITED_ITEM_FIELDS.filter(
      (field) => comparable(before?.[field]) !== comparable(after[field]),
    );
  }

  private assertRevision(
    current: number | null | undefined,
    expected?: number,
  ) {
    if (expected === undefined) return;
    if (expected !== (current ?? 0)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_REVISION_CONFLICT');
    }
  }

  /** D6: `1960-01-01 <= fecha <= hoy`. Mensaje plano, como el resto del módulo. */
  private assertDateInRange(completedAt?: string) {
    if (!completedAt) return;
    const issue = checkDateInRange(completedAt);
    if (issue === 'TOO_OLD') {
      throw new BadRequestException('CERTIFICATE_IMPORT_DATE_TOO_OLD');
    }
    if (issue === 'IN_FUTURE') {
      throw new BadRequestException('CERTIFICATE_IMPORT_DATE_IN_FUTURE');
    }
    if (issue === 'INVALID') {
      throw new BadRequestException('CERTIFICATE_IMPORT_DATE_INVALID');
    }
  }

  private dateRangeReason(completedAt?: string): string | null {
    try {
      this.assertDateInRange(completedAt);
      return null;
    } catch (error) {
      if (error instanceof BadRequestException) {
        return error.message;
      }
      throw error;
    }
  }

  private async readyStatusAfterClassEdit(
    tx: Prisma.TransactionClient,
    userId: string,
    item: {
      item_type?: string | null;
      class_id?: number | null;
      completed_at?: string | null;
    },
  ): Promise<CertificateBulkImportItemStatus> {
    if (!this.isReady({ ...item, mark_as_ready: true }) || !item.class_id) {
      return CertificateBulkImportItemStatus.NEEDS_REVIEW;
    }
    try {
      await this.assertClassCertificateMayProceed(tx, {
        userId,
        classId: item.class_id,
        completedAt: item.completed_at,
      });
      return CertificateBulkImportItemStatus.READY;
    } catch (error) {
      if (
        !isCertificateHistoricalGateError(error) &&
        !isCertificateAuthorizationPending(error)
      ) {
        throw error;
      }
      return CertificateBulkImportItemStatus.NEEDS_REVIEW;
    }
  }

  private async assertClassAgeIfReady(
    tx: Prisma.TransactionClient,
    userId: string,
    item: {
      item_type?: string | null;
      class_id?: number | null;
      completed_at?: string | null;
      mark_as_ready?: boolean;
    },
    locks?: CertificateYearLockOptions,
  ) {
    if (
      item.item_type !== CertificateBulkImportItemType.CLASS ||
      !item.class_id ||
      !this.isReady({ ...item, mark_as_ready: true })
    ) {
      return;
    }
    if (!item.mark_as_ready) {
      return;
    }
    await this.assertClassCertificateMayProceed(
      tx,
      {
        userId,
        classId: item.class_id,
        completedAt: item.completed_at,
      },
      locks,
    );
  }

  private async assertClassCertificateMayProceed(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      classId: number;
      completedAt: Date | string | null | undefined;
    },
    locks?: CertificateYearLockOptions,
  ) {
    const age = await assertClassCertificateHistoricalAge(tx, params, locks);
    await rejectSameYearLiveAuthorization(tx as never, {
      userId: params.userId,
      classId: params.classId,
      certificateYearId: age.yearId,
    });
  }

  private async assertCatalogChoice(
    tx: Prisma.TransactionClient,
    item: {
      item_type?: string | null;
      honor_id?: number | null;
      class_id?: number | null;
    },
  ) {
    if (
      item.item_type === CertificateBulkImportItemType.HONOR &&
      item.honor_id
    ) {
      const honor = await tx.honors.findUnique({
        where: { honor_id: item.honor_id },
        select: { active: true },
      });
      if (!honor?.active) {
        throw new BadRequestException('CERTIFICATE_IMPORT_CATALOG_NOT_FOUND');
      }
    }

    if (
      item.item_type === CertificateBulkImportItemType.CLASS &&
      item.class_id
    ) {
      const klass = await tx.classes.findUnique({
        where: { class_id: item.class_id },
        select: { active: true, asset_code: true },
      });
      const institutional = INSTITUTIONAL_CLASS_ASSET_CODES.has(
        klass?.asset_code ?? '',
      );
      if (!klass || (!klass.active && !institutional)) {
        throw new BadRequestException('CERTIFICATE_IMPORT_CATALOG_NOT_FOUND');
      }
    }
  }

  private civilDate(value?: Date | string | null): string | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') return value.slice(0, 10);
    return value.toISOString().slice(0, 10);
  }

  private isReady(dto: {
    item_type?: string | null;
    honor_id?: number | null;
    class_id?: number | null;
    completed_at?: string | null;
    mark_as_ready?: boolean;
  }): boolean {
    if (!dto.mark_as_ready || !dto.completed_at) {
      return false;
    }

    if (dto.item_type === CertificateBulkImportItemType.HONOR) {
      return Number.isInteger(dto.honor_id) && Number(dto.honor_id) > 0;
    }

    if (dto.item_type === CertificateBulkImportItemType.CLASS) {
      return Number.isInteger(dto.class_id) && Number(dto.class_id) > 0;
    }

    return false;
  }

  private toDate(value?: string): Date | undefined {
    return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
  }

  private toInputJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private itemInclude() {
    return catalogItemInclude(this.translations.getCurrentLocale(), true);
  }

  private async presentItem<I extends object>(item: I) {
    return toPublicImportItem(
      item,
      this.translations.getCurrentLocale(),
      await this.instructorPhotos([item]),
    );
  }

  /** URLs firmadas de las fotos de los instructores del sistema (una por usuario). */
  private instructorPhotos(
    items: ReadonlyArray<object> | undefined,
  ): Promise<Map<string, string | null>> {
    const users = new Map<
      string,
      { user_id: string; user_image: string | null }
    >();
    for (const item of items ?? []) {
      const user = (
        item as {
          instructor?: { user_id: string; user_image?: string | null } | null;
        }
      ).instructor;
      if (user) {
        users.set(user.user_id, {
          user_id: user.user_id,
          user_image: user.user_image ?? null,
        });
      }
    }
    return this.instructors.photoUrlsFor([...users.values()]);
  }

  private batchInclude() {
    return {
      files: true,
      items: {
        where: { active: true },
        orderBy: { created_at: 'asc' as const },
        include: this.itemInclude(),
      },
      events: {
        orderBy: { created_at: 'asc' as const },
      },
    };
  }

  private async recordEvent(
    tx: Pick<PrismaService, 'certificate_bulk_import_item_events'>,
    batchId: string,
    itemId: string | null,
    action: string,
    performedById: string,
    payload?: Record<string, unknown>,
  ) {
    await tx.certificate_bulk_import_item_events.create({
      data: {
        batch_id: batchId,
        item_id: itemId,
        action,
        performed_by_id: performedById,
        payload: this.toInputJson(payload),
      },
    });
  }
}
