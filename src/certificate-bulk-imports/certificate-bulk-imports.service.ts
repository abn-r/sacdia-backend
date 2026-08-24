import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { Inject } from '@nestjs/common';
import { normalizeCertificateImportFileRef } from './certificate-import-file-ref';

@Injectable()
export class CertificateBulkImportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CERTIFICATE_OCR_PROVIDER)
    private readonly ocrProvider: CertificateOcrProvider,
  ) {}

  async createDraft(userId: string, dto: CreateCertificateBulkImportDto) {
    const files = dto.files.map((file) => ({
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
          files: {
            create: files.map((file) => ({
              file_url: file.file_url,
              file_name: file.file_name,
              file_type: file.file_type,
              ocr_raw_text: file.ocr_raw_text,
              uploaded_by_id: userId,
            })),
          },
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
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.findOwnedBatchWithFiles(tx, userId, batchId);

      this.assertDraftLike(batch.status, 'process OCR');

      const fileRefs = batch.files.map((file) => ({
        fileUrl: normalizeCertificateImportFileRef(file.file_url),
        fileName: file.file_name,
        fileType: file.file_type,
        rawText: file.ocr_raw_text ?? undefined,
      }));

      const ocrResult = await this.ocrProvider.extract(fileRefs);

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
      });

      return tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: {
          raw_ocr_payload: this.toInputJson({
            rawText: ocrResult.rawText,
            items: ocrResult.items,
          }),
        },
        include: this.batchInclude(),
      });
    });
  }

  async getBatch(userId: string, batchId: string) {
    return this.findOwnedBatch(
      this.prisma,
      userId,
      batchId,
      this.batchInclude(),
    );
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
      await this.findOwnedItem(tx, batchId, itemId);

      const status = this.isReady(dto)
        ? CertificateBulkImportItemStatus.READY
        : CertificateBulkImportItemStatus.NEEDS_REVIEW;

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          ...this.toItemUpdateData(dto),
          status,
          rejection_reason: null,
        },
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

      const incompleteItems = await tx.certificate_bulk_import_items.findMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
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

      await tx.certificate_bulk_import_items.updateMany({
        where: {
          batch_id: batch.batch_id,
          active: true,
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

      if (!this.isReady(dto)) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_INCOMPLETE');
      }

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          ...this.toItemUpdateData(dto),
          status: CertificateBulkImportItemStatus.RESUBMITTED,
          rejection_reason: null,
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

  private isReady(dto: UpdateCertificateImportItemDto): boolean {
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
