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
  isCertificateHistoricalGateError,
} from './class-certificate-historical-age';

const INSTITUTIONAL_CLASS_ASSET_CODES = new Set(['GM-02', 'GM-03']);

@Injectable()
export class CertificateBulkImportsService {
  private readonly logger = new Logger(CertificateBulkImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CERTIFICATE_OCR_PROVIDER)
    private readonly ocrProvider: CertificateOcrProvider,
    @Optional()
    @InjectQueue(CERTIFICATE_OCR_QUEUE)
    private readonly ocrQueue: Pick<Queue, 'add'> | null = null,
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
        await tx.certificate_bulk_import_items.createMany({
          data: dto.items.map((item) =>
            this.toItemCreateData(batch.batch_id, item),
          ),
        });
      }

      await this.recordEvent(tx, batch.batch_id, null, 'DRAFT_CREATED', userId);

      return batch;
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
        },
      });
      const disposableIds = existing
        .filter(
          (item) =>
            item.status === 'NEEDS_REVIEW' && !item.honor_id && !item.class_id,
        )
        .map((item) => item.item_id);
      if (disposableIds.length > 0) {
        await tx.certificate_bulk_import_items.updateMany({
          where: { item_id: { in: disposableIds } },
          data: { active: false },
        });
      }

      if (ocrResult.items.length > 0) {
        await tx.certificate_bulk_import_items.createMany({
          data: ocrResult.items.map((item) => ({
            batch_id: batch.batch_id,
            item_type: item.type,
            detected_name: item.detectedName,
            detected_date: this.toDate(item.completedAt),
            completed_at: this.toDate(item.completedAt),
            ocr_confidence: item.confidence,
            field_confidence: this.toInputJson(item.fieldConfidence),
            status: CertificateBulkImportItemStatus.NEEDS_REVIEW,
          })),
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
    return this.findOwnedBatch(
      this.prisma,
      userId,
      batchId,
      this.batchInclude(),
    );
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
          files: { where: { active: true }, select: { file_id: true, upload_status: true } },
          items: { where: { active: true }, select: { item_id: true, status: true } },
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
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'add item');
      this.assertRevision(batch.revision, dto.expected_revision);
      await this.assertCatalogChoice(tx, dto);
      await this.assertClassAgeIfReady(tx, batch.user_id, dto);
      const count = await tx.certificate_bulk_import_items.count({
        where: { batch_id: batchId, active: true },
      });
      if (count >= 100) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_LIMIT');
      }
      const item = await tx.certificate_bulk_import_items.create({
        data: this.toItemCreateData(batchId, dto),
      });
      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { revision: (batch.revision ?? 0) + 1 },
      });
      await this.recordEvent(tx, batchId, item.item_id, 'ITEM_ADDED', userId);
      return item;
    });
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
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      this.assertDraftLike(batch.status, 'update item');
      const existing = await this.findOwnedItem(tx, batchId, itemId);
      this.assertRevision(existing.revision, dto.expected_revision);

      const merged = this.mergeItem(existing, dto);
      this.assertNotFuture(merged.completed_at);
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
          ...this.toItemUpdateData(dto),
          ...(dto.mark_as_ready ? { status, rejection_reason: null } : { status }),
          revision: (existing.revision ?? 0) + 1,
        },
      });

      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { revision: (batch.revision ?? 0) + 1 },
      });

      await this.recordEvent(tx, batchId, itemId, 'ITEM_UPDATED', userId, {
        status,
      });

      return item;
    });
  }

  async submit(userId: string, batchId: string) {
    return this.prisma.$transaction(async (tx) => {
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
      for (const readyClassItem of readyClassItems) {
        if (!readyClassItem.class_id) {
          throw new BadRequestException(
            'CERTIFICATE_IMPORT_ITEM_MISSING_CLASS',
          );
        }
        await assertClassCertificateHistoricalAge(tx, {
          userId: batch.user_id,
          classId: readyClassItem.class_id,
          completedAt: readyClassItem.completed_at,
        });
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

      return tx.certificate_bulk_import_batches.update({
        where: { batch_id: batch.batch_id },
        data: {
          status: 'SUBMITTED',
          submitted_at: new Date(),
          revision: (batch.revision ?? 0) + 1,
        },
        include: this.batchInclude(),
      });
    });
  }

  async resubmitItem(
    userId: string,
    batchId: string,
    itemId: string,
    dto: UpdateCertificateImportItemDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatch(tx, userId, batchId);
      const existingItem = await this.findOwnedItem(tx, batchId, itemId);

      if (existingItem.status !== CertificateBulkImportItemStatus.REJECTED) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_NOT_REJECTED');
      }

      const merged = this.mergeItem(existingItem, dto);
      this.assertNotFuture(merged.completed_at);
      if (!this.isReady({ ...merged, mark_as_ready: true })) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_INCOMPLETE');
      }
      await this.assertCatalogChoice(tx, merged);
      await this.assertClassAgeIfReady(tx, batch.user_id, {
        ...merged,
        mark_as_ready: true,
      });

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          ...this.toItemUpdateData(dto),
          status: CertificateBulkImportItemStatus.RESUBMITTED,
          rejection_reason: null,
          revision: (existingItem.revision ?? 0) + 1,
        },
      });

      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batch.batch_id },
        data: { status: 'SUBMITTED' },
      });

      await this.recordEvent(tx, batchId, itemId, 'ITEM_RESUBMITTED', userId);

      return item;
    });
  }

  private async findOwnedBatch(
    tx: Pick<
      PrismaService | Prisma.TransactionClient,
      'certificate_bulk_import_batches'
    >,
    userId: string,
    batchId: string,
    include?: Prisma.certificate_bulk_import_batchesInclude,
  ) {
    const batch = await tx.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, user_id: userId, active: true },
      ...(include ? { include } : {}),
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

  private toItemCreateData(
    batchId: string,
    item: UpdateCertificateImportItemDto,
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

  private toItemUpdateData(
    dto: UpdateCertificateImportItemDto,
  ): Prisma.certificate_bulk_import_itemsUncheckedUpdateInput {
    const data: Prisma.certificate_bulk_import_itemsUncheckedUpdateInput = {};

    if (dto.item_type !== undefined) {
      data.item_type = dto.item_type;
      data.honor_id =
        dto.item_type === CertificateBulkImportItemType.HONOR
          ? (dto.honor_id ?? null)
          : null;
      data.class_id =
        dto.item_type === CertificateBulkImportItemType.CLASS
          ? (dto.class_id ?? null)
          : null;
    }

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
    },
    dto: UpdateCertificateImportItemDto,
  ) {
    const itemType = dto.item_type ?? existing.item_type;
    return {
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

  private assertRevision(current: number | null | undefined, expected?: number) {
    if (expected === undefined) return;
    if (expected !== (current ?? 0)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_REVISION_CONFLICT');
    }
  }

  private assertNotFuture(completedAt?: string) {
    if (!completedAt) return;
    const today = new Date().toISOString().slice(0, 10);
    if (completedAt > today) {
      throw new BadRequestException('CERTIFICATE_IMPORT_DATE_IN_FUTURE');
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
      await assertClassCertificateHistoricalAge(tx, {
        userId,
        classId: item.class_id,
        completedAt: item.completed_at,
      });
      return CertificateBulkImportItemStatus.READY;
    } catch (error) {
      if (!isCertificateHistoricalGateError(error)) throw error;
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
    await assertClassCertificateHistoricalAge(tx, {
      userId,
      classId: item.class_id,
      completedAt: item.completed_at,
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

  private batchInclude() {
    return {
      files: true,
      items: {
        where: { active: true },
        orderBy: { created_at: 'asc' as const },
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
