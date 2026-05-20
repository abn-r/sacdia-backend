import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

type CertificateImportTransaction = Pick<
  PrismaService,
  | 'certificate_bulk_import_batches'
  | 'certificate_bulk_import_items'
  | 'certificate_bulk_import_item_events'
>;

@Injectable()
export class CertificateBulkImportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CERTIFICATE_OCR_PROVIDER)
    private readonly ocrProvider: CertificateOcrProvider,
  ) {}

  async createDraft(userId: string, dto: CreateCertificateBulkImportDto) {
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
          raw_ocr_payload: dto.raw_ocr_payload,
          files: {
            create: dto.files.map((file) => ({
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
      const batch = await this.findOwnedBatch(tx, userId, batchId, {
        files: true,
      });

      this.assertDraftLike(batch.status, 'process OCR');

      const ocrResult = await this.ocrProvider.extract(
        batch.files.map((file) => ({
          fileUrl: file.file_url,
          fileName: file.file_name,
          fileType: file.file_type,
          rawText: file.ocr_raw_text ?? undefined,
        })),
      );

      if (ocrResult.items.length > 0) {
        await tx.certificate_bulk_import_items.createMany({
          data: ocrResult.items.map((item) => ({
            batch_id: batch.batch_id,
            item_type: item.type,
            detected_name: item.detectedName,
            detected_date: this.toDate(item.completedAt),
            completed_at: this.toDate(item.completedAt),
            ocr_confidence: item.confidence,
            field_confidence: item.fieldConfidence,
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
          raw_ocr_payload: {
            rawText: ocrResult.rawText,
            items: ocrResult.items,
          },
        },
        include: this.batchInclude(),
      });
    });
  }

  async getBatch(userId: string, batchId: string) {
    return this.findOwnedBatch(this.prisma, userId, batchId, this.batchInclude());
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
    tx: Pick<PrismaService, 'certificate_bulk_import_batches'>,
    userId: string,
    batchId: string,
    include?: Record<string, unknown>,
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

  private async findOwnedItem(
    tx: Pick<PrismaService, 'certificate_bulk_import_items'>,
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

  private toItemCreateData(batchId: string, item: UpdateCertificateImportItemDto) {
    return {
      batch_id: batchId,
      ...this.toItemUpdateData(item),
      status: this.isReady(item)
        ? CertificateBulkImportItemStatus.READY
        : CertificateBulkImportItemStatus.NEEDS_REVIEW,
    };
  }

  private toItemUpdateData(dto: UpdateCertificateImportItemDto) {
    return {
      item_type: dto.item_type,
      honor_id:
        dto.item_type === CertificateBulkImportItemType.HONOR
          ? dto.honor_id
          : null,
      class_id:
        dto.item_type === CertificateBulkImportItemType.CLASS
          ? dto.class_id
          : null,
      detected_name: dto.detected_name,
      detected_date: this.toDate(dto.detected_date),
      completed_at: this.toDate(dto.completed_at),
      ocr_confidence: dto.ocr_confidence,
      field_confidence: dto.field_confidence,
    };
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
        payload,
      },
    });
  }
}
