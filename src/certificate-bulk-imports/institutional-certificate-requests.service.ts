import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  civilDateFromDbDate,
  classifyCertificateImportYear,
  utcCivilDate,
} from './certificate-import-year-resolver.service';
import {
  assertClassCertificateHistoricalAge,
  ecclesiasticalYearIdsCovering,
  lockInvestitureYearsAscending,
} from './class-certificate-historical-age';
import {
  guardCertificateApprovalAuthorization,
  pendingAuthorizationYearIds,
  rejectSameYearLiveAuthorization,
} from './class-certificate-live-authorization';
import type { CreateInstitutionalCertificateRequestDto } from './dto/create-institutional-certificate-request.dto';
import type {
  ApproveInstitutionalCertificateRequestDto,
  RejectInstitutionalCertificateRequestDto,
} from './dto/review-institutional-certificate-request.dto';
import { INSTITUTIONAL_CLASS_ASSET_CODES } from './institutional-class-codes';

type InstitutionalStore = Pick<
  Prisma.TransactionClient,
  | 'institutional_certificate_requests'
  | 'institutional_certificate_request_events'
  | '$queryRawUnsafe'
>;

const OPEN_STATUSES = ['PENDING_REVIEW', 'APPROVED'] as const;

type RequestRow = {
  request_id: string;
  user_id: string;
  class_id: number;
  file_id: string;
  batch_id?: string | null;
  status: string;
  revision: number;
  completed_at: Date;
  ecclesiastical_year_id: number | null;
  decision_reason: string | null;
  reviewed_at: Date | null;
  class?: { asset_code: string | null; name: string } | null;
  user?: {
    name: string | null;
    paternal_last_name: string | null;
    maternal_last_name: string | null;
  } | null;
  events?: Array<{
    event_id: string;
    action: string;
    comment: string | null;
    revision: number;
    created_at: Date;
  }>;
};

const REQUEST_INCLUDE = {
  class: { select: { asset_code: true, name: true } },
  user: {
    select: { name: true, paternal_last_name: true, maternal_last_name: true },
  },
  events: { orderBy: { created_at: 'asc' as const } },
} satisfies Prisma.institutional_certificate_requestsInclude;

const REVIEW_STATUSES = new Set(['PENDING_REVIEW', 'APPROVED', 'REJECTED']);

function isOpenRequestConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

@Injectable()
export class InstitutionalCertificateRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(userId: string, dto: CreateInstitutionalCertificateRequestDto) {
    const completedAt = utcCivilDate(dto.completed_at);
    const klass = await this.prisma.classes.findUnique({
      where: { class_id: dto.class_id },
      select: { class_id: true, asset_code: true, name: true, active: true },
    });
    if (!INSTITUTIONAL_CLASS_ASSET_CODES.has(klass?.asset_code ?? '')) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_CLASS_NOT_INSTITUTIONAL',
      );
    }

    const file = await this.prisma.certificate_bulk_import_files.findFirst({
      where: { file_id: dto.file_id, active: true },
      select: {
        file_id: true,
        upload_status: true,
        object_key: true,
        batch: { select: { user_id: true, batch_id: true } },
      },
    });
    if (!file || file.batch.user_id !== userId) {
      throw new NotFoundException('CERTIFICATE_IMPORT_FILE_NOT_FOUND');
    }
    if (file.upload_status !== 'CONFIRMED' || !file.object_key) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }

    const existing =
      await this.prisma.institutional_certificate_requests.findFirst({
        where: {
          user_id: userId,
          class_id: dto.class_id,
          file_id: dto.file_id,
          completed_at: completedAt,
          active: true,
          status: { in: [...OPEN_STATUSES] },
        },
        include: REQUEST_INCLUDE,
      });
    if (existing) {
      return this.toView(existing, await this.blockers(existing.completed_at));
    }

    const predecessor =
      await this.prisma.institutional_certificate_requests.findFirst({
        where: {
          user_id: userId,
          class_id: dto.class_id,
          file_id: dto.file_id,
          status: 'REJECTED',
          active: true,
        },
        orderBy: { created_at: 'desc' },
        select: { request_id: true },
      });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const yearIds = await ecclesiasticalYearIdsCovering(tx, [completedAt]);
        await lockInvestitureYearsAscending(tx, yearIds);
        const age = await assertClassCertificateHistoricalAge(
          tx,
          {
            userId,
            classId: dto.class_id,
            completedAt: completedAt,
          },
          { skipYearAdvisory: true },
        );
        await rejectSameYearLiveAuthorization(tx as never, {
          userId,
          classId: dto.class_id,
          certificateYearId: age.yearId,
        });
        const request = await tx.institutional_certificate_requests.create({
          data: {
            user_id: userId,
            class_id: dto.class_id,
            file_id: dto.file_id,
            batch_id: file.batch.batch_id,
            source: dto.source ?? 'MANUAL',
            completed_at: completedAt,
            ecclesiastical_year_id: age.yearId,
            predecessor_request_id: predecessor?.request_id,
          },
          include: REQUEST_INCLUDE,
        });
        await tx.certificate_bulk_import_files.update({
          where: { file_id: file.file_id },
          data: { jurisdiction: 'INSTITUTIONAL' },
        });
        await tx.institutional_certificate_request_events.create({
          data: {
            request_id: request.request_id,
            action: 'REQUEST_SUBMITTED',
            performed_by_id: userId,
            revision: 0,
          },
        });
        return request;
      });

      return this.toView(created, await this.blockers(created.completed_at));
    } catch (error) {
      if (!isOpenRequestConflict(error)) {
        throw error;
      }
      const winner =
        await this.prisma.institutional_certificate_requests.findFirst({
          where: {
            user_id: userId,
            class_id: dto.class_id,
            file_id: dto.file_id,
            completed_at: completedAt,
            active: true,
            status: { in: [...OPEN_STATUSES] },
          },
          include: REQUEST_INCLUDE,
        });
      if (!winner) {
        throw error;
      }
      return this.toView(winner, await this.blockers(winner.completed_at));
    }
  }

  async listMine(userId: string, page = 1, limit = 20) {
    return this.list({ user_id: userId }, page, limit);
  }

  async getMine(userId: string, requestId: string) {
    const request = await this.findVisible(requestId);
    if (request.user_id !== userId) {
      throw new NotFoundException('CERTIFICATE_IMPORT_REQUEST_NOT_FOUND');
    }
    return this.toView(request, await this.blockers(request.completed_at));
  }

  async listForReview(
    reviewerId: string,
    page = 1,
    limit = 20,
    filters: { status?: string; classId?: number; q?: string } = {},
  ) {
    await this.assertSuperAdmin(reviewerId);
    if (filters.status && !REVIEW_STATUSES.has(filters.status)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_STATUS_INVALID');
    }
    const q = filters.q?.trim();
    return this.list(
      {
        ...(filters.status
          ? { status: filters.status as 'PENDING_REVIEW' }
          : {}),
        ...(filters.classId ? { class_id: filters.classId } : {}),
        ...(q
          ? {
              user: {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  {
                    paternal_last_name: {
                      contains: q,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    maternal_last_name: {
                      contains: q,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            }
          : {}),
      },
      page,
      limit,
    );
  }

  async getForReview(reviewerId: string, requestId: string) {
    await this.assertSuperAdmin(reviewerId);
    const request = await this.findVisible(requestId);
    return this.toView(request, await this.blockers(request.completed_at));
  }

  async approve(
    reviewerId: string,
    requestId: string,
    dto: ApproveInstitutionalCertificateRequestDto,
  ) {
    await this.assertSuperAdmin(reviewerId);
    return this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe(
          `SELECT request_id FROM institutional_certificate_requests
           WHERE request_id = $1::uuid
           FOR UPDATE`,
          requestId,
        );
      }
      const current = await this.findVisible(requestId, tx);
      if (current.status === 'APPROVED') {
        return this.toView(current, []);
      }
      if (current.status === 'REJECTED') {
        throw new BadRequestException('CERTIFICATE_IMPORT_DECISION_IMMUTABLE');
      }
      const coveredYears = await ecclesiasticalYearIdsCovering(tx, [
        current.completed_at,
      ]);
      const pendingYears = await pendingAuthorizationYearIds(
        tx as never,
        current.user_id,
        current.class_id,
      );
      const heldYearIds = new Set([...coveredYears, ...pendingYears]);
      await lockInvestitureYearsAscending(tx, [...heldYearIds]);
      const age = await assertClassCertificateHistoricalAge(
        tx,
        {
          userId: current.user_id,
          classId: current.class_id,
          completedAt: current.completed_at,
        },
        { skipYearAdvisory: true },
      );
      await guardCertificateApprovalAuthorization(tx as never, {
        userId: current.user_id,
        classId: current.class_id,
        certificateYearId: age.yearId,
        heldYearIds,
      });
      return this.decide(tx, reviewerId, current, dto.expected_revision, {
        status: 'APPROVED',
        ecclesiastical_year_id: age.yearId,
        decision_reason: dto.comment ?? null,
        action: 'REQUEST_APPROVED',
      });
    });
  }

  async reject(
    reviewerId: string,
    requestId: string,
    dto: RejectInstitutionalCertificateRequestDto,
  ) {
    await this.assertSuperAdmin(reviewerId);
    const current = await this.findVisible(requestId);
    if (current.status === 'REJECTED') {
      return this.toView(current, await this.blockers(current.completed_at));
    }
    if (current.status === 'APPROVED') {
      throw new BadRequestException('CERTIFICATE_IMPORT_DECISION_IMMUTABLE');
    }
    if (!dto.reason?.trim()) {
      throw new BadRequestException(
        'CERTIFICATE_IMPORT_REJECTION_REASON_REQUIRED',
      );
    }

    return this.decide(
      this.prisma,
      reviewerId,
      current,
      dto.expected_revision,
      {
        status: 'REJECTED',
        decision_reason: dto.reason.trim(),
        action: 'REQUEST_REJECTED',
      },
    );
  }

  private async decide(
    db: InstitutionalStore,
    reviewerId: string,
    current: RequestRow,
    expectedRevision: number,
    change: {
      status: 'APPROVED' | 'REJECTED';
      ecclesiastical_year_id?: number;
      decision_reason: string | null;
      action: string;
    },
  ) {
    if (current.revision !== expectedRevision) {
      throw new BadRequestException('CERTIFICATE_IMPORT_REVISION_CONFLICT');
    }

    const updated = await db.institutional_certificate_requests.updateMany({
      where: {
        request_id: current.request_id,
        status: 'PENDING_REVIEW',
        revision: expectedRevision,
      },
      data: {
        status: change.status,
        ecclesiastical_year_id: change.ecclesiastical_year_id,
        decision_reason: change.decision_reason,
        reviewed_by_id: reviewerId,
        reviewed_at: new Date(),
        revision: expectedRevision + 1,
      },
    });
    if (updated.count !== 1) {
      throw new BadRequestException('CERTIFICATE_IMPORT_REVISION_CONFLICT');
    }

    await db.institutional_certificate_request_events.create({
      data: {
        request_id: current.request_id,
        action: change.action,
        performed_by_id: reviewerId,
        comment: change.decision_reason,
        revision: expectedRevision + 1,
      },
    });

    const request = await this.findVisible(current.request_id, db);
    return this.toView(request, []);
  }

  private async list(
    where: Prisma.institutional_certificate_requestsWhereInput,
    page: number,
    limit: number,
  ) {
    const take = Math.min(Math.max(limit, 1), 50);
    const currentPage = Math.max(page, 1);
    const [rows, total] = await Promise.all([
      this.prisma.institutional_certificate_requests.findMany({
        where: { ...where, active: true },
        orderBy: { created_at: 'desc' },
        skip: (currentPage - 1) * take,
        take,
        include: REQUEST_INCLUDE,
      }),
      this.prisma.institutional_certificate_requests.count({
        where: { ...where, active: true },
      }),
    ]);
    return {
      items: rows.map((row) => this.toView(row, [])),
      total,
      page: currentPage,
      limit: take,
    };
  }

  private async findVisible(
    requestId: string,
    db: InstitutionalStore = this.prisma,
  ): Promise<RequestRow> {
    const request = await db.institutional_certificate_requests.findFirst({
      where: { request_id: requestId, active: true },
      include: REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('CERTIFICATE_IMPORT_REQUEST_NOT_FOUND');
    }
    return request;
  }

  private async assertSuperAdmin(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        users_roles: {
          where: { active: true },
          select: { roles: { select: { role_name: true } } },
        },
      },
    });
    const roles = new Set(
      (user?.users_roles ?? []).map((entry) =>
        entry.roles.role_name.toLowerCase(),
      ),
    );
    if (!roles.has('super-admin')) {
      throw new ForbiddenException(
        'CERTIFICATE_IMPORT_INSTITUTIONAL_FORBIDDEN',
      );
    }
  }

  private async resolveYearId(civilDate: string): Promise<number | null> {
    if (!civilDate) return null;
    const instant = utcCivilDate(civilDate);
    const years = await this.prisma.ecclesiastical_years.findMany({
      where: { start_date: { lte: instant }, end_date: { gte: instant } },
      select: { year_id: true, start_date: true, end_date: true, active: true },
    });
    const resolution = classifyCertificateImportYear(civilDate, years);
    return resolution.status === 'resolved' ? resolution.yearId : null;
  }

  private async blockers(completedAt: Date): Promise<string[]> {
    const civilDate = civilDateFromDbDate(completedAt);
    if (!civilDate) return ['CERTIFICATE_IMPORT_DATE_REQUIRED'];
    const instant = utcCivilDate(civilDate);
    const years = await this.prisma.ecclesiastical_years.findMany({
      where: { start_date: { lte: instant }, end_date: { gte: instant } },
      select: { year_id: true, start_date: true, end_date: true, active: true },
    });
    const resolution = classifyCertificateImportYear(civilDate, years);
    if (resolution.status === 'resolved') return [];
    return [resolution.code];
  }

  private toView(request: RequestRow, approvalBlockers: string[]) {
    return {
      request_id: request.request_id,
      user_id: request.user_id,
      class_id: request.class_id,
      asset_code: request.class?.asset_code ?? null,
      class_name: request.class?.name ?? null,
      file_id: request.file_id,
      batch_id: request.batch_id ?? null,
      status: request.status,
      revision: request.revision,
      completed_at: civilDateFromDbDate(request.completed_at),
      ecclesiastical_year_id: request.ecclesiastical_year_id,
      decision_reason: request.decision_reason,
      reviewed_at: request.reviewed_at,
      applicant_name: [
        request.user?.name,
        request.user?.paternal_last_name,
        request.user?.maternal_last_name,
      ]
        .filter(Boolean)
        .join(' '),
      approval_blockers: approvalBlockers,
      enrollment_created: false,
      events: (request.events ?? []).map((event) => ({
        event_id: event.event_id,
        action: event.action,
        comment: event.comment,
        revision: event.revision,
        created_at: event.created_at,
      })),
    };
  }
}
