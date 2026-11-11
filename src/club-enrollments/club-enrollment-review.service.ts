import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getAuditCorrelationId } from '../audit-logs/audit-request-context';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { ReviewerScopeService } from '../common/authorization/reviewer-scope.service';
import type { ReviewChannel } from '../common/authorization/reviewer-scope.service';
import { GlobalRole } from '../common/authorization/roles';
import { CLOCK, type Clock } from '../common/clock/clock';
import {
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ecclesiasticalYearName } from '../common/services/ecclesiastical-year.service';
import { displayName } from '../investiture-requests/investiture-communications.rules';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { escapeLikeWildcards } from '../common/utils/escape-like';
import { randomUUID } from 'node:crypto';
import type { ClubEnrollmentQueueQueryDto } from './dto/club-enrollment-queue-query.dto';
import {
  CLUB_ENROLLMENT_REVIEW_PERMISSION,
  CLUB_ENROLLMENT_REVIEW_SOURCE,
  CLUB_ENROLLMENT_STATUS,
} from './club-enrollments.constants';
import { ClubEnrollmentsService } from './club-enrollments.service';

const PERSON_SELECT = {
  user_id: true,
  name: true,
  paternal_last_name: true,
  maternal_last_name: true,
} satisfies Prisma.usersSelect;

const REVIEW_INCLUDE = {
  club_section: {
    select: {
      club_section_id: true,
      club_type_id: true,
      main_club_id: true,
      club_types: { select: { name: true } },
      clubs: {
        select: {
          club_id: true,
          name: true,
          local_fields: { select: { local_field_id: true, name: true } },
        },
      },
    },
  },
  ecclesiastical_year: {
    select: { year_id: true, start_date: true, end_date: true },
  },
  creator: { select: PERSON_SELECT },
  director: { select: PERSON_SELECT },
  secretary: { select: PERSON_SELECT },
  treasurer: { select: PERSON_SELECT },
  secretary_treasurer: { select: PERSON_SELECT },
  reviewer: { select: PERSON_SELECT },
} satisfies Prisma.club_enrollmentsInclude;

type ReviewRow = Prisma.club_enrollmentsGetPayload<{
  include: typeof REVIEW_INCLUDE;
}>;

type PersonRef = { user_id: string; name: string };
type PersonRow = Prisma.usersGetPayload<{ select: typeof PERSON_SELECT }>;

export type ClubEnrollmentReviewItem = {
  enrollment_id: string;
  status: string;
  ecclesiastical_year: { id: number; name: string };
  club: { id: number; name: string };
  section: {
    id: number;
    club_type_id: number;
    club_type_name: string;
  };
  local_field: { id: number; name: string };
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  meeting_days: string | null;
  meeting_schedule: Prisma.JsonValue | null;
  souls_target: number | null;
  fee: boolean;
  fee_amount: number | null;
  board: {
    director: PersonRef | null;
    deputies: PersonRef[];
    secretary: PersonRef | null;
    treasurer: PersonRef | null;
    secretary_treasurer: PersonRef | null;
  };
  submitted_by: PersonRef | null;
  created_at: string;
  submitted_at: string | null;
  modified_at: string;
  reviewed_by: PersonRef | null;
  reviewer_role: string | null;
  reviewed_at: string | null;
  decision_reason: string | null;
};

type Decision = 'approved' | 'rejected';

/**
 * Validation of the annual enrollment of a club section. The permission
 * `club_enrollments:validate` opens the door; WHICH sections the reviewer may
 * decide on comes from `ReviewerScopeService` (admins everywhere, Local Field,
 * Union, Division, coordinators and district pastors each inside their own
 * scope). An out-of-scope or unknown id answers 404 so ids cannot be probed.
 */
@Injectable()
export class ClubEnrollmentReviewService {
  private readonly logger = new Logger(ClubEnrollmentReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ReviewerScopeService,
    private readonly catalogs: CatalogsService,
    private readonly enrollments: ClubEnrollmentsService,
    private readonly audit: CriticalAuditWriterService,
    private readonly notifications: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ========================================
  // QUEUE
  // ========================================

  async findQueue(actorId: string, query: ClubEnrollmentQueueQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const status = query.status ?? CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION;
    const channels = await this.resolveChannels(actorId);
    const base = await this.queueBaseWhere(channels, query);

    const [rows, total, grouped] = await Promise.all([
      this.prisma.club_enrollments.findMany({
        where: { AND: [base, { status }] },
        include: REVIEW_INCLUDE,
        orderBy:
          status === CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION
            ? [
                { submitted_at: { sort: 'asc', nulls: 'last' } },
                { created_at: 'asc' },
              ]
            : [{ reviewed_at: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.club_enrollments.count({
        where: { AND: [base, { status }] },
      }),
      this.prisma.club_enrollments.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
    ]);

    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const group of grouped) {
      if (group.status === CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION) {
        counts.pending = group._count._all;
      }
      if (group.status === CLUB_ENROLLMENT_STATUS.ACTIVE) {
        counts.approved = group._count._all;
      }
      if (group.status === CLUB_ENROLLMENT_STATUS.REJECTED) {
        counts.rejected = group._count._all;
      }
    }

    const items = await this.toItems(rows);
    return { items, meta: { page, limit, total, counts } };
  }

  // ========================================
  // DECISIONS
  // ========================================

  approve(actorId: string, enrollmentId: string) {
    return this.decide(actorId, enrollmentId, 'approved');
  }

  reject(actorId: string, enrollmentId: string, input: { reason: string }) {
    return this.decide(actorId, enrollmentId, 'rejected', input.reason.trim());
  }

  private async decide(
    actorId: string,
    enrollmentId: string,
    decision: Decision,
    reason?: string,
  ): Promise<ClubEnrollmentReviewItem> {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      select: {
        club_enrollment_id: true,
        club_section_id: true,
        ecclesiastical_year_id: true,
        status: true,
        director_id: true,
        created_by: true,
        club_section: { select: { main_club_id: true } },
      },
    });
    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    const channels = await this.resolveChannels(actorId);
    const reviewerRole = await this.scope.findReviewerRoleForSection(
      channels,
      enrollment.club_section_id,
    );
    if (!reviewerRole) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    if (
      await this.scope.holdsClubRoleInSection(
        actorId,
        enrollment.club_section_id,
        enrollment.ecclesiastical_year_id,
      )
    ) {
      throw new AppForbiddenException(ErrorCode.CE_SELF_REVIEW);
    }

    if (
      decision === 'approved' &&
      enrollment.status === CLUB_ENROLLMENT_STATUS.ACTIVE
    ) {
      // Already approved: idempotent, nothing changes and nobody is notified again.
      return this.loadItem(enrollmentId);
    }
    if (enrollment.status !== CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION) {
      throw new AppConflictException(ErrorCode.CE_ENROLLMENT_NOT_PENDING, {
        status: enrollment.status,
      });
    }

    const now = this.clock.now();
    const newStatus =
      decision === 'approved'
        ? CLUB_ENROLLMENT_STATUS.ACTIVE
        : CLUB_ENROLLMENT_STATUS.REJECTED;
    const decisionReason = decision === 'rejected' ? (reason ?? null) : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.club_enrollments.updateMany({
        where: {
          club_enrollment_id: enrollmentId,
          status: CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION,
        },
        data: {
          status: newStatus,
          reviewed_by_id: actorId,
          reviewer_role: reviewerRole,
          reviewed_at: now,
          decision_reason: decisionReason,
          modified_at: now,
        },
      });
      if (claimed.count !== 1) {
        throw new AppConflictException(ErrorCode.CE_ENROLLMENT_NOT_PENDING);
      }
      await this.audit.write(tx, {
        entityType: 'club_enrollments',
        entityId: enrollmentId,
        action:
          decision === 'approved'
            ? 'CLUB_ENROLLMENT_APPROVED'
            : 'CLUB_ENROLLMENT_REJECTED',
        // A rejected enrollment can be resubmitted and decided again, so the
        // key carries the instant of the decision.
        eventKey: `club-enrollment:${decision}:${enrollmentId}:${now.getTime()}`,
        actor: {
          kind: 'user',
          userId: actorId,
          roleName: reviewerRole,
          scope: { reviewer_role: reviewerRole },
        },
        target: {
          userId: enrollment.director_id ?? enrollment.created_by,
          scope: {
            club_section_id: enrollment.club_section_id,
            ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
          },
        },
        clubId: enrollment.club_section?.main_club_id ?? undefined,
        before: { status: CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION },
        after: { status: newStatus, reason: decisionReason },
        summary:
          decision === 'approved'
            ? 'Registro anual de sección aprobado'
            : 'Registro anual de sección rechazado',
        effectiveAt: now,
        correlationId: getAuditCorrelationId() ?? randomUUID(),
        result: 'succeeded',
      });
    });

    this.logger.log(
      `Annual club enrollment ${enrollmentId} ${decision} by ${actorId} as ${reviewerRole}`,
    );

    if (decision === 'approved') {
      await this.enrollments.createAnnualFolderForEnrollmentIfTemplateExists(
        enrollmentId,
      );
    }

    const item = await this.loadItem(enrollmentId);
    this.notifyOwners(actorId, enrollment, item, decision, decisionReason);
    return item;
  }

  /** Fire-and-forget: the transport failing never breaks the review. */
  private notifyOwners(
    actorId: string,
    enrollment: { director_id: string | null; created_by: string },
    item: ClubEnrollmentReviewItem,
    decision: Decision,
    reason: string | null,
  ): void {
    const recipients = new Set(
      [enrollment.director_id, enrollment.created_by].filter(
        (id): id is string => !!id && id !== actorId,
      ),
    );
    const approved = decision === 'approved';
    const club = `${item.club.name} (${item.section.club_type_name})`;
    const title = approved
      ? 'Registro anual aprobado'
      : 'Registro anual rechazado';
    const body = approved
      ? `El registro anual ${item.ecclesiastical_year.name} de ${club} fue aprobado.`
      : `El registro anual ${item.ecclesiastical_year.name} de ${club} fue rechazado${reason ? `: ${reason}` : '.'}`;
    for (const userId of recipients) {
      void this.notifications.notifySafe(
        userId,
        title,
        body,
        {
          type: 'club_enrollment_reviewed',
          entity_id: item.enrollment_id,
          action: decision,
          club_section_id: String(item.section.id),
        },
        CLUB_ENROLLMENT_REVIEW_SOURCE,
      );
    }
  }

  // ========================================
  // HELPERS
  // ========================================

  private resolveChannels(actorId: string): Promise<ReviewChannel[]> {
    return this.scope.resolveReviewerChannels(
      actorId,
      CLUB_ENROLLMENT_REVIEW_PERMISSION,
      {
        everywhere: [
          GlobalRole.SUPER_ADMIN,
          GlobalRole.ADMIN,
          GlobalRole.ASSISTANT_ADMIN,
        ],
        includeUnionDivision: true,
      },
    );
  }

  private async queueBaseWhere(
    channels: ReviewChannel[],
    query: ClubEnrollmentQueueQueryDto,
  ): Promise<Prisma.club_enrollmentsWhereInput> {
    const and: Prisma.club_enrollmentsWhereInput[] = [
      { club_section: this.scope.sectionsWhere(channels) },
    ];

    const yearId =
      query.ecclesiastical_year_id ??
      (await this.catalogs.getCurrentEcclesiasticalYear())
        ?.ecclesiastical_year_id;
    if (yearId !== undefined) {
      and.push({ ecclesiastical_year_id: yearId });
    }
    if (query.club_type_id !== undefined) {
      and.push({ club_section: { club_type_id: query.club_type_id } });
    }
    if (query.local_field_id !== undefined) {
      and.push({
        club_section: { clubs: { local_field_id: query.local_field_id } },
      });
    }

    const terms = (query.search ?? '')
      .split(/\s+/)
      .filter((term) => term.length > 0);
    for (const term of terms) {
      const match = {
        contains: escapeLikeWildcards(term),
        mode: 'insensitive' as const,
      };
      and.push({
        OR: [
          { club_section: { clubs: { name: match } } },
          { club_section: { club_types: { name: match } } },
          { club_section: { clubs: { local_fields: { name: match } } } },
          ...(
            ['name', 'paternal_last_name', 'maternal_last_name'] as const
          ).flatMap((field) => [
            { creator: { [field]: match } },
            { director: { [field]: match } },
          ]),
        ],
      });
    }
    return { AND: and };
  }

  private async loadItem(
    enrollmentId: string,
  ): Promise<ClubEnrollmentReviewItem> {
    const row = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: REVIEW_INCLUDE,
    });
    if (!row) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }
    const [item] = await this.toItems([row]);
    return item;
  }

  private async toItems(
    rows: ReviewRow[],
  ): Promise<ClubEnrollmentReviewItem[]> {
    if (rows.length === 0) return [];
    const deputyIds = [
      ...new Set(rows.flatMap((row) => row.deputy_director_ids)),
    ];
    const deputies = new Map<string, PersonRow>();
    if (deputyIds.length > 0) {
      const people = await this.prisma.users.findMany({
        where: { user_id: { in: deputyIds } },
        select: PERSON_SELECT,
      });
      for (const person of people) deputies.set(person.user_id, person);
    }
    return rows.map((row) => this.toItem(row, deputies));
  }

  private toItem(
    row: ReviewRow,
    deputies: Map<string, PersonRow>,
  ): ClubEnrollmentReviewItem {
    const section = row.club_section;
    const club = section.clubs;
    return {
      enrollment_id: row.club_enrollment_id,
      status: row.status,
      ecclesiastical_year: {
        id: row.ecclesiastical_year.year_id,
        name: ecclesiasticalYearName(row.ecclesiastical_year),
      },
      club: { id: club?.club_id ?? 0, name: club?.name ?? '' },
      section: {
        id: section.club_section_id,
        club_type_id: section.club_type_id,
        club_type_name: section.club_types?.name ?? '',
      },
      local_field: {
        id: club?.local_fields?.local_field_id ?? 0,
        name: club?.local_fields?.name ?? '',
      },
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      meeting_days: row.meeting_days,
      meeting_schedule: row.meeting_schedule,
      souls_target: row.souls_target,
      fee: row.fee,
      fee_amount: row.fee_amount === null ? null : Number(row.fee_amount),
      board: {
        director: this.person(row.director),
        deputies: row.deputy_director_ids.flatMap((id) => {
          const ref = this.person(deputies.get(id));
          return ref ? [ref] : [];
        }),
        secretary: this.person(row.secretary),
        treasurer: this.person(row.treasurer),
        secretary_treasurer: this.person(row.secretary_treasurer),
      },
      submitted_by: this.person(row.creator),
      created_at: row.created_at.toISOString(),
      submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
      modified_at: row.modified_at.toISOString(),
      reviewed_by: this.person(row.reviewer),
      reviewer_role: row.reviewer_role,
      reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      decision_reason: row.decision_reason,
    };
  }

  /** Full name only: never email or phone. */
  private person(row: PersonRow | null | undefined): PersonRef | null {
    return row ? { user_id: row.user_id, name: displayName(row) } : null;
  }
}
