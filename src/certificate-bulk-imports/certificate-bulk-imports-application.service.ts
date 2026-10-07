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
import {
  civilDateFromDbDate,
  classifyCertificateImportYear,
  utcCivilDate,
} from './certificate-import-year-resolver.service';
import { assertClassCertificateHistoricalAge } from './class-certificate-historical-age';

type CertificateImportApplicationTransaction = Pick<
  Prisma.TransactionClient,
  | 'certificate_bulk_import_items'
  | 'certificate_bulk_import_batches'
  | 'users_honors'
  | 'evidence_files'
  | 'ecclesiastical_years'
  | 'enrollments'
  | 'classes'
  | 'users'
  | 'investiture_validation_history'
  | 'certificate_bulk_import_item_events'
>;

const GUIDE_MAJOR_ASSET_CODE = 'GM-01';
const INSTITUTIONAL_CLASS_ASSET_CODES = new Set(['GM-02', 'GM-03']);

const REVIEWABLE_ITEM_STATUSES = [
  CertificateBulkImportItemStatus.SUBMITTED,
  CertificateBulkImportItemStatus.RESUBMITTED,
];

type ExistingClassEnrollment = {
  enrollment_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  investiture_date: Date | null;
  record_kind: string;
  modified_at: Date;
};

type AccreditedEnrollment = {
  enrollmentId: number;
  recordHistory: boolean;
  historyComment?: string;
};

type EnrollmentReconciliation = {
  enrollmentId?: number;
  expectedModifiedAt?: string;
};

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

    const claimed = await tx.certificate_bulk_import_items.updateMany({
      where: {
        item_id: item.item_id,
        active: true,
        status: { in: REVIEWABLE_ITEM_STATUSES },
        applied_entity_id: null,
      },
      data: { revision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      const current = await this.findSubmittedItem(tx, batchId, itemId);
      if (current.applied_entity_id) {
        return current;
      }
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_NOT_REVIEWABLE');
    }

    if (!item.completed_at) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_DATE');
    }

    if (item.item_type === CertificateBulkImportItemType.HONOR) {
      return this.approveHonorItem(tx, item, reviewerId, dto.comment);
    }

    if (item.item_type === CertificateBulkImportItemType.CLASS) {
      return this.approveClassItem(tx, item, reviewerId, dto);
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
      select: {
        user_honor_id: true,
        active: true,
        date: true,
        validation_status: true,
      },
    });

    if (
      existingUserHonor?.date &&
      existingUserHonor.validation_status === 'APPROVED' &&
      civilDateFromDbDate(existingUserHonor.date) !==
        civilDateFromDbDate(item.completed_at)
    ) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT');
    }

    const identicalHonor =
      !!existingUserHonor?.date &&
      civilDateFromDbDate(existingUserHonor.date) ===
        civilDateFromDbDate(item.completed_at);

    const userHonor = existingUserHonor
      ? await tx.users_honors.update({
          where: { user_honor_id: existingUserHonor.user_honor_id },
          data: identicalHonor
            ? {
                active: true,
                certificate: primaryFile.file_url,
                images: item.batch.files.map((file) => file.file_url),
              }
            : {
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
    dto: ApproveCertificateImportDto,
  ) {
    if (!item.class_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_CLASS');
    }

    await assertClassCertificateHistoricalAge(tx, {
      userId: item.batch.user_id,
      classId: item.class_id,
      completedAt: item.completed_at,
    });

    const civilDate = civilDateFromDbDate(item.completed_at);
    if (!civilDate) {
      throw new BadRequestException('CERTIFICATE_IMPORT_DATE_REQUIRED');
    }
    const civilInstant = utcCivilDate(civilDate);
    const years = await tx.ecclesiastical_years.findMany({
      where: {
        start_date: { lte: civilInstant },
        end_date: { gte: civilInstant },
      },
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
    const resolution = classifyCertificateImportYear(civilDate, years);
    if (resolution.status === 'missing') {
      throw new BadRequestException('CERTIFICATE_IMPORT_YEAR_NOT_FOUND');
    }
    if (resolution.status === 'ambiguous') {
      throw new BadRequestException('CERTIFICATE_IMPORT_YEAR_AMBIGUOUS');
    }
    const year = { year_id: resolution.yearId };
    const klass = await tx.classes.findUnique({
      where: { class_id: item.class_id },
      select: { asset_code: true },
    });
    if (INSTITUTIONAL_CLASS_ASSET_CODES.has(klass?.asset_code ?? '')) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_INSTITUTIONAL_REVIEW_REQUIRED',
      );
    }

    const now = new Date();
    const rows = await tx.enrollments.findMany({
      where: {
        user_id: item.batch.user_id,
        class_id: item.class_id,
      },
      select: {
        enrollment_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        investiture_date: true,
        record_kind: true,
        modified_at: true,
      },
    });
    const reconciliation: EnrollmentReconciliation = {
      enrollmentId: dto.reconcile_enrollment_id,
      expectedModifiedAt: dto.expected_modified_at,
    };
    const accredited =
      klass?.asset_code === GUIDE_MAJOR_ASSET_CODE
        ? await this.substituteGuideMajor(tx, {
            item,
            yearId: year.year_id,
            now,
            reviewerId,
            rows,
            reconciliation,
          })
        : await this.accreditHistoricalClass(tx, {
            item,
            yearId: year.year_id,
            now,
            reviewerId,
            rows,
            reconciliation,
          });

    if (accredited.recordHistory) {
      await tx.investiture_validation_history.create({
        data: {
          enrollment_id: accredited.enrollmentId,
          action: 'INVESTIDO',
          performed_by: reviewerId,
          comments:
            dto.comment ??
            accredited.historyComment ??
            'Acreditación histórica por certificado. No sustituye una ceremonia de este ciclo.',
        },
      });
    }

    const updatedItem = await this.markItemApproved(
      tx,
      item,
      reviewerId,
      CertificateBulkImportAppliedEntityType.ENROLLMENT,
      accredited.enrollmentId,
    );

    await this.recordEvent(
      tx,
      item.batch.batch_id,
      item.item_id,
      'ITEM_APPROVED',
      reviewerId,
      dto.comment,
      {
        applied_entity_type: 'ENROLLMENT',
        applied_entity_id: accredited.enrollmentId,
      },
    );

    return updatedItem;
  }

  private async accreditHistoricalClass(
    tx: CertificateImportApplicationTransaction,
    params: {
      item: CertificateImportItemWithBatch;
      yearId: number;
      now: Date;
      reviewerId: string;
      rows: ExistingClassEnrollment[];
      reconciliation?: EnrollmentReconciliation;
    },
  ): Promise<AccreditedEnrollment> {
    const sameYear = params.rows.find(
      (row) => row.ecclesiastical_year_id === params.yearId,
    );
    if (sameYear) {
      if (sameYear.investiture_status !== 'INVESTIDO') {
        return this.reconcileOperationalEnrollment(tx, {
          ...params,
          current: sameYear,
        });
      }
      this.assertReconciliationTarget(
        params.reconciliation?.enrollmentId,
        sameYear.enrollment_id,
      );
      return this.reuseOrRejectFinalFact(sameYear, params.item.completed_at);
    }
    if (params.reconciliation?.enrollmentId) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ENROLLMENT_MISMATCH');
    }
    if (!params.item.class_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_CLASS');
    }

    const created = await tx.enrollments.create({
      data: {
        user_id: params.item.batch.user_id,
        class_id: params.item.class_id,
        ecclesiastical_year_id: params.yearId,
        enrollment_date: params.now,
        record_kind: 'HISTORICAL_CERTIFICATE',
        investiture_status: 'INVESTIDO',
        investiture_date: params.item.completed_at!,
        validated_by: params.reviewerId,
        validated_at: params.now,
        rejection_reason: null,
        locked_for_validation: true,
        active: true,
        submitted_for_validation: false,
      },
      select: { enrollment_id: true },
    });
    return { enrollmentId: created.enrollment_id, recordHistory: true };
  }

  private async substituteGuideMajor(
    tx: CertificateImportApplicationTransaction,
    params: {
      item: CertificateImportItemWithBatch;
      yearId: number;
      now: Date;
      reviewerId: string;
      rows: ExistingClassEnrollment[];
      reconciliation?: EnrollmentReconciliation;
    },
  ): Promise<AccreditedEnrollment> {
    if (params.rows.length > 1) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED',
      );
    }
    if (params.rows.length === 0) {
      return this.accreditHistoricalClass(tx, params);
    }
    this.assertReconciliationTarget(
      params.reconciliation?.enrollmentId,
      params.rows[0].enrollment_id,
    );

    const current = params.rows[0];
    if (current.investiture_status === 'INVESTIDO') {
      return this.reuseOrRejectFinalFact(current, params.item.completed_at);
    }

    await tx.enrollments.update({
      where: { enrollment_id: current.enrollment_id },
      data: {
        ecclesiastical_year_id: params.yearId,
        record_kind: 'HISTORICAL_CERTIFICATE',
        investiture_status: 'INVESTIDO',
        investiture_date: params.item.completed_at!,
        validated_by: params.reviewerId,
        validated_at: params.now,
        rejection_reason: null,
        locked_for_validation: true,
        active: true,
        submitted_for_validation: false,
      },
    });
    return { enrollmentId: current.enrollment_id, recordHistory: true };
  }

  private assertReconciliationTarget(
    requestedId: number | undefined,
    enrollmentId: number,
  ) {
    if (requestedId !== undefined && requestedId !== enrollmentId) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ENROLLMENT_MISMATCH');
    }
  }

  private async reconcileOperationalEnrollment(
    tx: CertificateImportApplicationTransaction,
    params: {
      item: CertificateImportItemWithBatch;
      now: Date;
      reviewerId: string;
      current: ExistingClassEnrollment;
      reconciliation?: EnrollmentReconciliation;
    },
  ): Promise<AccreditedEnrollment> {
    const requestedId = params.reconciliation?.enrollmentId;
    if (requestedId === undefined) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED',
      );
    }
    if (requestedId !== params.current.enrollment_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ENROLLMENT_MISMATCH');
    }
    const expected = params.reconciliation?.expectedModifiedAt
      ? new Date(params.reconciliation.expectedModifiedAt)
      : null;
    if (
      !expected ||
      Number.isNaN(expected.getTime()) ||
      !params.current.modified_at ||
      expected.getTime() !== params.current.modified_at.getTime()
    ) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_ENROLLMENT_VERSION_CONFLICT',
      );
    }
    if (!params.item.class_id) {
      throw new BadRequestException('CERTIFICATE_IMPORT_ITEM_MISSING_CLASS');
    }

    const updated = await tx.enrollments.updateMany({
      where: {
        enrollment_id: params.current.enrollment_id,
        user_id: params.item.batch.user_id,
        class_id: params.item.class_id,
        ecclesiastical_year_id: params.current.ecclesiastical_year_id,
        record_kind: 'OPERATIONAL',
        investiture_status: { not: 'INVESTIDO' },
        modified_at: params.current.modified_at,
      },
      data: {
        investiture_status: 'INVESTIDO',
        investiture_date: params.item.completed_at!,
        validated_by: params.reviewerId,
        validated_at: params.now,
        rejection_reason: null,
        locked_for_validation: true,
        active: true,
        submitted_for_validation: false,
      },
    });
    if (updated.count !== 1) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_ENROLLMENT_VERSION_CONFLICT',
      );
    }
    return {
      enrollmentId: params.current.enrollment_id,
      recordHistory: true,
      historyComment:
        'Acreditación sobre la inscripción vigente. Se conservan el progreso y la fecha de alta.',
    };
  }

  private reuseOrRejectFinalFact(
    existing: ExistingClassEnrollment,
    completedAt: Date | null | undefined,
  ): AccreditedEnrollment {
    const sameDate =
      civilDateFromDbDate(existing.investiture_date) ===
      civilDateFromDbDate(completedAt);
    if (
      existing.investiture_status === 'INVESTIDO' &&
      sameDate
    ) {
      return { enrollmentId: existing.enrollment_id, recordHistory: false };
    }
    if (existing.investiture_status === 'INVESTIDO') {
      throw new BadRequestException('CERTIFICATE_IMPORT_FINAL_DATE_CONFLICT');
    }
    throw new BadRequestException(
      'CERTIFICATE_IMPORT_ENROLLMENT_RECONCILIATION_REQUIRED',
    );
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

  async resolveBatchStatus(
    tx: Pick<Prisma.TransactionClient, 'certificate_bulk_import_items'>,
    batchId: string,
  ): Promise<'SUBMITTED' | 'APPROVED' | 'NEEDS_CORRECTION'> {
    const open = await tx.certificate_bulk_import_items.count({
      where: {
        batch_id: batchId,
        active: true,
        status: { in: REVIEWABLE_ITEM_STATUSES },
      },
    });
    if (open > 0) {
      return 'SUBMITTED';
    }

    const rejected = await tx.certificate_bulk_import_items.count({
      where: {
        batch_id: batchId,
        active: true,
        status: CertificateBulkImportItemStatus.REJECTED,
      },
    });
    return rejected > 0 ? 'NEEDS_CORRECTION' : 'APPROVED';
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

    const status = await this.resolveBatchStatus(tx, item.batch.batch_id);

    await tx.certificate_bulk_import_batches.update({
      where: { batch_id: item.batch.batch_id },
      data: {
        status,
        reviewed_at: new Date(),
      },
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
