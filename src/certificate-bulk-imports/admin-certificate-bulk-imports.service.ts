import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';
import {
  ApproveCertificateImportDto,
  RejectCertificateImportDto,
} from './dto';
import { CertificateBulkImportItemStatus } from './certificate-bulk-imports.types';

type ReviewerAccess = {
  global: boolean;
  localFieldId: number | null;
};

const REVIEWABLE_ITEM_STATUSES = [
  CertificateBulkImportItemStatus.SUBMITTED,
  CertificateBulkImportItemStatus.RESUBMITTED,
];

@Injectable()
export class AdminCertificateBulkImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicationService: CertificateBulkImportApplicationService,
  ) {}

  async listPending(
    reviewerId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where = {
      active: true,
      status: { in: ['SUBMITTED', 'PARTIALLY_APPROVED'] },
      ...(access.global ? {} : { local_field_id: access.localFieldId }),
    };

    const [items, total] = await Promise.all([
      this.prisma.certificate_bulk_import_batches.findMany({
        where,
        include: this.batchInclude(),
        orderBy: { submitted_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.certificate_bulk_import_batches.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getDetail(reviewerId: string, batchId: string) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const batch = await this.findBatch(batchId);
    this.assertCanAccessBatch(access, batch.local_field_id);
    return batch;
  }

  async approveBatch(
    reviewerId: string,
    batchId: string,
    dto: ApproveCertificateImportDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.resolveReviewerAccess(reviewerId);
      const batch = await this.findBatch(batchId);
      this.assertCanAccessBatch(access, batch.local_field_id);

      const items = await tx.certificate_bulk_import_items.findMany({
        where: {
          batch_id: batchId,
          active: true,
          status: { in: REVIEWABLE_ITEM_STATUSES },
        },
        select: { item_id: true },
      });

      if (items.length === 0) {
        throw new BadRequestException('CERTIFICATE_IMPORT_NO_REVIEWABLE_ITEMS');
      }

      for (const item of items) {
        await this.applicationService.approveItem(
          reviewerId,
          batchId,
          item.item_id,
          dto,
        );
      }

      await this.recordEvent(tx, batchId, null, 'BATCH_APPROVED', reviewerId, dto.comment);

      return tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { status: 'APPROVED', reviewed_at: new Date() },
        include: this.batchInclude(),
      });
    });
  }

  async rejectBatch(
    reviewerId: string,
    batchId: string,
    dto: RejectCertificateImportDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.resolveReviewerAccess(reviewerId);
      const batch = await this.findBatch(batchId);
      this.assertCanAccessBatch(access, batch.local_field_id);

      await tx.certificate_bulk_import_items.updateMany({
        where: {
          batch_id: batchId,
          active: true,
          status: { in: REVIEWABLE_ITEM_STATUSES },
        },
        data: {
          status: CertificateBulkImportItemStatus.REJECTED,
          rejection_reason: dto.reason,
          reviewed_by_id: reviewerId,
          reviewed_at: new Date(),
        },
      });

      await this.recordEvent(tx, batchId, null, 'BATCH_REJECTED', reviewerId, dto.reason);

      return tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { status: 'NEEDS_CORRECTION', reviewed_at: new Date() },
        include: this.batchInclude(),
      });
    });
  }

  async approveItem(
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: ApproveCertificateImportDto,
  ) {
    const batch = await this.getDetail(reviewerId, batchId);
    const item = await this.applicationService.approveItem(
      reviewerId,
      batch.batch_id,
      itemId,
      dto,
    );
    return item;
  }

  async rejectItem(
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: RejectCertificateImportDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.resolveReviewerAccess(reviewerId);
      const batch = await this.findBatch(batchId);
      this.assertCanAccessBatch(access, batch.local_field_id);

      const item = await tx.certificate_bulk_import_items.update({
        where: { item_id: itemId },
        data: {
          status: CertificateBulkImportItemStatus.REJECTED,
          rejection_reason: dto.reason,
          reviewed_by_id: reviewerId,
          reviewed_at: new Date(),
        },
      });

      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { status: 'NEEDS_CORRECTION', reviewed_at: new Date() },
      });

      await this.recordEvent(tx, batchId, itemId, 'ITEM_REJECTED', reviewerId, dto.reason);

      return item;
    });
  }

  private async findBatch(batchId: string) {
    const batch = await this.prisma.certificate_bulk_import_batches.findFirst({
      where: { batch_id: batchId, active: true },
      include: this.batchInclude(),
    });

    if (!batch) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }

    return batch;
  }

  private async resolveReviewerAccess(
    reviewerId: string,
  ): Promise<ReviewerAccess> {
    const reviewer = await this.prisma.users.findUnique({
      where: { user_id: reviewerId },
      select: {
        local_field_id: true,
        users_roles: {
          where: { active: true },
          select: { roles: { select: { role_name: true } } },
        },
      },
    });

    if (!reviewer) {
      throw new ForbiddenException('CERTIFICATE_IMPORT_REVIEWER_NOT_FOUND');
    }

    const roles = new Set(
      reviewer.users_roles.map((entry) => entry.roles.role_name.toLowerCase()),
    );

    if (roles.has('super-admin')) {
      return { global: true, localFieldId: null };
    }

    if (
      (roles.has('admin') || roles.has('assistant-admin')) &&
      reviewer.local_field_id == null
    ) {
      return { global: true, localFieldId: null };
    }

    if (
      reviewer.local_field_id &&
      (roles.has('admin') ||
        roles.has('assistant-admin') ||
        roles.has('director-lf') ||
        roles.has('assistant-lf'))
    ) {
      return { global: false, localFieldId: reviewer.local_field_id };
    }

    throw new ForbiddenException('CERTIFICATE_IMPORT_REVIEWER_SCOPE_REQUIRED');
  }

  private assertCanAccessBatch(
    access: ReviewerAccess,
    batchLocalFieldId: number | null,
  ) {
    if (access.global) {
      return;
    }

    if (!access.localFieldId || access.localFieldId !== batchLocalFieldId) {
      throw new ForbiddenException('CERTIFICATE_IMPORT_BATCH_FORBIDDEN');
    }
  }

  private batchInclude() {
    return {
      user: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          email: true,
        },
      },
      files: { where: { active: true } },
      items: {
        where: { active: true },
        orderBy: { created_at: 'asc' as const },
        include: {
          honor: { select: { honor_id: true, name: true } },
          class: { select: { class_id: true, name: true } },
        },
      },
      events: { orderBy: { created_at: 'asc' as const } },
    };
  }

  private async recordEvent(
    tx: Pick<PrismaService, 'certificate_bulk_import_item_events'>,
    batchId: string,
    itemId: string | null,
    action: string,
    performedById: string,
    comment?: string,
  ) {
    await tx.certificate_bulk_import_item_events.create({
      data: {
        batch_id: batchId,
        item_id: itemId,
        action,
        performed_by_id: performedById,
        comment,
      },
    });
  }
}
