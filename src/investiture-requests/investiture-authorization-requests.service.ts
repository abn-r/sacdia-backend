import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, investiture_status_enum } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { CLOCK, type Clock } from '../common/clock/clock';
import { toTerritoryId } from '../common/authorization/actor-territory-scope';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { isInstitutionalInvestitureClass } from '../certificate-bulk-imports/institutional-class-codes';
import {
  ClassRequirementEligibilityService,
  type ClassRequirementEligibilityResult,
} from '../classes/class-requirement-eligibility.service';
import {
  defaultInvestitureWindow,
  investitureWindowAllowsOperation,
} from '../classes/field-investiture-window';
import { PrismaService } from '../prisma/prisma.service';
import {
  INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
  investitureRequestYearEnded,
  localCivilDay,
  normalizeInvestitureTimeZone,
} from './ecclesiastical-year-local-day';
import { InvestitureCommunicationsService } from './investiture-communications.service';
import { pastorCanAuthorize } from './investiture-pastor-eligibility';
import type {
  PresentationBlockedCode,
  PresentationCandidate,
  PresentationContextView,
} from './investiture-presentation-context';
import {
  displayName,
  INVESTITURE_PERSON_PENDING_TEXT,
  INVESTITURE_PERSON_REJECTED_TEXT,
} from './investiture-communications.rules';
import {
  enrollmentOnLegacyInvestiturePipeline,
  HISTORICAL_CERTIFICATE_APPLIED_REASON,
  LATER_CERTIFICATE_ACCREDITATION_REASON,
  lockInvestitureAuthorizationCalendar,
  lockInvestitureAuthorizationEnrollment,
  lockInvestitureAuthorizationPastor,
  lockInvestitureAuthorizationSection,
  lockInvestitureAuthorizationUser,
  lockInvestitureAuthorizationYear,
} from './investiture-request-lock';
export { INVESTITURE_REQUEST_USER_LOCK_PREFIX } from './investiture-request-lock';

const MARK_ROLES = new Set(['director', 'secretary', 'secretary-treasurer']);
const FIELD_AUTHORIZER_ROLES = new Set(['director-lf', 'assistant-lf']);
const GM_TYPE_NAME = 'Guías Mayores';
const COMMENT_MAX = 500;
const REASON_MAX = 1000;

type DecisionStore = PrismaService | Prisma.TransactionClient;

function achievementIntentKey(personId: string): string {
  return `investiture-authorization:${personId}`;
}

type ClassCompletedDelivery = {
  personId: string;
  userId: string;
  classId: number;
  className: string | null;
  clubTypeId: number | null;
  intentKey?: string;
};

export const INVESTITURE_SYSTEM_REJECTION_TEXT =
  'Al comprobar el avance, esta persona no cubría los requisitos mínimos. Revisar sus evidencias de avance.';

type PersonStatus =
  | 'PENDING'
  | 'INVESTED'
  | 'REJECTED_BY_PERSON'
  | 'REJECTED_BY_SYSTEM'
  | 'REMOVED'
  | 'CLOSED_YEAR';

export type InvestitureRequestPersonView = {
  person_id: string;
  user_id: string;
  user_name: string | null;
  class_id: number;
  class_name: string | null;
  section_name: string | null;
  enrollment_id: number;
  investiture_date: string;
  status: PersonStatus;
  can_authorize: boolean;
  authorization_comment: string | null;
  rejection_reason: string | null;
  system_reason: string | null;
  resolution_code: string | null;
  resolved_by_id: string | null;
  resolved_by_name: string | null;
  date_changed_by_id: string | null;
  date_changed_at: string | null;
};

export type InvestitureResolutionInput = {
  invest?: Array<{ person_id: string; comment?: string | null }>;
  reject?: Array<{ person_id: string; reason?: string | null }>;
};

export type InvestitureResolutionView = {
  request_id: string;
  invested: InvestitureRequestPersonView[];
  rejected_by_person: InvestitureRequestPersonView[];
  rejected_by_system: InvestitureRequestPersonView[];
  retired: InvestitureRequestPersonView[];
  blocked: Array<{ person_id: string; code: string }>;
  already_resolved: Array<{ person_id: string; status: PersonStatus }>;
};

export type InvestitureRequestView = {
  request_id: string;
  club_section_id: number;
  ecclesiastical_year_id: number;
  /** Header data so a list can be drawn without reading every person. */
  club_id?: number | null;
  club_name?: string | null;
  section_name?: string | null;
  district_name?: string | null;
  /** People still PENDING in this request. */
  pending_count?: number;
  /** Earliest `investiture_date` among the PENDING people, or null. */
  earliest_investiture_date?: string | null;
  created_at?: string;
  people: InvestitureRequestPersonView[];
};

type SectionLabel = {
  sectionName: string | null;
  clubId: number | null;
  clubName: string | null;
  districtName: string | null;
};

type RequestLabels = {
  users: Map<string, string>;
  classes: Map<number, string>;
  sections: Map<number, SectionLabel>;
};

export type InvestitureHistoryEntry = {
  person_id: string;
  user_id: string;
  class_id: number;
  class_name?: string | null;
  club_section_id: number;
  ecclesiastical_year_id: number;
  investiture_date: string;
  status: PersonStatus | 'REJECTED';
  rejection_reason?: string | null;
  system_reason?: string | null;
  person_text: string | null;
  authorization_comment?: string | null;
};

export type InvestitureYearbookEntry = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  class_name: string | null;
  ecclesiastical_year_id: number;
};

const HISTORY_STATUSES: PersonStatus[] = [
  'INVESTED',
  'REJECTED_BY_PERSON',
  'REJECTED_BY_SYSTEM',
  'CLOSED_YEAR',
];

type WindowRange = { start_date: string; end_date: string };

type SectionContext = {
  clubSectionId: number;
  clubTypeId: number;
  mainClubId: number;
  localFieldId: number;
  timeZone: string;
  yearId: number;
  yearStart: string;
  yearEnd: string;
  yearActive: boolean;
  window: WindowRange | null;
  districtId: number | null;
};

type PresentationVerdict =
  | { eligible: true; singleSlot: boolean }
  | { eligible: false; code: PresentationBlockedCode };

const PRESENTATION_BAD_REQUEST_CODES = new Set<PresentationBlockedCode>([
  ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
  ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
  ErrorCode.INVESTITURE_DURATION_EXPIRED,
]);

function blockedPresentation(
  code: PresentationBlockedCode,
): PresentationVerdict {
  return { eligible: false, code };
}

/** Maps a blocking code back to the exception `present` has always thrown. */
function presentationException(
  code: PresentationBlockedCode,
  enrollment: { user_id: string; class_id: number },
): AppBadRequestException | AppConflictException {
  if (PRESENTATION_BAD_REQUEST_CODES.has(code)) {
    return new AppBadRequestException(code);
  }
  if (code === ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED) {
    return new AppConflictException(code, {
      userId: enrollment.user_id,
      classId: enrollment.class_id,
    });
  }
  return new AppConflictException(code);
}

type EnrollmentRow = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  locked_for_validation: boolean;
  record_kind: string;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    name?: string | null;
    min_duration_years: number;
    max_duration_years: number;
    club_type_id: number;
    club_types: { name: string } | null;
    asset_code?: string | null;
  } | null;
  ecclesiastical_year: { start_date: Date } | null;
};

const ENROLLMENT_ROW_SELECT = {
  enrollment_id: true,
  user_id: true,
  class_id: true,
  ecclesiastical_year_id: true,
  investiture_status: true,
  locked_for_validation: true,
  record_kind: true,
  cross_type_enrollment: true,
  active: true,
  classes: {
    select: {
      name: true,
      min_duration_years: true,
      max_duration_years: true,
      club_type_id: true,
      asset_code: true,
      club_types: { select: { name: true } },
    },
  },
  ecclesiastical_year: { select: { start_date: true } },
} satisfies Prisma.enrollmentsSelect;

const PRESENTATION_CANDIDATE_SELECT = {
  ...ENROLLMENT_ROW_SELECT,
  users: {
    select: {
      name: true,
      paternal_last_name: true,
      maternal_last_name: true,
    },
  },
} satisfies Prisma.enrollmentsSelect;

const PRESENTATION_EVALUATION_CHUNK = 8;

@Injectable()
export class InvestitureAuthorizationRequestService {
  private readonly logger = new Logger(
    InvestitureAuthorizationRequestService.name,
  );
  private readonly clock: Clock;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: ClassRequirementEligibilityService,
    private readonly achievements: AchievementsService,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional()
    private readonly communications?: InvestitureCommunicationsService,
  ) {
    this.clock = clock ?? { now: () => new Date() };
  }

  async present(
    authorization: AuthorizationSnapshot,
    actorId: string,
    clubSectionId: number,
    ecclesiasticalYearId: number,
    investitureDate: string,
    enrollmentIds: number[],
    now?: Date,
  ): Promise<InvestitureRequestView> {
    const enteredAt = this.decisionInstant(now);
    this.assertMarker(authorization, clubSectionId, ecclesiasticalYearId);
    this.assertSelection(enrollmentIds, investitureDate);
    const context = await this.loadContext(clubSectionId, ecclesiasticalYearId);
    this.assertYearOpen(context, enteredAt);
    this.assertTodayAllowsPresentation(context, enteredAt);
    this.assertDateInside(context, investitureDate);
    return this.append(
      actorId,
      context,
      null,
      investitureDate,
      enrollmentIds,
      now,
    );
  }

  async addPeople(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    investitureDate: string,
    enrollmentIds: number[],
    now?: Date,
  ): Promise<InvestitureRequestView> {
    const enteredAt = this.decisionInstant(now);
    this.assertSelection(enrollmentIds, investitureDate);
    const request = await this.requireRequest(requestId);
    this.assertMarker(
      authorization,
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    this.assertYearOpen(context, enteredAt);
    this.assertTodayAllowsPresentation(context, enteredAt);
    this.assertDateInside(context, investitureDate);
    return this.append(
      actorId,
      context,
      requestId,
      investitureDate,
      enrollmentIds,
      now,
    );
  }

  async remove(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    personId: string,
    now?: Date,
  ): Promise<InvestitureRequestPersonView> {
    const request = await this.requireRequest(requestId);
    this.assertMarker(
      authorization,
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    const at = this.decisionInstant(now);
    this.assertYearOpen(context, at);
    return this.prisma.$transaction(async (tx) => {
      const person = await tx.investiture_authorization_people.findUnique({
        where: { person_id: personId },
        select: { user_id: true, request_id: true },
      });
      if (!person || person.request_id !== requestId) {
        throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
      }
      await this.lockUsers(tx, [person.user_id]);
      const current = await tx.investiture_authorization_people.findUnique({
        where: { person_id: personId },
      });
      if (!current || current.status !== 'PENDING') {
        throw new AppConflictException(
          ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
        );
      }
      const updated = await tx.investiture_authorization_people.update({
        where: { person_id: personId },
        data: {
          status: 'REMOVED',
          resolution_code: 'REMOVED',
          resolved_by_id: actorId,
        },
      });
      return this.personView(updated);
    });
  }

  async changeDates(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    investitureDate: string,
    personIds: string[],
    now?: Date,
  ): Promise<InvestitureRequestView> {
    if (personIds.length === 0) {
      throw new AppBadRequestException(ErrorCode.INVESTITURE_REQUEST_EMPTY);
    }
    this.assertCivilDate(investitureDate);
    const request = await this.requireRequest(requestId);
    const marker = this.sectionRole(
      authorization,
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    if (!marker && !this.isSuperAdmin(authorization)) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    const at = this.decisionInstant(now);
    this.assertYearOpen(context, at);
    this.assertDateInside(context, investitureDate);
    const uniqueIds = [...new Set(personIds)].sort();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.investiture_authorization_people.findMany({
        where: { person_id: { in: uniqueIds }, request_id: requestId },
      });
      if (rows.length !== uniqueIds.length) {
        throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
      }
      await this.lockUsers(
        tx,
        rows.map((row) => row.user_id),
      );
      const current = await tx.investiture_authorization_people.findMany({
        where: { person_id: { in: uniqueIds }, request_id: requestId },
      });
      if (current.some((row) => row.status !== 'PENDING')) {
        throw new AppConflictException(
          ErrorCode.INVESTITURE_REQUEST_NOT_PENDING,
        );
      }
      await tx.investiture_authorization_people.updateMany({
        where: { person_id: { in: uniqueIds }, status: 'PENDING' },
        data: {
          investiture_date: civilDateToUtc(investitureDate),
          date_changed_by_id: actorId,
          date_changed_at: at,
        },
      });
      // BCR33-N1: the section directiva keeps the board shape; super-admin
      // (no section marker) never receives another person's human reason.
      return this.readRequest(tx, requestId, marker ? 'board' : 'authorizer');
    });
  }

  async list(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
    ecclesiasticalYearId: number,
  ): Promise<InvestitureRequestView | null> {
    this.assertMarker(authorization, clubSectionId, ecclesiasticalYearId);
    const pending =
      await this.prisma.investiture_authorization_people.findFirst({
        where: {
          status: 'PENDING',
          request: {
            club_section_id: clubSectionId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { request_id: true },
      });
    if (pending) {
      return this.readRequest(this.prisma, pending.request_id);
    }
    const informed =
      await this.prisma.investiture_authorization_people.findFirst({
        where: {
          resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED',
          request: {
            club_section_id: clubSectionId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { request_id: true, person_id: true },
        orderBy: [{ request_id: 'asc' }, { person_id: 'asc' }],
      });
    const laterCertificate =
      await this.prisma.investiture_authorization_people.findFirst({
        where: {
          status: 'CLOSED_YEAR',
          system_reason: LATER_CERTIFICATE_ACCREDITATION_REASON,
          request: {
            club_section_id: clubSectionId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { request_id: true, person_id: true },
        orderBy: [{ request_id: 'asc' }, { person_id: 'asc' }],
      });
    if (laterCertificate) {
      return this.readRequest(this.prisma, laterCertificate.request_id);
    }
    if (!informed) {
      return null;
    }
    return this.readRequest(this.prisma, informed.request_id);
  }

  /**
   * Read-only view for the section board: who can be presented today and why
   * the others cannot. Informative only; `present` re-checks everything under
   * its locks, so nothing here takes a lock or opens a transaction.
   */
  async presentationContext(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
    ecclesiasticalYearId: number,
    now?: Date,
  ): Promise<PresentationContextView> {
    this.assertMarker(authorization, clubSectionId, ecclesiasticalYearId);
    const at = this.decisionInstant(now);
    const context = await this.loadContext(
      clubSectionId,
      ecclesiasticalYearId,
      this.prisma,
      { validateTimeZone: false },
    );
    const enrollments = await this.presentationCandidates(context);
    const pending = await this.prisma.investiture_authorization_people.findMany(
      {
        where: {
          status: 'PENDING',
          request: {
            club_section_id: clubSectionId,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { person_id: true, request_id: true, enrollment_id: true },
      },
    );
    const openRequestId =
      pending.map((row) => row.request_id).sort()[0] ?? null;
    const pendingByEnrollment = new Map(
      pending.map((row) => [row.enrollment_id, row.person_id]),
    );
    const progress =
      enrollments.length > 0
        ? await this.eligibility.calculateForEnrollments(
            enrollments.map((row) => row.enrollment_id),
          )
        : new Map<number, ClassRequirementEligibilityResult>();
    const candidates: PresentationCandidate[] = [];
    for (
      let index = 0;
      index < enrollments.length;
      index += PRESENTATION_EVALUATION_CHUNK
    ) {
      const chunk = enrollments.slice(
        index,
        index + PRESENTATION_EVALUATION_CHUNK,
      );
      const verdicts = await Promise.all(
        chunk.map((row) =>
          this.evaluateEnrollmentForPresentation(
            this.prisma,
            context,
            row,
            progress,
          ),
        ),
      );
      chunk.forEach((row, offset) => {
        const verdict = verdicts[offset];
        candidates.push({
          enrollment_id: row.enrollment_id,
          user_id: row.user_id,
          user_name: row.users ? displayName(row.users) : null,
          class_id: row.class_id,
          class_name: row.classes?.name ?? null,
          overall_progress:
            progress.get(row.enrollment_id)?.overall_progress ?? 0,
          eligible: verdict.eligible,
          blocked_code: verdict.eligible ? null : verdict.code,
          pending_person_id: pendingByEnrollment.get(row.enrollment_id) ?? null,
        });
      });
    }
    candidates.sort(
      (left, right) =>
        Number(right.eligible) - Number(left.eligible) ||
        compareNames(left.user_name, right.user_name) ||
        left.enrollment_id - right.enrollment_id,
    );
    return {
      club_section_id: clubSectionId,
      ecclesiastical_year_id: ecclesiasticalYearId,
      window: {
        start_date: context.window?.start_date ?? null,
        end_date: context.window?.end_date ?? null,
        open_today: this.windowOpenToday(context, at),
      },
      year_open: this.isYearOpen(context, at),
      open_request_id: openRequestId,
      candidates,
    };
  }

  /**
   * Operational, active, not yet invested enrollments of the club type that
   * `present` would accept: members of the section for the year, plus the
   * cross-type rows of a Guía Mayor whose home is another section of the club.
   */
  private async presentationCandidates(context: SectionContext) {
    const base: Prisma.enrollmentsWhereInput = {
      active: true,
      record_kind: 'OPERATIONAL',
      investiture_status: { not: 'INVESTIDO' },
      classes: { club_type_id: context.clubTypeId },
    };
    const [members, crossType] = await Promise.all([
      this.prisma.enrollments.findMany({
        where: {
          ...base,
          users: {
            club_role_assignments: {
              some: {
                club_section_id: context.clubSectionId,
                ecclesiastical_year_id: context.yearId,
                active: true,
                status: 'active',
              },
            },
          },
        },
        select: PRESENTATION_CANDIDATE_SELECT,
      }),
      this.prisma.enrollments.findMany({
        where: {
          ...base,
          cross_type_enrollment: true,
          users: {
            club_role_assignments: {
              some: {
                ecclesiastical_year_id: context.yearId,
                active: true,
                status: 'active',
                club_sections: {
                  main_club_id: context.mainClubId,
                  club_section_id: { not: context.clubSectionId },
                  club_type_id: { not: context.clubTypeId },
                },
              },
            },
          },
        },
        select: PRESENTATION_CANDIDATE_SELECT,
      }),
    ]);
    const seen = new Set(members.map((row) => row.enrollment_id));
    const accepted = [...members];
    for (const row of crossType) {
      if (seen.has(row.enrollment_id)) {
        continue;
      }
      if (await this.hasCrossTypeHome(this.prisma, context, row)) {
        accepted.push(row);
      }
    }
    return accepted;
  }

  async listForAuthorizer(
    authorization: AuthorizationSnapshot,
    actorId: string,
    ecclesiasticalYearId: number,
  ): Promise<InvestitureRequestView[]> {
    const sectionIds = await this.authorizerSectionIds(authorization, actorId);
    const rows = await this.prisma.investiture_authorization_requests.findMany({
      where: {
        ecclesiastical_year_id: ecclesiasticalYearId,
        club_section_id: { in: [...sectionIds] },
        OR: [
          { people: { some: { status: 'PENDING' } } },
          {
            people: {
              some: { resolution_code: 'HISTORICAL_CERTIFICATE_APPLIED' },
            },
          },
          {
            people: {
              some: {
                status: 'CLOSED_YEAR',
                system_reason: LATER_CERTIFICATE_ACCREDITATION_REASON,
              },
            },
          },
        ],
      },
      select: { request_id: true },
      orderBy: { request_id: 'asc' },
    });
    return this.readRequests(
      this.prisma,
      rows.map((row) => row.request_id),
      'authorizer',
    );
  }

  async readForAuthorizer(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
  ): Promise<InvestitureRequestView> {
    const request = await this.requireRequest(requestId);
    // BCR-8: a read never depends on the stored field time zone being valid;
    // only writes (present, resolve, ...) reject an invalid zone.
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
      this.prisma,
      { validateTimeZone: false },
    );
    if (!this.isSuperAdmin(authorization)) {
      await this.assertAuthorizer(authorization, actorId, context);
    }
    // BCR-7: super-admin gets the authorizer shape (no human rejection reason).
    return this.readRequest(this.prisma, requestId, 'authorizer');
  }

  async ownHistory(actorId: string): Promise<InvestitureHistoryEntry[]> {
    const rows = await this.prisma.investiture_authorization_people.findMany({
      where: {
        user_id: actorId,
        OR: [
          { status: { in: [...HISTORY_STATUSES, 'PENDING'] } },
          {
            status: 'REMOVED',
            system_reason: HISTORICAL_CERTIFICATE_APPLIED_REASON,
          },
        ],
      },
      include: {
        request: {
          select: {
            club_section_id: true,
            ecclesiastical_year_id: true,
          },
        },
      },
      orderBy: { person_id: 'asc' },
    });
    const classNames = await this.classNames(
      this.prisma,
      rows.map((row) => row.class_id),
    );
    return rows.map((row) =>
      this.historyEntry(row, 'person', classNames.get(row.class_id) ?? null),
    );
  }

  async sectionHistory(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
  ): Promise<InvestitureHistoryEntry[]> {
    this.assertSectionBoard(authorization, clubSectionId);
    const rows = await this.prisma.investiture_authorization_people.findMany({
      where: {
        status: { in: HISTORY_STATUSES },
        request: { club_section_id: clubSectionId },
      },
      include: {
        request: {
          select: {
            club_section_id: true,
            ecclesiastical_year_id: true,
          },
        },
      },
      orderBy: { person_id: 'asc' },
    });
    const classNames = await this.classNames(
      this.prisma,
      rows.map((row) => row.class_id),
    );
    return rows.map((row) =>
      this.historyEntry(row, 'section', classNames.get(row.class_id) ?? null),
    );
  }

  async yearbook(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
  ): Promise<{
    club_section_id: number;
    entries: InvestitureYearbookEntry[];
  }> {
    this.assertSectionBoard(authorization, clubSectionId);
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: {
        club_type_id: true,
        main_club_id: true,
      },
    });
    if (!section?.club_type_id || section.main_club_id == null) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_REQUEST_SECTION_NOT_FOUND,
      );
    }
    const siblings = await this.prisma.club_sections.findMany({
      where: { main_club_id: section.main_club_id },
      select: { club_section_id: true },
    });
    const assignments = await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: {
          in: siblings.map((sibling) => sibling.club_section_id),
        },
        status: { in: ['active', 'inactive', 'ended'] },
      },
      select: { user_id: true, ecclesiastical_year_id: true },
    });
    if (assignments.length === 0) {
      return { club_section_id: clubSectionId, entries: [] };
    }
    const pairs = new Map<
      string,
      { user_id: string; ecclesiastical_year_id: number }
    >();
    for (const assignment of assignments) {
      pairs.set(
        `${assignment.user_id}:${assignment.ecclesiastical_year_id}`,
        assignment,
      );
    }
    const enrollments = await this.prisma.enrollments.findMany({
      where: {
        record_kind: 'OPERATIONAL',
        classes: { club_type_id: section.club_type_id },
        OR: [...pairs.values()].map((assignment) => ({
          user_id: assignment.user_id,
          ecclesiastical_year_id: assignment.ecclesiastical_year_id,
        })),
      },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        classes: { select: { name: true } },
      },
      orderBy: [
        { ecclesiastical_year_id: 'asc' },
        { class_id: 'asc' },
        { user_id: 'asc' },
      ],
    });
    return {
      club_section_id: clubSectionId,
      entries: enrollments.map((enrollment) => ({
        enrollment_id: enrollment.enrollment_id,
        user_id: enrollment.user_id,
        class_id: enrollment.class_id,
        class_name: enrollment.classes?.name ?? null,
        ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
      })),
    };
  }

  async resolve(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    input: InvestitureResolutionInput,
    now?: Date,
  ): Promise<InvestitureResolutionView> {
    const invest = input.invest ?? [];
    const reject = input.reject ?? [];
    if (invest.length + reject.length === 0) {
      throw new AppBadRequestException(ErrorCode.INVESTITURE_REQUEST_EMPTY);
    }
    const ids = [
      ...invest.map((item) => item.person_id),
      ...reject.map((item) => item.person_id),
    ];
    if (new Set(ids).size !== ids.length) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_REQUEST_CONFLICTING_DECISION,
      );
    }
    for (const item of reject) {
      const reason = item.reason?.trim() ?? '';
      if (!reason) {
        throw new AppBadRequestException(
          ErrorCode.INVESTITURE_REQUEST_REASON_REQUIRED,
        );
      }
      if (reason.length > REASON_MAX) {
        throw new AppBadRequestException(
          ErrorCode.INVESTITURE_REQUEST_TEXT_TOO_LONG,
        );
      }
    }
    for (const item of invest) {
      const comment = item.comment?.trim() ?? '';
      if (comment.length > COMMENT_MAX) {
        throw new AppBadRequestException(
          ErrorCode.INVESTITURE_REQUEST_TEXT_TOO_LONG,
        );
      }
    }
    const request = await this.requireRequest(requestId);
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    await this.assertAuthorizer(authorization, actorId, context);
    const enteredAt = this.decisionInstant(now);
    this.assertYearOpen(context, enteredAt);
    this.assertTodayAllowsPresentation(context, enteredAt);
    const rejectIds = new Set(reject.map((item) => item.person_id));
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.investiture_authorization_people.findMany({
        where: { request_id: requestId, person_id: { in: ids } },
      });
      if (rows.length !== ids.length) {
        throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
      }
      await lockInvestitureAuthorizationYear(tx, context.yearId);
      await lockInvestitureAuthorizationCalendar(
        tx,
        context.localFieldId,
        context.yearId,
      );
      if (
        !this.fieldAuthorizesSection(authorization, context) &&
        context.districtId
      ) {
        await lockInvestitureAuthorizationPastor(
          tx,
          context.districtId,
          actorId,
        );
      }
      await this.lockSection(tx, context.clubSectionId, context.yearId);
      await this.lockUsers(
        tx,
        rows.map((row) => row.user_id),
      );
      await this.lockEnrollments(
        tx,
        rows.map((row) => row.enrollment_id),
      );
      const decision = await this.loadContext(
        request.club_section_id,
        request.ecclesiastical_year_id,
        tx,
      );
      await this.assertAuthorizer(authorization, actorId, decision, tx);
      const decidedAt = this.decisionInstant(now);
      this.assertYearOpen(decision, decidedAt);
      this.assertTodayAllowsPresentation(decision, decidedAt);
      const current = await tx.investiture_authorization_people.findMany({
        where: { request_id: requestId, person_id: { in: ids } },
      });
      const invested: InvestitureRequestPersonView[] = [];
      const rejectedByPerson: InvestitureRequestPersonView[] = [];
      const rejectedBySystem: InvestitureRequestPersonView[] = [];
      const retired: InvestitureRequestPersonView[] = [];
      const blocked: Array<{ person_id: string; code: string }> = [];
      const alreadyResolved: Array<{
        person_id: string;
        status: PersonStatus;
      }> = [];
      const emit: ClassCompletedDelivery[] = [];
      const recover: ClassCompletedDelivery[] = [];
      for (const personId of ids) {
        const person = current.find((row) => row.person_id === personId);
        if (!person) {
          throw new AppNotFoundException(
            ErrorCode.INVESTITURE_REQUEST_NOT_FOUND,
          );
        }
        if (person.status !== 'PENDING') {
          if (person.status === 'INVESTED' && person.achievement_intent_key) {
            const enrollment = await this.loadEnrollment(
              person.enrollment_id,
              tx,
            );
            recover.push({
              personId: person.person_id,
              userId: enrollment.user_id,
              classId: enrollment.class_id,
              className: enrollment.classes?.name ?? null,
              clubTypeId: enrollment.classes?.club_type_id ?? null,
            });
          }
          alreadyResolved.push({
            person_id: person.person_id,
            status: person.status,
          });
          continue;
        }
        const enrollment = await this.loadEnrollment(person.enrollment_id, tx);
        if (isInstitutionalInvestitureClass(enrollment.classes?.asset_code)) {
          const updated = await tx.investiture_authorization_people.updateMany({
            where: { person_id: person.person_id, status: 'PENDING' },
            data: {
              status: 'REMOVED',
              resolution_code: 'CLASS_NOT_ELIGIBLE',
            },
          });
          if (updated.count !== 1) {
            alreadyResolved.push({
              person_id: person.person_id,
              status: 'REMOVED',
            });
            continue;
          }
          retired.push(
            this.personView({
              ...person,
              status: 'REMOVED',
              resolution_code: 'CLASS_NOT_ELIGIBLE',
            }),
          );
          continue;
        }
        const date = civilDate(person.investiture_date);
        if (
          date < decision.yearStart ||
          date > decision.yearEnd ||
          !decision.window ||
          date < decision.window.start_date ||
          date > decision.window.end_date
        ) {
          blocked.push({
            person_id: person.person_id,
            code:
              date < decision.yearStart || date > decision.yearEnd
                ? ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_YEAR
                : ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_WINDOW,
          });
          continue;
        }
        if (!enrollment.active || enrollment.record_kind !== 'OPERATIONAL') {
          blocked.push({
            person_id: person.person_id,
            code: ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL,
          });
          continue;
        }
        const sameClassInvested = await this.findSameClassInvested(
          tx,
          enrollment,
        );
        if (sameClassInvested || this.legacyBlocksResolution(enrollment)) {
          const resolutionCode = sameClassInvested
            ? 'ALREADY_INVESTED'
            : 'LEGACY_PIPELINE_ACTIVE';
          const updated = await tx.investiture_authorization_people.updateMany({
            where: { person_id: person.person_id, status: 'PENDING' },
            data: {
              status: 'REMOVED',
              resolution_code: resolutionCode,
            },
          });
          if (updated.count !== 1) {
            alreadyResolved.push({
              person_id: person.person_id,
              status: 'REMOVED',
            });
            continue;
          }
          retired.push(
            this.personView({
              ...person,
              status: 'REMOVED',
              resolution_code: resolutionCode,
            }),
          );
          continue;
        }
        if (rejectIds.has(person.person_id)) {
          const reason =
            reject
              .find((item) => item.person_id === person.person_id)
              ?.reason?.trim() ?? '';
          const updated = await tx.investiture_authorization_people.updateMany({
            where: { person_id: person.person_id, status: 'PENDING' },
            data: {
              status: 'REJECTED_BY_PERSON',
              resolution_code: 'REJECTED_BY_PERSON',
              rejection_reason: reason,
              resolved_by_id: actorId,
            },
          });
          if (updated.count !== 1) {
            alreadyResolved.push({
              person_id: person.person_id,
              status: person.status,
            });
            continue;
          }
          rejectedByPerson.push(
            this.personView({
              ...person,
              status: 'REJECTED_BY_PERSON',
              rejection_reason: reason,
              resolved_by_id: actorId,
            }),
          );
          continue;
        }
        const failed = await this.failsRequirements(tx, decision, enrollment);
        if (failed) {
          const updated = await tx.investiture_authorization_people.updateMany({
            where: { person_id: person.person_id, status: 'PENDING' },
            data: {
              status: 'REJECTED_BY_SYSTEM',
              resolution_code: 'REQUIREMENTS',
              system_reason: INVESTITURE_SYSTEM_REJECTION_TEXT,
            },
          });
          if (updated.count !== 1) {
            alreadyResolved.push({
              person_id: person.person_id,
              status: person.status,
            });
            continue;
          }
          rejectedBySystem.push(
            this.personView({
              ...person,
              status: 'REJECTED_BY_SYSTEM',
              system_reason: INVESTITURE_SYSTEM_REJECTION_TEXT,
            }),
          );
          continue;
        }
        const comment =
          invest
            .find((item) => item.person_id === person.person_id)
            ?.comment?.trim() || null;
        const marked = await tx.enrollments.updateMany({
          where: {
            enrollment_id: person.enrollment_id,
            investiture_status:
              enrollment.investiture_status as investiture_status_enum,
          },
          data: {
            investiture_status: 'INVESTIDO',
            investiture_date: person.investiture_date,
            locked_for_validation: false,
          },
        });
        if (marked.count !== 1) {
          const current = await tx.enrollments.findUnique({
            where: { enrollment_id: person.enrollment_id },
            select: {
              investiture_status: true,
              locked_for_validation: true,
            },
          });
          const resolutionCode =
            current?.investiture_status === 'INVESTIDO'
              ? 'ALREADY_INVESTED'
              : current && this.legacyBlocksResolution(current)
                ? 'LEGACY_PIPELINE_ACTIVE'
                : 'CONCURRENT_STATUS';
          const retiredRow =
            await tx.investiture_authorization_people.updateMany({
              where: { person_id: person.person_id, status: 'PENDING' },
              data: {
                status: 'REMOVED',
                resolution_code: resolutionCode,
              },
            });
          if (retiredRow.count === 1) {
            retired.push(
              this.personView({
                ...person,
                status: 'REMOVED',
                resolution_code: resolutionCode,
              }),
            );
          } else {
            alreadyResolved.push({
              person_id: person.person_id,
              status: 'REMOVED',
            });
          }
          continue;
        }
        const updated = await tx.investiture_authorization_people.updateMany({
          where: { person_id: person.person_id, status: 'PENDING' },
          data: {
            status: 'INVESTED',
            resolution_code: 'INVESTED',
            authorization_comment: comment,
            resolved_by_id: actorId,
            achievement_intent_key: achievementIntentKey(person.person_id),
          },
        });
        if (updated.count !== 1) {
          alreadyResolved.push({
            person_id: person.person_id,
            status: person.status,
          });
          continue;
        }
        invested.push(
          this.personView({
            ...person,
            status: 'INVESTED',
            authorization_comment: comment,
            resolved_by_id: actorId,
          }),
        );
        emit.push({
          personId: person.person_id,
          userId: enrollment.user_id,
          classId: enrollment.class_id,
          className: enrollment.classes?.name ?? null,
          clubTypeId: enrollment.classes?.club_type_id ?? null,
        });
      }
      const wrote =
        invested.length +
        rejectedByPerson.length +
        rejectedBySystem.length +
        retired.length;
      if (wrote > 0) {
        await this.communications?.stageResults?.(tx, {
          requestId,
          actorId,
          investedIds: invested.map((person) => person.person_id),
          rejectedPersonIds: rejectedByPerson.map((person) => person.person_id),
          rejectedSystemIds: rejectedBySystem.map((person) => person.person_id),
        });
      }
      if (wrote === 0 && blocked.length > 0 && recover.length === 0) {
        throw new AppBadRequestException(blocked[0].code as ErrorCode);
      }
      if (wrote === 0 && recover.length === 0) {
        throw new AppConflictException(
          ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
        );
      }
      return {
        view: {
          request_id: requestId,
          invested,
          rejected_by_person: rejectedByPerson,
          rejected_by_system: rejectedBySystem,
          retired,
          blocked,
          already_resolved: alreadyResolved,
        },
        emit,
        recover,
        conflictOnly: wrote === 0,
      };
    });
    if (outcome.conflictOnly) {
      await this.deliverClassCompleted(outcome.recover);
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_ALREADY_RESOLVED,
      );
    }
    await this.deliverClassCompleted(outcome.emit, { swallow: true });
    await this.communications?.recordResults({
      requestId,
      actorId,
      investedIds: outcome.view.invested.map((person) => person.person_id),
      rejectedPersonIds: outcome.view.rejected_by_person.map(
        (person) => person.person_id,
      ),
      rejectedSystemIds: outcome.view.rejected_by_system.map(
        (person) => person.person_id,
      ),
    });
    return {
      ...outcome.view,
      invested: outcome.view.invested.map((person) => ({
        ...person,
        rejection_reason: null,
      })),
      rejected_by_person: outcome.view.rejected_by_person.map((person) => ({
        ...person,
        rejection_reason: null,
      })),
      rejected_by_system: outcome.view.rejected_by_system.map((person) => ({
        ...person,
        rejection_reason: null,
      })),
      retired: outcome.view.retired.map((person) => ({
        ...person,
        rejection_reason: null,
      })),
    };
  }

  /**
   * Entrega intenciones ya confirmadas. No comprueba año, ventana ni asignación:
   * eso solo aplica a una decisión nueva.
   */
  async reconcileConfirmedAchievementIntents(): Promise<number> {
    const people = await this.prisma.investiture_authorization_people.findMany({
      where: {
        status: 'INVESTED',
        achievement_intent_key: { not: null },
      },
    });
    const keys = people.flatMap((person) =>
      person.achievement_intent_key ? [person.achievement_intent_key] : [],
    );
    if (keys.length === 0) {
      return 0;
    }
    const finished = await this.prisma.achievement_event_log.findMany({
      where: { idempotency_key: { in: keys }, processed: true },
      select: { idempotency_key: true },
    });
    const done = new Set(
      finished.flatMap((row) =>
        row.idempotency_key ? [row.idempotency_key] : [],
      ),
    );
    let delivered = 0;
    for (const person of people) {
      const intentKey = person.achievement_intent_key;
      if (!intentKey || done.has(intentKey)) {
        continue;
      }
      try {
        const enrollment = await this.loadEnrollment(person.enrollment_id);
        await this.deliverClassCompleted([
          {
            personId: person.person_id,
            userId: enrollment.user_id,
            classId: enrollment.class_id,
            className: enrollment.classes?.name ?? null,
            clubTypeId: enrollment.classes?.club_type_id ?? null,
            intentKey,
          },
        ]);
        delivered += 1;
      } catch (error) {
        this.logger.warn(
          `No se pudo reconciliar class.completed de ${person.person_id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return delivered;
  }

  private decisionInstant(explicit?: Date): Date {
    return explicit ?? this.clock.now();
  }

  private async deliverClassCompleted(
    items: ClassCompletedDelivery[],
    options?: { swallow?: boolean },
  ): Promise<void> {
    for (const item of items) {
      try {
        await this.achievements.emitEvent({
          userId: item.userId,
          eventType: 'class.completed',
          payload: {
            class_id: item.classId,
            class_name: item.className,
            club_type_id: item.clubTypeId,
          },
          idempotencyKey: item.intentKey ?? achievementIntentKey(item.personId),
        });
      } catch (error) {
        if (!options?.swallow) {
          throw error;
        }
        this.logger.warn(
          `No se pudo emitir class.completed para ${item.userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async append(
    actorId: string,
    context: SectionContext,
    requestId: string | null,
    investitureDate: string,
    enrollmentIds: number[],
    now?: Date,
  ): Promise<InvestitureRequestView> {
    const uniqueIds = [...new Set(enrollmentIds)];
    const loaded = await Promise.all(
      uniqueIds.map((enrollmentId) => this.loadEnrollment(enrollmentId)),
    );
    let operationId: string | undefined;
    try {
      operationId = await this.writePeople(
        actorId,
        context,
        requestId,
        investitureDate,
        loaded,
        now,
      );
    } catch (error) {
      const invested = investedTarget(error);
      if (invested) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockUsers(tx, [invested.userId]);
          await tx.investiture_authorization_people.updateMany({
            where: {
              user_id: invested.userId,
              class_id: invested.classId,
              status: 'PENDING',
            },
            data: {
              status: 'REMOVED',
              resolution_code: 'ALREADY_INVESTED',
            },
          });
        });
      }
      throw error;
    }
    const saved = await this.prisma.investiture_authorization_people.findFirst({
      where: {
        enrollment_id: { in: uniqueIds },
        status: 'PENDING',
        request: {
          club_section_id: context.clubSectionId,
          ecclesiastical_year_id: context.yearId,
        },
      },
      select: { request_id: true },
    });
    if (!saved) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    await this.communications?.recordPresentation({
      requestId: saved.request_id,
      enrollmentIds: uniqueIds,
      operationId,
    });
    return this.readRequest(this.prisma, saved.request_id);
  }

  private async writePeople(
    actorId: string,
    context: SectionContext,
    requestId: string | null,
    investitureDate: string,
    loaded: EnrollmentRow[],
    now?: Date,
  ): Promise<string> {
    const operationId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await lockInvestitureAuthorizationYear(tx, context.yearId);
      await lockInvestitureAuthorizationCalendar(
        tx,
        context.localFieldId,
        context.yearId,
      );
      await this.lockSection(tx, context.clubSectionId, context.yearId);
      await this.lockUsers(
        tx,
        loaded.map((enrollment) => enrollment.user_id),
      );
      await this.lockEnrollments(
        tx,
        loaded.map((enrollment) => enrollment.enrollment_id),
      );
      const fresh = await this.loadContext(
        context.clubSectionId,
        context.yearId,
        tx,
      );
      const effective = this.decisionInstant(now);
      this.assertYearOpen(fresh, effective);
      this.assertTodayAllowsPresentation(fresh, effective);
      this.assertDateInside(fresh, investitureDate);
      const open = await tx.investiture_authorization_people.findFirst({
        where: {
          status: 'PENDING',
          request: {
            club_section_id: fresh.clubSectionId,
            ecclesiastical_year_id: fresh.yearId,
          },
        },
        select: { request_id: true },
      });
      let targetId = requestId;
      if (!targetId) {
        if (open) {
          targetId = open.request_id;
        } else {
          const created = await tx.investiture_authorization_requests.create({
            data: {
              club_section_id: fresh.clubSectionId,
              ecclesiastical_year_id: fresh.yearId,
              created_by_id: actorId,
            },
          });
          targetId = created.request_id;
        }
      } else if (open && open.request_id !== targetId) {
        throw new AppConflictException(ErrorCode.INVESTITURE_REQUEST_STALE);
      }
      for (const seeded of loaded) {
        const enrollment = await this.loadEnrollment(seeded.enrollment_id, tx);
        const singleSlot = await this.acceptEnrollment(tx, fresh, enrollment);
        await tx.investiture_authorization_people.create({
          data: {
            request_id: targetId,
            user_id: enrollment.user_id,
            class_id: enrollment.class_id,
            enrollment_id: enrollment.enrollment_id,
            investiture_date: civilDateToUtc(investitureDate),
            status: 'PENDING',
            single_slot: singleSlot,
          },
        });
      }
      await this.communications?.stagePresentation?.(tx, {
        requestId: targetId,
        enrollmentIds: loaded.map((enrollment) => enrollment.enrollment_id),
        operationId,
      });
    });
    return operationId;
  }

  private async acceptEnrollment(
    store: Prisma.TransactionClient,
    context: SectionContext,
    enrollment: EnrollmentRow,
  ): Promise<boolean> {
    const verdict = await this.evaluateEnrollmentForPresentation(
      store,
      context,
      enrollment,
    );
    if (!verdict.eligible) {
      throw presentationException(verdict.code, enrollment);
    }
    return verdict.singleSlot;
  }

  /**
   * Decides whether an enrollment may be presented for investiture, returning
   * the first blocking code instead of throwing. It never writes and takes no
   * lock; callers that write run it under the section/user/enrollment locks.
   */
  private async evaluateEnrollmentForPresentation(
    store: DecisionStore,
    context: SectionContext,
    enrollment: EnrollmentRow,
    eligibilityByEnrollment?: Map<number, ClassRequirementEligibilityResult>,
  ): Promise<PresentationVerdict> {
    if (isInstitutionalInvestitureClass(enrollment.classes?.asset_code)) {
      return blockedPresentation(
        ErrorCode.INVESTITURE_REQUEST_CLASS_NOT_ELIGIBLE,
      );
    }
    if (!enrollment.active || enrollment.record_kind !== 'OPERATIONAL') {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL);
    }
    if (enrollment.classes?.club_type_id !== context.clubTypeId) {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION);
    }
    const member = await store.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        club_section_id: context.clubSectionId,
        ecclesiastical_year_id: context.yearId,
        active: true,
        status: 'active',
      },
      select: { assignment_id: true },
    });
    if (!member && !(await this.hasCrossTypeHome(store, context, enrollment))) {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION);
    }
    if (await this.findSameClassInvested(store, enrollment)) {
      return blockedPresentation(
        ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
      );
    }
    if (enrollmentOnLegacyInvestiturePipeline(enrollment)) {
      return blockedPresentation(
        ErrorCode.INVESTITURE_REQUEST_LEGACY_PIPELINE_ACTIVE,
      );
    }
    const pending = await store.investiture_authorization_people.findMany({
      where: { user_id: enrollment.user_id, status: 'PENDING' },
      select: { class_id: true, single_slot: true },
    });
    const singleSlot = await this.usesSingleSlot(store, enrollment);
    const blocked =
      singleSlot || pending.some((row) => row.single_slot)
        ? pending.length > 0
        : pending.some((row) => row.class_id === enrollment.class_id);
    if (blocked) {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS);
    }
    const result = eligibilityByEnrollment
      ? eligibilityByEnrollment.get(enrollment.enrollment_id)
      : await this.eligibility.calculateForEnrollment(enrollment.enrollment_id);
    if (!result?.investiture_eligibility.eligible) {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE);
    }
    if (!enrollment.classes || !enrollment.ecclesiastical_year) {
      return blockedPresentation(ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE);
    }
    if (enrollment.investiture_status === 'EXPIRED') {
      return blockedPresentation(ErrorCode.INVESTITURE_DURATION_EXPIRED);
    }
    const elapsed = await store.ecclesiastical_years.count({
      where: {
        start_date: {
          gte: enrollment.ecclesiastical_year.start_date,
          lte: civilDateToUtc(context.yearStart),
        },
      },
    });
    if (elapsed < enrollment.classes.min_duration_years) {
      return blockedPresentation(ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET);
    }
    if (elapsed > enrollment.classes.max_duration_years) {
      return blockedPresentation(ErrorCode.INVESTITURE_DURATION_EXPIRED);
    }
    return { eligible: true, singleSlot };
  }

  private async hasCrossTypeHome(
    store: DecisionStore,
    context: SectionContext,
    enrollment: EnrollmentRow,
  ): Promise<boolean> {
    if (!enrollment.cross_type_enrollment) {
      return false;
    }
    const home = await store.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        ecclesiastical_year_id: context.yearId,
        active: true,
        status: 'active',
        club_sections: {
          main_club_id: context.mainClubId,
          club_section_id: { not: context.clubSectionId },
          club_type_id: { not: context.clubTypeId },
        },
      },
      select: { assignment_id: true },
    });
    if (!home) {
      return false;
    }
    const investedGm = await store.enrollments.findFirst({
      where: {
        user_id: enrollment.user_id,
        investiture_status: 'INVESTIDO',
        classes: { club_types: { name: GM_TYPE_NAME } },
      },
      select: { enrollment_id: true },
    });
    return Boolean(investedGm);
  }

  private async usesSingleSlot(
    store: DecisionStore,
    enrollment: EnrollmentRow,
  ): Promise<boolean> {
    if (enrollment.classes?.club_types?.name === GM_TYPE_NAME) {
      return false;
    }
    if (!enrollment.cross_type_enrollment) {
      return true;
    }
    const investedGm = await store.enrollments.findFirst({
      where: {
        user_id: enrollment.user_id,
        investiture_status: 'INVESTIDO',
        classes: { club_types: { name: GM_TYPE_NAME } },
      },
      select: { enrollment_id: true },
    });
    return !investedGm;
  }

  private legacyBlocksResolution(enrollment: {
    investiture_status: string;
    locked_for_validation?: boolean | null;
  }): boolean {
    if (enrollment.investiture_status === 'FIELD_APPROVED') {
      return false;
    }
    return enrollmentOnLegacyInvestiturePipeline(enrollment);
  }

  private async findSameClassInvested(
    store: DecisionStore,
    enrollment: { user_id: string; class_id: number },
  ): Promise<boolean> {
    const invested = await store.enrollments.findFirst({
      where: {
        user_id: enrollment.user_id,
        class_id: enrollment.class_id,
        investiture_status: 'INVESTIDO',
      },
      select: { enrollment_id: true },
    });
    return Boolean(invested);
  }

  private async loadEnrollment(
    enrollmentId: number,
    store: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<EnrollmentRow> {
    const enrollment = await store.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: ENROLLMENT_ROW_SELECT,
    });
    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    return enrollment;
  }

  private async loadContext(
    clubSectionId: number,
    ecclesiasticalYearId: number,
    store: DecisionStore = this.prisma,
    options: { validateTimeZone?: boolean } = {},
  ): Promise<SectionContext> {
    const section = await store.club_sections.findUnique({
      where: { club_section_id: clubSectionId },
      select: {
        club_section_id: true,
        club_type_id: true,
        active: true,
        main_club_id: true,
        clubs: {
          select: {
            local_field_id: true,
            local_fields: { select: { timezone: true } },
            churches: { select: { districlub_type_id: true } },
          },
        },
      },
    });
    if (
      !section?.active ||
      !section.clubs?.local_field_id ||
      section.main_club_id === null
    ) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_REQUEST_SECTION_NOT_FOUND,
      );
    }
    const year = await store.ecclesiastical_years.findUnique({
      where: { year_id: ecclesiasticalYearId },
      select: { start_date: true, end_date: true, active: true },
    });
    if (!year) {
      throw new AppNotFoundException(
        ErrorCode.INVESTITURE_REQUEST_SECTION_NOT_FOUND,
      );
    }
    const yearStart = civilDate(year.start_date);
    const yearEnd = civilDate(year.end_date);
    const stored = await store.local_field_investiture_windows.findUnique({
      where: {
        local_field_id_ecclesiastical_year_id: {
          local_field_id: section.clubs.local_field_id,
          ecclesiastical_year_id: ecclesiasticalYearId,
        },
      },
      select: { start_date: true, end_date: true },
    });
    const explicit = stored
      ? explicitWindow(
          civilDate(stored.start_date),
          civilDate(stored.end_date),
          yearStart,
          yearEnd,
        )
      : null;
    return {
      clubSectionId,
      clubTypeId: section.club_type_id,
      mainClubId: section.main_club_id,
      localFieldId: section.clubs.local_field_id,
      timeZone:
        options.validateTimeZone === false
          ? this.readTimeZone(section.clubs.local_fields?.timezone)
          : normalizeInvestitureTimeZone(section.clubs.local_fields?.timezone),
      yearId: ecclesiasticalYearId,
      yearStart,
      yearEnd,
      yearActive: year.active,
      window: explicit ?? defaultInvestitureWindow(yearStart, yearEnd),
      districtId: section.clubs.churches?.districlub_type_id ?? null,
    };
  }

  private readTimeZone(value: string | null | undefined): string {
    try {
      return normalizeInvestitureTimeZone(value);
    } catch {
      return INVESTITURE_REQUEST_TIME_ZONE_FALLBACK;
    }
  }

  private assertMarker(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
    ecclesiasticalYearId: number,
  ): void {
    if (!this.sectionRole(authorization, clubSectionId, ecclesiasticalYearId)) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
  }

  private assertSectionBoard(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
  ): void {
    const allowed = (authorization.grants?.club_assignments ?? []).some(
      (grant) => {
        if (!grant.operational || grant.status !== 'active') {
          return false;
        }
        if (grant.section.club_section_id !== clubSectionId) {
          return false;
        }
        return MARK_ROLES.has(grant.role_name.trim().toLowerCase());
      },
    );
    if (!allowed) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
  }

  private sectionRole(
    authorization: AuthorizationSnapshot,
    clubSectionId: number,
    ecclesiasticalYearId: number,
  ): string | null {
    for (const grant of authorization.grants?.club_assignments ?? []) {
      if (!grant.operational || grant.status !== 'active') {
        continue;
      }
      if (grant.section.club_section_id !== clubSectionId) {
        continue;
      }
      if (grant.ecclesiastical_year_id !== ecclesiasticalYearId) {
        continue;
      }
      const role = grant.role_name.trim().toLowerCase();
      if (MARK_ROLES.has(role)) {
        return role;
      }
    }
    return null;
  }

  private isSuperAdmin(authorization: AuthorizationSnapshot): boolean {
    return (authorization.grants?.global_roles ?? []).some(
      (grant) => grant.role_name.trim().toLowerCase() === 'super-admin',
    );
  }

  private assertSelection(
    enrollmentIds: number[],
    investitureDate: string,
  ): void {
    if (enrollmentIds.length === 0) {
      throw new AppBadRequestException(ErrorCode.INVESTITURE_REQUEST_EMPTY);
    }
    this.assertCivilDate(investitureDate);
  }

  private assertCivilDate(value: string): void {
    if (!isCivilDate(value)) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_REQUEST_DATE_INVALID,
      );
    }
  }

  private isYearOpen(context: SectionContext, now: Date): boolean {
    const day = localDay(now, context.timeZone);
    return !(
      investitureRequestYearEnded({
        active: context.yearActive,
        endDate: context.yearEnd,
        now,
        timeZone: context.timeZone,
      }) || day < context.yearStart
    );
  }

  private assertYearOpen(context: SectionContext, now: Date): void {
    if (!this.isYearOpen(context, now)) {
      throw new AppConflictException(ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED);
    }
  }

  private windowOpenToday(context: SectionContext, now: Date): boolean {
    return investitureWindowAllowsOperation({
      now,
      timeZone: context.timeZone,
      yearStart: context.yearStart,
      yearEnd: context.yearEnd,
      yearActive: context.yearActive,
      windowStart: context.window?.start_date ?? null,
      windowEnd: context.window?.end_date ?? null,
    });
  }

  private assertTodayAllowsPresentation(
    context: SectionContext,
    now: Date,
  ): void {
    if (!this.windowOpenToday(context, now)) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_WINDOW_CLOSED,
      );
    }
  }

  private assertDateInside(
    context: SectionContext,
    investitureDate: string,
  ): void {
    if (
      investitureDate < context.yearStart ||
      investitureDate > context.yearEnd
    ) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_YEAR,
      );
    }
    if (
      !context.window ||
      investitureDate < context.window.start_date ||
      investitureDate > context.window.end_date
    ) {
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_REQUEST_DATE_OUTSIDE_WINDOW,
      );
    }
  }

  private async lockSection(
    store: Prisma.TransactionClient,
    clubSectionId: number,
    ecclesiasticalYearId: number,
  ): Promise<void> {
    await lockInvestitureAuthorizationSection(
      store,
      clubSectionId,
      ecclesiasticalYearId,
    );
  }

  private async lockUsers(
    store: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await lockInvestitureAuthorizationUser(store, userId);
    }
  }

  private async lockEnrollments(
    store: Prisma.TransactionClient,
    enrollmentIds: number[],
  ): Promise<void> {
    for (const enrollmentId of [...new Set(enrollmentIds)].sort(
      (left, right) => left - right,
    )) {
      await lockInvestitureAuthorizationEnrollment(store, enrollmentId);
    }
  }

  private async requireRequest(requestId: string): Promise<{
    request_id: string;
    club_section_id: number;
    ecclesiastical_year_id: number;
  }> {
    const request =
      await this.prisma.investiture_authorization_requests.findUnique({
        where: { request_id: requestId },
        select: {
          request_id: true,
          club_section_id: true,
          ecclesiastical_year_id: true,
        },
      });
    if (!request) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    return request;
  }

  private async readRequest(
    store: Prisma.TransactionClient | PrismaService,
    requestId: string,
    audience: 'board' | 'authorizer' = 'board',
  ): Promise<InvestitureRequestView> {
    const request = await store.investiture_authorization_requests.findUnique({
      where: { request_id: requestId },
      select: {
        request_id: true,
        club_section_id: true,
        ecclesiastical_year_id: true,
        created_at: true,
        people: {
          orderBy: { person_id: 'asc' },
        },
      },
    });
    if (!request) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    const labels = await this.requestLabels(store, [request]);
    return this.requestView(request, labels, audience);
  }

  /** Same shape as `readRequest`, with one lookup per table for all requests. */
  private async readRequests(
    store: Prisma.TransactionClient | PrismaService,
    requestIds: string[],
    audience: 'board' | 'authorizer',
  ): Promise<InvestitureRequestView[]> {
    if (requestIds.length === 0) {
      return [];
    }
    const requests = await store.investiture_authorization_requests.findMany({
      where: { request_id: { in: requestIds } },
      select: {
        request_id: true,
        club_section_id: true,
        ecclesiastical_year_id: true,
        created_at: true,
        people: {
          orderBy: { person_id: 'asc' },
        },
      },
      orderBy: { request_id: 'asc' },
    });
    const labels = await this.requestLabels(store, requests);
    return requests.map((request) =>
      this.requestView(request, labels, audience),
    );
  }

  private requestView(
    request: {
      request_id: string;
      club_section_id: number;
      ecclesiastical_year_id: number;
      created_at: Date;
      people: Parameters<
        InvestitureAuthorizationRequestService['personView']
      >[0][];
    },
    labels: RequestLabels,
    audience: 'board' | 'authorizer',
  ): InvestitureRequestView {
    const section = labels.sections.get(request.club_section_id);
    const personLabels = {
      users: labels.users,
      classes: labels.classes,
      sectionName: section?.sectionName ?? null,
    };
    const pendingDates = request.people
      .filter((person) => person.status === 'PENDING')
      .map((person) => civilDate(person.investiture_date))
      .sort();
    return {
      request_id: request.request_id,
      club_section_id: request.club_section_id,
      ecclesiastical_year_id: request.ecclesiastical_year_id,
      club_id: section?.clubId ?? null,
      club_name: section?.clubName ?? null,
      section_name: section?.sectionName ?? null,
      district_name: section?.districtName ?? null,
      pending_count: pendingDates.length,
      earliest_investiture_date: pendingDates[0] ?? null,
      created_at: request.created_at.toISOString(),
      people: request.people.map((person) =>
        this.personView(person, audience, personLabels),
      ),
    };
  }

  private async requestLabels(
    store: Prisma.TransactionClient | PrismaService,
    requests: Array<{
      club_section_id: number;
      people: Array<{
        user_id: string;
        class_id: number;
        resolved_by_id?: string | null;
      }>;
    }>,
  ): Promise<RequestLabels> {
    const users = new Map<string, string>();
    const classes = new Map<number, string>();
    const people = requests.flatMap((request) => request.people);
    const userIds = [
      ...new Set(
        people.flatMap((person) =>
          person.resolved_by_id
            ? [person.user_id, person.resolved_by_id]
            : [person.user_id],
        ),
      ),
    ];
    const usersTable = (
      store as {
        users?: {
          findMany?: (args: unknown) => Promise<
            Array<{
              user_id: string;
              name?: string | null;
              paternal_last_name?: string | null;
              maternal_last_name?: string | null;
            }>
          >;
        };
      }
    ).users;
    if (usersTable?.findMany && userIds.length > 0) {
      const rows = await usersTable.findMany({
        where: { user_id: { in: userIds } },
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
        },
      });
      for (const row of rows) {
        users.set(row.user_id, displayName(row));
      }
    }
    const classesTable = (
      store as {
        classes?: {
          findMany?: (
            args: unknown,
          ) => Promise<Array<{ class_id: number; name?: string | null }>>;
        };
      }
    ).classes;
    const classIds = [...new Set(people.map((person) => person.class_id))];
    if (classesTable?.findMany && classIds.length > 0) {
      const rows = await classesTable.findMany({
        where: { class_id: { in: classIds } },
        select: { class_id: true, name: true },
      });
      for (const row of rows) {
        if (row.name) {
          classes.set(row.class_id, row.name);
        }
      }
    }
    const sections = new Map<number, SectionLabel>();
    const sectionIds = [
      ...new Set(requests.map((request) => request.club_section_id)),
    ];
    const sectionRows = await store.club_sections.findMany({
      where: { club_section_id: { in: sectionIds } },
      select: {
        club_section_id: true,
        club_types: { select: { name: true } },
        clubs: {
          select: {
            club_id: true,
            name: true,
            churches: { select: { districts: { select: { name: true } } } },
          },
        },
      },
    });
    for (const row of sectionRows) {
      sections.set(row.club_section_id, {
        sectionName: row.club_types?.name ?? null,
        clubId: row.clubs?.club_id ?? null,
        clubName: row.clubs?.name ?? null,
        districtName: row.clubs?.churches?.districts?.name ?? null,
      });
    }
    return { users, classes, sections };
  }

  private personView(
    person: {
      person_id: string;
      user_id: string;
      class_id: number;
      enrollment_id: number;
      investiture_date: Date;
      status: PersonStatus;
      resolution_code?: string | null;
      authorization_comment?: string | null;
      rejection_reason?: string | null;
      system_reason?: string | null;
      resolved_by_id?: string | null;
      date_changed_by_id?: string | null;
      date_changed_at?: Date | null;
    },
    audience: 'board' | 'authorizer' = 'board',
    labels?: {
      users: Map<string, string>;
      classes: Map<number, string>;
      sectionName: string | null;
    },
  ): InvestitureRequestPersonView {
    const changedAt = person.date_changed_at;
    return {
      person_id: person.person_id,
      user_id: person.user_id,
      user_name: labels?.users.get(person.user_id) ?? null,
      class_id: person.class_id,
      class_name: labels?.classes.get(person.class_id) ?? null,
      section_name: labels?.sectionName ?? null,
      enrollment_id: person.enrollment_id,
      investiture_date: civilDate(person.investiture_date),
      status: person.status,
      can_authorize: person.status === 'PENDING',
      authorization_comment: person.authorization_comment ?? null,
      rejection_reason:
        audience === 'authorizer' ? null : (person.rejection_reason ?? null),
      system_reason: person.system_reason ?? null,
      resolution_code: person.resolution_code ?? null,
      resolved_by_id: person.resolved_by_id ?? null,
      resolved_by_name:
        person.status === 'REJECTED_BY_SYSTEM'
          ? 'Sistema'
          : (labels?.users.get(person.resolved_by_id ?? '') ?? null),
      date_changed_by_id: person.date_changed_by_id ?? null,
      date_changed_at:
        changedAt instanceof Date ? changedAt.toISOString() : null,
    };
  }

  private async classNames(
    store: Prisma.TransactionClient | PrismaService,
    classIds: number[],
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    const classes = (
      store as {
        classes?: {
          findMany?: (
            args: unknown,
          ) => Promise<Array<{ class_id: number; name?: string | null }>>;
        };
      }
    ).classes;
    const unique = [...new Set(classIds)];
    if (!classes?.findMany || unique.length === 0) {
      return names;
    }
    const rows = await classes.findMany({
      where: { class_id: { in: unique } },
      select: { class_id: true, name: true },
    });
    for (const row of rows) {
      if (row.name) {
        names.set(row.class_id, row.name);
      }
    }
    return names;
  }

  private historyEntry(
    person: {
      person_id: string;
      user_id: string;
      class_id: number;
      investiture_date: Date;
      status: PersonStatus;
      authorization_comment?: string | null;
      rejection_reason?: string | null;
      system_reason?: string | null;
      classes?: { name?: string | null } | null;
      request: {
        club_section_id: number;
        ecclesiastical_year_id: number;
      };
    },
    audience: 'person' | 'section',
    className: string | null = person.classes?.name ?? null,
  ): InvestitureHistoryEntry {
    const closedYear = person.status === 'CLOSED_YEAR';
    const laterCertificate =
      person.system_reason === LATER_CERTIFICATE_ACCREDITATION_REASON;
    const historical =
      person.system_reason === HISTORICAL_CERTIFICATE_APPLIED_REASON;
    const rejected =
      person.status === 'REJECTED_BY_PERSON' ||
      person.status === 'REJECTED_BY_SYSTEM';
    const base = {
      person_id: person.person_id,
      user_id: person.user_id,
      class_id: person.class_id,
      class_name: className ?? person.classes?.name ?? null,
      club_section_id: person.request.club_section_id,
      ecclesiastical_year_id: person.request.ecclesiastical_year_id,
      investiture_date: civilDate(person.investiture_date),
    };
    if (audience === 'person') {
      const informative = laterCertificate || historical;
      return {
        ...base,
        status: rejected ? 'REJECTED' : person.status,
        person_text:
          person.status === 'PENDING'
            ? INVESTITURE_PERSON_PENDING_TEXT
            : rejected
              ? INVESTITURE_PERSON_REJECTED_TEXT
              : informative
                ? (person.system_reason ?? null)
                : null,
        ...(person.status === 'INVESTED'
          ? { authorization_comment: person.authorization_comment ?? null }
          : {}),
      };
    }
    return {
      ...base,
      status: person.status,
      rejection_reason: closedYear ? null : (person.rejection_reason ?? null),
      system_reason:
        laterCertificate ||
        (!closedYear && person.status === 'REJECTED_BY_SYSTEM')
          ? (person.system_reason ?? null)
          : closedYear
            ? null
            : (person.system_reason ?? null),
      person_text: null,
    };
  }

  private async failsRequirements(
    store: Prisma.TransactionClient,
    context: SectionContext,
    enrollment: EnrollmentRow,
  ): Promise<boolean> {
    if (enrollment.investiture_status === 'EXPIRED') {
      return true;
    }
    const result = await this.eligibility.calculateForEnrollment(
      enrollment.enrollment_id,
    );
    if (!result?.investiture_eligibility.eligible) {
      return true;
    }
    if (!enrollment.classes || !enrollment.ecclesiastical_year) {
      return true;
    }
    const elapsed = await store.ecclesiastical_years.count({
      where: {
        start_date: {
          gte: enrollment.ecclesiastical_year.start_date,
          lte: civilDateToUtc(context.yearStart),
        },
      },
    });
    return (
      elapsed < enrollment.classes.min_duration_years ||
      elapsed > enrollment.classes.max_duration_years
    );
  }

  private async assertAuthorizer(
    authorization: AuthorizationSnapshot,
    actorId: string,
    context: SectionContext,
    store: DecisionStore = this.prisma,
  ): Promise<void> {
    const allowed = await this.authorizerMatches(
      authorization,
      actorId,
      context,
      store,
    );
    if (!allowed) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
  }

  private fieldAuthorizesSection(
    authorization: AuthorizationSnapshot,
    context: SectionContext,
  ): boolean {
    const fieldId = this.fieldAuthorizerFieldId(authorization);
    return fieldId != null && fieldId === context.localFieldId;
  }

  private async authorizerMatches(
    authorization: AuthorizationSnapshot,
    actorId: string,
    context: SectionContext,
    store: DecisionStore = this.prisma,
  ): Promise<boolean> {
    if (this.fieldAuthorizesSection(authorization, context)) {
      return true;
    }
    if (!this.hasGlobalRole(authorization, 'pastor') || !context.districtId) {
      return false;
    }
    const assignment = await store.district_investiture_pastors.findFirst({
      where: {
        user_id: actorId,
        districlub_type_id: context.districtId,
        active: true,
      },
      select: { user_id: true },
    });
    if (assignment == null) {
      return false;
    }
    // BCR-6: el rol del token puede estar vencido; la cuenta y el rol vigentes
    // se comprueban con la misma regla del listado y de los correos.
    return pastorCanAuthorize(store, actorId);
  }

  private async authorizerSectionIds(
    authorization: AuthorizationSnapshot,
    actorId: string,
  ): Promise<Set<number>> {
    const fieldId = this.fieldAuthorizerFieldId(authorization);
    const districtIds = await this.pastorDistrictIds(authorization, actorId);
    if (fieldId == null && districtIds.length === 0) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
    const ids = new Set<number>();
    if (fieldId != null) {
      const rows = await this.prisma.club_sections.findMany({
        where: { active: true, clubs: { local_field_id: fieldId } },
        select: { club_section_id: true },
      });
      for (const row of rows) {
        ids.add(row.club_section_id);
      }
    }
    if (districtIds.length > 0) {
      const rows = await this.prisma.club_sections.findMany({
        where: {
          active: true,
          clubs: {
            churches: { districlub_type_id: { in: districtIds } },
          },
        },
        select: { club_section_id: true },
      });
      for (const row of rows) {
        ids.add(row.club_section_id);
      }
    }
    return ids;
  }

  private async pastorDistrictIds(
    authorization: AuthorizationSnapshot,
    actorId: string,
  ): Promise<number[]> {
    if (!this.hasGlobalRole(authorization, 'pastor')) {
      return [];
    }
    const rows = await this.prisma.district_investiture_pastors.findMany({
      where: { user_id: actorId, active: true },
      select: { districlub_type_id: true },
    });
    if (
      rows.length === 0 ||
      !(await pastorCanAuthorize(this.prisma, actorId))
    ) {
      return [];
    }
    return rows.map((row) => row.districlub_type_id);
  }

  private fieldAuthorizerFieldId(
    authorization: AuthorizationSnapshot,
  ): number | null {
    const roles = new Set(
      (authorization.grants?.global_roles ?? []).map((grant) =>
        grant.role_name.trim().toLowerCase(),
      ),
    );
    const matches = [...FIELD_AUTHORIZER_ROLES].some((role) => roles.has(role));
    if (!matches) {
      return null;
    }
    return (
      toTerritoryId(authorization.effective?.scope?.global?.local_field?.id) ??
      null
    );
  }

  private hasGlobalRole(
    authorization: AuthorizationSnapshot,
    roleName: string,
  ): boolean {
    return (authorization.grants?.global_roles ?? []).some(
      (grant) => grant.role_name.trim().toLowerCase() === roleName,
    );
  }
}

function compareNames(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left.localeCompare(right, 'es');
}

function explicitWindow(
  startDate: string,
  endDate: string,
  yearStart: string,
  yearEnd: string,
): WindowRange | null {
  if (!isCivilDate(startDate) || !isCivilDate(endDate)) {
    return null;
  }
  if (startDate > endDate) {
    return null;
  }
  if (startDate < yearStart || endDate > yearEnd) {
    return null;
  }
  return { start_date: startDate, end_date: endDate };
}

function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return civilDate(civilDateToUtc(value)) === value;
}

function civilDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function civilDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function localDay(now: Date, timeZone: string): string {
  return localCivilDay(now, timeZone);
}

function investedTarget(
  error: unknown,
): { userId: string; classId: number } | null {
  if (!(error instanceof AppConflictException)) {
    return null;
  }
  if (error.code !== ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED) {
    return null;
  }
  const namedArgs = error.getResponse().namedArgs;
  const userId = namedArgs?.userId;
  const classId = namedArgs?.classId;
  if (typeof userId !== 'string' || typeof classId !== 'number') {
    return null;
  }
  return { userId, classId };
}
