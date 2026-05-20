import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ApproveCertificateImportDto } from './dto';
import {
  CertificateBulkImportAppliedEntityType,
  CertificateBulkImportItemStatus,
  CertificateBulkImportItemType,
} from './certificate-bulk-imports.types';

type CertificateImportApplicationTransaction = Pick<
  Prisma.TransactionClient,
  | 'certificate_bulk_import_items'
  | 'certificate_bulk_import_batches'
  | 'users_honors'
  | 'evidence_files'
  | 'ecclesiastical_years'
  | 'enrollments'
  | 'investiture_validation_history'
  | 'certificate_bulk_import_item_events'
>;

const REVIEWABLE_ITEM_STATUSES = [
  CertificateBulkImportItemStatus.SUBMITTED,
  CertificateBulkImportItemStatus.RESUBMITTED,
];

type CertificateImportItemWithBatch = {
  item_id: string;
  item_type: string;
  honor_id?: number | null;
  class_id?: number | null;
  completed_at?: Date | null;
  status?: string | null;
  applied_entity_type?: string | null;
  applied_entity_id?: number | null;
  batch: {
    batch_id: string;
    user_id: string;
    files: Array<{
      file_url: string;
      file_name: string;
      file_type: string;
      uploaded_by_id: string;
    }>;
  };
};

@Injectable()
export class CertificateBulkImportApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async approveItem(
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: ApproveCertificateImportDto,
  ) {
    return this.prisma.$transaction((tx) =>
      this.approveItemInTransaction(tx, reviewerId, batchId, itemId, dto),
    );
  }

  async approveItemInTransaction(
    tx: CertificateImportApplicationTransaction,
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: ApproveCertificateImportDto,
  ) {
    const item = await this.findSubmittedItem(tx, batchId, itemId);

    if (item.applied_entity_id) {
      return item;
    }

    if (!item.completed_at) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_DATE');
    }

    if (item.item_type === CertificateBulkImportItemType.HONOR) {
      return this.approveHonorItem(tx, item, reviewerId, dto.comment);
    }

    if (item.item_type === CertificateBulkImportItemType.CLASS) {
      return this.approveClassItem(tx, item, reviewerId, dto.comment);
    }

    throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_TYPE_INVALID');
  }

  private async approveHonorItem(
    tx: CertificateImportApplicationTransaction,
    item: CertificateImportItemWithBatch,
    reviewerId: string,
    comment?: string,
  ) {
    if (!item.honor_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_HONOR');
    }

    const primaryFile = this.primaryFile(item);
    const now = new Date();
    const existingUserHonor = await tx.users_honors.findFirst({
      where: {
        user_id: item.batch.user_id,
        honor_id: item.honor_id,
      },
      select: { user_honor_id: true, active: true },
    });

    const userHonor = existingUserHonor
      ? await tx.users_honors.update({
          where: { user_honor_id: existingUserHonor.user_honor_id },
          data: {
            active: true,
            validate: true,
            validation_status: 'APPROVED',
            submitted_at: now,
            validated_by_id: reviewerId,
            validated_at: now,
            rejection_reason: null,
            certificate: primaryFile.file_url,
            images: item.batch.files.map((file) => file.file_url),
            date: item.completed_at!,
          },
        })
      : await tx.users_honors.create({
          data: {
            user_id: item.batch.user_id,
            honor_id: item.honor_id,
            active: true,
            validate: true,
            validation_status: 'APPROVED',
            submitted_at: now,
            validated_by_id: reviewerId,
            validated_at: now,
            rejection_reason: null,
            certificate: primaryFile.file_url,
            images: item.batch.files.map((file) => file.file_url),
            date: item.completed_at!,
          },
        });

    await tx.evidence_files.createMany({
      data: item.batch.files.map((file) => ({
        user_honor_id: userHonor.user_honor_id,
        file_url: file.file_url,
        file_name: file.file_name,
        file_type: file.file_type,
        uploaded_by_id: file.uploaded_by_id,
      })),
      skipDuplicates: true,
    });

    const updatedItem = await this.markItemApproved(
      tx,
      item,
      reviewerId,
      CertificateBulkImportAppliedEntityType.USER_HONOR,
      userHonor.user_honor_id,
    );

    await this.recordEvent(
      tx,
      item.batch.batch_id,
      item.item_id,
      'ITEM_APPROVED',
      reviewerId,
      comment,
      {
        applied_entity_type: 'USER_HONOR',
        applied_entity_id: userHonor.user_honor_id,
      },
    );

    return updatedItem;
  }

  private async approveClassItem(
    tx: CertificateImportApplicationTransaction,
    item: CertificateImportItemWithBatch,
    reviewerId: string,
    comment?: string,
  ) {
    if (!item.class_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_CLASS');
    }

    const year = await tx.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: item.completed_at! },
        end_date: { gte: item.completed_at! },
      },
      select: { year_id: true },
    });

    if (!year) {
      throw new BadRequestException('CERTIFICATE_IMPORT_YEAR_NOT_FOUND');
    }

    const now = new Date();
    const existingEnrollment = await tx.enrollments.findFirst({
      where: {
        user_id: item.batch.user_id,
        class_id: item.class_id,
        ecclesiastical_year_id: year.year_id,
      },
      select: { enrollment_id: true, active: true },
    });

    const enrollment = existingEnrollment
      ? await tx.enrollments.update({
          where: { enrollment_id: existingEnrollment.enrollment_id },
          data: {
            active: true,
            investiture_status: 'FIELD_APPROVED',
            submitted_for_validation: true,
            submitted_at: now,
            validated_by: reviewerId,
            validated_at: now,
            rejection_reason: null,
            investiture_date: item.completed_at!,
            locked_for_validation: true,
          },
        })
      : await tx.enrollments.create({
          data: {
            user_id: item.batch.user_id,
            class_id: item.class_id,
            ecclesiastical_year_id: year.year_id,
            enrollment_date: item.completed_at!,
            investiture_status: 'FIELD_APPROVED',
            submitted_for_validation: true,
            submitted_at: now,
            validated_by: reviewerId,
            validated_at: now,
            rejection_reason: null,
            investiture_date: item.completed_at!,
            locked_for_validation: true,
            active: true,
          },
        });

    await tx.investiture_validation_history.create({
      data: {
        enrollment_id: enrollment.enrollment_id,
        action: 'FIELD_APPROVED',
        performed_by: reviewerId,
        comments: comment ?? 'Validado por carga masiva de certificado',
      },
    });

    const updatedItem = await this.markItemApproved(
      tx,
      item,
      reviewerId,
      CertificateBulkImportAppliedEntityType.ENROLLMENT,
      enrollment.enrollment_id,
    );

    await this.recordEvent(
      tx,
      item.batch.batch_id,
      item.item_id,
      'ITEM_APPROVED',
      reviewerId,
      comment,
      {
        applied_entity_type: 'ENROLLMENT',
        applied_entity_id: enrollment.enrollment_id,
      },
    );

    return updatedItem;
  }

  private async findSubmittedItem(
    tx: Pick<Prisma.TransactionClient, 'certificate_bulk_import_items'>,
    batchId: string,
    itemId: string,
  ): Promise<CertificateImportItemWithBatch> {
    const item = await tx.certificate_bulk_import_items.findFirst({
      where: {
        item_id: itemId,
        batch_id: batchId,
        active: true,
        OR: [
          { status: { in: REVIEWABLE_ITEM_STATUSES } },
          {
            status: CertificateBulkImportItemStatus.APPROVED,
            applied_entity_id: { not: null },
          },
        ],
      },
      include: {
        batch: {
          include: {
            files: { where: { active: true } },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
    }

    if (
      !item.applied_entity_id &&
      !REVIEWABLE_ITEM_STATUSES.includes(
        item.status as CertificateBulkImportItemStatus,
      )
    ) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_NOT_REVIEWABLE');
    }

    return item;
  }

  private primaryFile(item: CertificateImportItemWithBatch) {
    const primaryFile = item.batch.files[0];
    if (!primaryFile) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_REQUIRED');
    }

    return primaryFile;
  }

  private async markItemApproved(
    tx: CertificateImportApplicationTransaction,
    item: CertificateImportItemWithBatch,
    reviewerId: string,
    appliedEntityType: CertificateBulkImportAppliedEntityType,
    appliedEntityId: number,
  ) {
    const updatedItem = await tx.certificate_bulk_import_items.update({
      where: { item_id: item.item_id },
      data: {
        status: CertificateBulkImportItemStatus.APPROVED,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
        rejection_reason: null,
        applied_entity_type: appliedEntityType,
        applied_entity_id: appliedEntityId,
      },
    });

    await tx.certificate_bulk_import_batches.update({
      where: { batch_id: item.batch.batch_id },
      data: { status: 'PARTIALLY_APPROVED', reviewed_at: new Date() },
    });

    return updatedItem;
  }

  private async recordEvent(
    tx: Pick<PrismaService, 'certificate_bulk_import_item_events'>,
    batchId: string,
    itemId: string,
    action: string,
    performedById: string,
    comment?: string,
    payload?: Record<string, unknown>,
  ) {
    await tx.certificate_bulk_import_item_events.create({
      data: {
        batch_id: batchId,
        item_id: itemId,
        action,
        performed_by_id: performedById,
        comment,
        payload: this.toInputJson(payload),
      },
    });
  }

  private toInputJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
