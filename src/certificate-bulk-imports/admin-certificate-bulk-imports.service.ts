import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CertificateBulkImportApplicationService } from './certificate-bulk-imports-application.service';
import { INSTITUTIONAL_CLASS_ASSET_CODES } from './institutional-class-codes';
import {
  toPublicImportFile,
  type PublicImportFile,
} from './certificate-import-response.mapper';
import {
  CertificateImportYearResolver,
  civilDateFromDbDate,
  classifyCertificateImportYear,
} from './certificate-import-year-resolver.service';
import { ApproveCertificateImportDto, RejectCertificateImportDto } from './dto';
import {
  CertificateBulkImportBatchStatus,
  CertificateBulkImportItemStatus,
} from './certificate-bulk-imports.types';

type ReviewerAccess = {
  global: boolean;
  localFieldId: number | null;
  superAdmin: boolean;
};

const REVIEWABLE_ITEM_STATUSES = [
  CertificateBulkImportItemStatus.SUBMITTED,
  CertificateBulkImportItemStatus.RESUBMITTED,
];

const REVIEWABLE_BATCH_STATUSES = [
  CertificateBulkImportBatchStatus.SUBMITTED,
  CertificateBulkImportBatchStatus.PARTIALLY_APPROVED,
];

@Injectable()
export class AdminCertificateBulkImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicationService: CertificateBulkImportApplicationService,
    private readonly yearResolver: CertificateImportYearResolver,
  ) {}

  async listPending(
    reviewerId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Prisma.certificate_bulk_import_batchesWhereInput = {
      active: true,
      status: { in: REVIEWABLE_BATCH_STATUSES },
      ...(access.global ? {} : { local_field_id: access.localFieldId }),
      items: { some: this.visibleCommonItemWhere() },
    };

    const [rows, total] = await Promise.all([
      this.prisma.certificate_bulk_import_batches.findMany({
        where,
        include: this.batchInclude(),
        orderBy: { submitted_at: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.certificate_bulk_import_batches.count({ where }),
    ]);

    return {
      items: rows.map((batch) => this.presentForReviewer(batch)),
      total,
      page,
      limit,
    };
  }

  async getDetail(reviewerId: string, batchId: string) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const found = await this.findBatch(batchId);
    this.assertCanAccessBatch(access, found.local_field_id);
    const batch = this.presentForReviewer(found);
    if ((batch.items ?? []).length === 0 && (batch.files ?? []).length === 0) {
      throw new NotFoundException('CERTIFICATE_IMPORT_BATCH_NOT_FOUND');
    }
    const items = batch.items ?? [];
    const blockers = await this.yearResolver.blockersForItems(items);
    return this.attachOperationalReconciliation({
      ...batch,
      items: items.map((item) => ({
        ...item,
        approval_blockers: blockers.get(item.item_id) ?? [],
      })),
    });
  }

  async approveBatch(
    reviewerId: string,
    batchId: string,
    _dto: ApproveCertificateImportDto,
  ) {
    await this.assertItemDecision(reviewerId, batchId);
  }

  async rejectBatch(
    reviewerId: string,
    batchId: string,
    _dto: RejectCertificateImportDto,
  ) {
    await this.assertItemDecision(reviewerId, batchId);
  }

  async approveItem(
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: ApproveCertificateImportDto,
  ) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const batch = await this.findBatch(batchId);
    this.assertCanAccessBatch(access, batch.local_field_id);
    const target = (batch.items ?? []).find((item) => item.item_id === itemId);
    if (
      target &&
      INSTITUTIONAL_CLASS_ASSET_CODES.has(target.class?.asset_code ?? '')
    ) {
      if (!access.superAdmin) {
        throw new NotFoundException('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
      }
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED',
      );
    }
    return this.applicationService.approveItem(
      reviewerId,
      batch.batch_id,
      itemId,
      dto,
    );
  }

  async rejectItem(
    reviewerId: string,
    batchId: string,
    itemId: string,
    dto: RejectCertificateImportDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const access = await this.resolveReviewerAccess(reviewerId);
      const batch = await this.findBatch(batchId, tx);
      this.assertCanAccessBatch(access, batch.local_field_id);

      const existingItem = await tx.certificate_bulk_import_items.findFirst({
        where: {
          item_id: itemId,
          batch_id: batchId,
          active: true,
          status: { in: REVIEWABLE_ITEM_STATUSES },
        },
        select: {
          item_id: true,
          class: { select: { asset_code: true } },
        },
      });

      if (!existingItem) {
        throw new NotFoundException('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
      }
      if (
        INSTITUTIONAL_CLASS_ASSET_CODES.has(
          existingItem.class?.asset_code ?? '',
        )
      ) {
        if (!access.superAdmin) {
          throw new NotFoundException('CERTIFICATE_IMPORT_ITEM_NOT_FOUND');
        }
        throw new BadRequestException(
          'CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED',
        );
      }

      const rejected = await tx.certificate_bulk_import_items.updateMany({
        where: {
          item_id: existingItem.item_id,
          batch_id: batchId,
          active: true,
          status: { in: REVIEWABLE_ITEM_STATUSES },
          applied_entity_id: null,
        },
        data: {
          status: CertificateBulkImportItemStatus.REJECTED,
          rejection_reason: dto.reason,
          reviewed_by_id: reviewerId,
          reviewed_at: new Date(),
        },
      });
      if (rejected.count !== 1) {
        throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_NOT_REVIEWABLE');
      }
      const item = {
        item_id: existingItem.item_id,
        status: CertificateBulkImportItemStatus.REJECTED,
        rejection_reason: dto.reason,
      };

      const status = await this.applicationService.resolveBatchStatus(
        tx,
        batchId,
      );
      await tx.certificate_bulk_import_batches.update({
        where: { batch_id: batchId },
        data: { status, reviewed_at: new Date() },
      });

      await this.recordEvent(
        tx,
        batchId,
        itemId,
        'ITEM_REJECTED',
        reviewerId,
        dto.reason,
      );

      return item;
    });
  }

  private async assertItemDecision(reviewerId: string, batchId: string) {
    const access = await this.resolveReviewerAccess(reviewerId);
    const batch = await this.findBatch(batchId);
    this.assertCanAccessBatch(access, batch.local_field_id);
    throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_DECISION_REQUIRED');
  }

  private async findBatch(
    batchId: string,
    tx: Pick<
      PrismaService | Prisma.TransactionClient,
      'certificate_bulk_import_batches'
    > = this.prisma,
  ) {
    const batch = await tx.certificate_bulk_import_batches.findFirst({
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
      return { global: true, localFieldId: null, superAdmin: true };
    }

    if (
      (roles.has('admin') || roles.has('assistant-admin')) &&
      reviewer.local_field_id == null
    ) {
      return { global: true, localFieldId: null, superAdmin: false };
    }

    if (
      reviewer.local_field_id &&
      (roles.has('admin') ||
        roles.has('assistant-admin') ||
        roles.has('director-lf') ||
        roles.has('assistant-lf'))
    ) {
      return {
        global: false,
        localFieldId: reviewer.local_field_id,
        superAdmin: false,
      };
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

  private visibleCommonItemWhere(): Prisma.certificate_bulk_import_itemsWhereInput {
    return {
      active: true,
      OR: [
        { class_id: null },
        {
          class: {
            asset_code: { notIn: [...INSTITUTIONAL_CLASS_ASSET_CODES] },
          },
        },
        { class: { asset_code: null } },
      ],
    };
  }

  private presentForReviewer<
    T extends {
      files?: {
        jurisdiction?: string | null;
        size_bytes?: bigint | null;
        staging_key?: unknown;
      }[];
      items?: {
        item_id?: string;
        class?: { asset_code?: string | null } | null;
      }[];
      events?: { item_id?: string | null }[];
    },
  >(
    batch: T,
  ): Omit<T, 'files'> & {
    files: Array<PublicImportFile<NonNullable<T['files']>[number]>>;
  } {
    const items = (batch.items ?? []).filter(
      (item) =>
        !INSTITUTIONAL_CLASS_ASSET_CODES.has(item.class?.asset_code ?? ''),
    );
    const visibleIds = new Set(
      items
        .map((item) => item.item_id)
        .filter((itemId): itemId is string => Boolean(itemId)),
    );

    return {
      ...batch,
      files: (batch.files ?? [])
        .filter((file) => file.jurisdiction !== 'INSTITUTIONAL')
        .map((file) => toPublicImportFile(file)),
      items,
      events: (batch.events ?? []).filter(
        (event) => event.item_id == null || visibleIds.has(event.item_id),
      ),
    };
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
          class: { select: { class_id: true, name: true, asset_code: true } },
        },
      },
      events: { orderBy: { created_at: 'asc' as const } },
    };
  }

  private async attachOperationalReconciliation<
    T extends {
      user_id?: string;
      user?: { user_id?: string | null } | null;
      items?: Array<{
        item_id?: string;
        item_type?: string | null;
        class_id?: number | null;
        completed_at?: Date | string | null;
        class?: { asset_code?: string | null } | null;
      }>;
    },
  >(batch: T): Promise<T> {
    const items = batch.items ?? [];
    const classItems = items.filter(
      (item) =>
        item.item_type === 'CLASS' &&
        item.class_id &&
        item.completed_at &&
        item.class?.asset_code !== 'GM-01',
    );
    if (classItems.length === 0) {
      return batch;
    }

    const userId = batch.user?.user_id ?? batch.user_id;
    if (!userId) {
      return batch;
    }

    const years = await this.prisma.ecclesiastical_years.findMany({
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        user_id: userId,
        class_id: {
          in: classItems
            .map((item) => item.class_id)
            .filter(
              (classId): classId is number => typeof classId === 'number',
            ),
        },
        record_kind: 'OPERATIONAL',
        investiture_status: { not: 'INVESTIDO' },
        active: true,
      },
      select: {
        enrollment_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        enrollment_date: true,
        investiture_status: true,
        modified_at: true,
        record_kind: true,
      },
    });

    return {
      ...batch,
      items: items.map((item) => {
        if (
          !classItems.includes(item) ||
          !item.class_id ||
          !item.completed_at
        ) {
          return item;
        }
        const civilDate = civilDateFromDbDate(item.completed_at);
        if (!civilDate) {
          return item;
        }
        let yearId: number;
        try {
          const resolution = classifyCertificateImportYear(civilDate, years);
          if (resolution.status !== 'resolved') {
            return item;
          }
          yearId = resolution.yearId;
        } catch {
          return item;
        }
        const match = enrollments.find(
          (row) =>
            row.class_id === item.class_id &&
            row.ecclesiastical_year_id === yearId,
        );
        if (!match) {
          return item;
        }
        return {
          ...item,
          operational_reconciliation: {
            enrollment_id: match.enrollment_id,
            ecclesiastical_year_id: match.ecclesiastical_year_id,
            enrollment_date: match.enrollment_date,
            investiture_status: match.investiture_status,
            modified_at: match.modified_at.toISOString(),
            record_kind: match.record_kind,
          },
        };
      }),
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
