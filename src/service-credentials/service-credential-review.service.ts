import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getAuditCorrelationId } from '../audit-logs/audit-request-context';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { CLOCK, type Clock } from '../common/clock/clock';
import { ZonedBusinessTimeService } from '../common/clock/zoned-business-time.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ECCLESIASTICAL_YEAR_TIMEZONE } from '../common/services/ecclesiastical-year.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
  type FileStorageService,
} from '../common/services/file-storage.service';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ReviewServiceCredentialsQueryDto } from './dto/review-service-credentials-query.dto';
import {
  ServiceCredentialReviewScopeService,
  type ReviewChannel,
} from '../common/authorization/service-credential-review-scope.service';
import { SERVICE_CREDENTIAL_BUCKET } from './my-service-credentials.service';
import {
  SERVICE_CREDENTIAL_DOWNLOAD_TTL_SECONDS,
  formatDateOnly,
  parseDateOnly,
} from './service-credentials.constants';

const PHOTO_URL_TTL_SECONDS = 600;

const REVIEW_SELECT = {
  credential_id: true,
  user_id: true,
  credential_type: true,
  completed_at: true,
  status: true,
  created_at: true,
  reviewed_at: true,
  reviewer_role: true,
  owner: {
    select: {
      user_id: true,
      name: true,
      paternal_last_name: true,
      maternal_last_name: true,
      user_image: true,
    },
  },
} satisfies Prisma.service_credentialsSelect;

type ReviewRow = Prisma.service_credentialsGetPayload<{
  select: typeof REVIEW_SELECT;
}>;

export type ReviewItem = {
  credential_id: string;
  user: { user_id: string; name: string; photo_url: string | null };
  club_name: string | null;
  type: string;
  completed_at: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewer_role: string | null;
};

type Decision = 'APPROVED' | 'REJECTED';

/** Review of the counselor «constancia» (`/service-credentials/review`). */
@Injectable()
export class ServiceCredentialReviewService {
  private readonly logger = new Logger(ServiceCredentialReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ServiceCredentialReviewScopeService,
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
    private readonly audit: CriticalAuditWriterService,
    private readonly notifications: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly zonedTime: ZonedBusinessTimeService,
  ) {}

  async list(actorId: string, query: ReviewServiceCredentialsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const status = query.status ?? 'PENDING_REVIEW';
    const channels = await this.scope.resolveChannels(actorId);
    const base = await this.visibleWhere(actorId, channels, query.search);

    const [rows, total, grouped] = await Promise.all([
      this.prisma.service_credentials.findMany({
        where: { AND: [base, { status }] },
        orderBy:
          status === 'PENDING_REVIEW'
            ? [{ created_at: 'asc' }]
            : [{ reviewed_at: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: REVIEW_SELECT,
      }),
      this.prisma.service_credentials.count({
        where: { AND: [base, { status }] },
      }),
      this.prisma.service_credentials.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const group of grouped) {
      if (group.status === 'PENDING_REVIEW') counts.pending = group._count._all;
      if (group.status === 'APPROVED') counts.approved = group._count._all;
      if (group.status === 'REJECTED') counts.rejected = group._count._all;
    }

    const items = await this.toItems(rows, channels);
    return { items, meta: { page, limit, total, counts } };
  }

  async getDetail(actorId: string, credentialId: string) {
    const channels = await this.scope.resolveChannels(actorId);
    const base = await this.visibleWhere(actorId, channels);
    const row = await this.prisma.service_credentials.findFirst({
      where: { AND: [base, { credential_id: credentialId }] },
      select: {
        ...REVIEW_SELECT,
        object_key: true,
        mime_type: true,
        decision_reason: true,
        expires_at: true,
        original_filename: true,
      },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND);
    }
    const [item] = await this.toItems([row], channels);
    const fileUrl = row.object_key
      ? await this.storage.getSignedDownloadUrl(
          SERVICE_CREDENTIAL_BUCKET,
          row.object_key,
          { expiresInSeconds: SERVICE_CREDENTIAL_DOWNLOAD_TTL_SECONDS },
        )
      : null;
    return {
      ...item,
      file_url: fileUrl,
      file_name: row.original_filename,
      mime_type: row.mime_type,
      decision_reason: row.decision_reason,
      expires_at: formatDateOnly(row.expires_at),
    };
  }

  approve(
    actorId: string,
    credentialId: string,
    input: { expires_at?: string },
  ) {
    return this.decide(actorId, credentialId, 'APPROVED', {
      expiresAt: input.expires_at,
    });
  }

  reject(actorId: string, credentialId: string, input: { reason: string }) {
    return this.decide(actorId, credentialId, 'REJECTED', {
      reason: input.reason,
    });
  }

  private async decide(
    actorId: string,
    credentialId: string,
    decision: Decision,
    input: { expiresAt?: string; reason?: string },
  ) {
    const row = await this.prisma.service_credentials.findFirst({
      where: {
        credential_id: credentialId,
        active: true,
        upload_status: 'CONFIRMED',
      },
      select: {
        credential_id: true,
        user_id: true,
        credential_type: true,
        status: true,
      },
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND);
    }
    if (row.user_id === actorId) {
      throw new AppForbiddenException(ErrorCode.SERVICE_CREDENTIAL_SELF_REVIEW);
    }
    const channels = await this.scope.resolveChannels(actorId);
    const reviewerRole = await this.scope.findReviewerRole(
      channels,
      row.user_id,
    );
    if (!reviewerRole) {
      throw new AppNotFoundException(ErrorCode.SERVICE_CREDENTIAL_NOT_FOUND);
    }
    if (row.status !== 'PENDING_REVIEW') {
      throw new AppConflictException(ErrorCode.SERVICE_CREDENTIAL_NOT_PENDING);
    }

    let expiresAt: Date | null = null;
    if (decision === 'APPROVED' && input.expiresAt !== undefined) {
      expiresAt = parseDateOnly(input.expiresAt);
      if (!expiresAt || input.expiresAt <= this.today()) {
        throw new AppBadRequestException(
          ErrorCode.SERVICE_CREDENTIAL_DATE_INVALID,
        );
      }
    }

    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.service_credentials.updateMany({
        where: {
          credential_id: credentialId,
          active: true,
          upload_status: 'CONFIRMED',
          status: 'PENDING_REVIEW',
        },
        data: {
          status: decision,
          reviewed_by_id: actorId,
          reviewer_role: reviewerRole,
          reviewed_at: now,
          decision_reason:
            decision === 'REJECTED' ? (input.reason ?? null) : null,
          expires_at: decision === 'APPROVED' ? expiresAt : null,
        },
      });
      if (claimed.count !== 1) {
        throw new AppConflictException(
          ErrorCode.SERVICE_CREDENTIAL_NOT_PENDING,
        );
      }
      await this.audit.write(tx, {
        entityType: 'service_credentials',
        entityId: credentialId,
        action:
          decision === 'APPROVED'
            ? 'SERVICE_CREDENTIAL_APPROVED'
            : 'SERVICE_CREDENTIAL_REJECTED',
        eventKey: `service-credential:${decision.toLowerCase()}:${credentialId}`,
        actor: {
          kind: 'user',
          userId: actorId,
          roleName: reviewerRole,
          scope: { reviewer_role: reviewerRole },
        },
        target: {
          userId: row.user_id,
          scope: {
            credential_type: row.credential_type,
          },
        },
        before: { status: 'PENDING_REVIEW' },
        after: {
          status: decision,
          expires_at: formatDateOnly(
            decision === 'APPROVED' ? expiresAt : null,
          ),
          reason: decision === 'REJECTED' ? (input.reason ?? null) : null,
        },
        summary:
          decision === 'APPROVED'
            ? 'Constancia de consejería aprobada'
            : 'Constancia de consejería rechazada',
        effectiveAt: now,
        correlationId: getAuditCorrelationId() ?? randomUUID(),
        result: 'succeeded',
      });
    });

    this.notifyOwner(row.user_id, credentialId, decision, input.reason);
    return this.getDetail(actorId, credentialId);
  }

  /** Fire-and-forget: the transport failing never breaks the review. */
  private notifyOwner(
    ownerId: string,
    credentialId: string,
    decision: Decision,
    reason?: string,
  ): void {
    const approved = decision === 'APPROVED';
    void this.notifications.notifySafe(
      ownerId,
      approved
        ? 'Constancia de consejería aprobada'
        : 'Constancia de consejería rechazada',
      approved
        ? 'Tu constancia de consejería fue aprobada.'
        : `Tu constancia de consejería fue rechazada${reason ? `: ${reason}` : '.'}`,
      {
        type: 'service_credential',
        entity_id: credentialId,
        action: approved ? 'approved' : 'rejected',
      },
      'service-credentials:reviewed',
    );
  }

  /** Confirmed, active credentials of other people inside the actor's scope. */
  private async visibleWhere(
    actorId: string,
    channels: ReviewChannel[],
    search?: string,
  ): Promise<Prisma.service_credentialsWhereInput> {
    const clauses: Prisma.service_credentialsWhereInput[] = [
      {
        active: true,
        upload_status: 'CONFIRMED',
        user_id: { not: actorId },
      },
      await this.scope.ownerInScopeWhere(channels),
    ];
    const terms = (search ?? '').split(/\s+/).filter((term) => term.length > 0);
    for (const term of terms) {
      const contains = { contains: term, mode: 'insensitive' as const };
      clauses.push({
        owner: {
          OR: [
            { name: contains },
            { paternal_last_name: contains },
            { maternal_last_name: contains },
          ],
        },
      });
    }
    return { AND: clauses };
  }

  private async toItems(
    rows: ReviewRow[],
    channels: ReviewChannel[],
  ): Promise<ReviewItem[]> {
    if (rows.length === 0) return [];
    const clubs = await this.clubNames(
      rows.map((row) => row.user_id),
      channels,
    );
    const photos = await Promise.all(
      rows.map((row) => this.signPhoto(row.owner.user_image)),
    );
    return rows.map((row, index) => ({
      credential_id: row.credential_id,
      user: {
        user_id: row.owner.user_id,
        name: displayName(row.owner),
        photo_url: photos[index],
      },
      club_name: clubs.get(row.user_id) ?? null,
      type: row.credential_type,
      completed_at: formatDateOnly(row.completed_at),
      status: row.status,
      created_at: row.created_at.toISOString(),
      reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      reviewer_role: row.reviewer_role,
    }));
  }

  /** The club each person is reviewed through (latest assignment inside the scope). */
  private async clubNames(
    userIds: string[],
    channels: ReviewChannel[],
  ): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const membership = await this.scope.membershipWhere(channels);
    if (!membership) return names;
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: { user_id: { in: userIds }, ...membership },
      orderBy: [{ start_date: 'desc' }],
      select: {
        user_id: true,
        club_sections: { select: { clubs: { select: { name: true } } } },
      },
    });
    for (const assignment of assignments) {
      const name = assignment.club_sections?.clubs?.name;
      if (name && !names.has(assignment.user_id)) {
        names.set(assignment.user_id, name);
      }
    }
    return names;
  }

  private async signPhoto(value: string | null): Promise<string | null> {
    if (!value) return null;
    try {
      return await this.storage.getSignedDownloadUrl(
        StorageBucketAlias.USER_PROFILES,
        value,
        { expiresInSeconds: PHOTO_URL_TTL_SECONDS },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to sign reviewer photo: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private today(): string {
    return this.zonedTime.businessDate(
      this.clock.now(),
      ECCLESIASTICAL_YEAR_TIMEZONE,
    );
  }
}
