import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AchievementsService } from '../achievements/achievements.service';
import { toTerritoryId } from '../common/authorization/actor-territory-scope';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClassRequirementEligibilityService } from '../classes/class-requirement-eligibility.service';
import {
  defaultInvestitureWindow,
  investitureWindowAllowsOperation,
} from '../classes/field-investiture-window';
import { PrismaService } from '../prisma/prisma.service';
import {
  INVESTITURE_REQUEST_SECTION_LOCK_PREFIX,
  lockInvestitureAuthorizationEnrollment,
} from './investiture-request-lock';

const MARK_ROLES = new Set(['director', 'secretary', 'secretary-treasurer']);
const FIELD_AUTHORIZER_ROLES = new Set(['director-lf', 'assistant-lf']);
const GM_TYPE_NAME = 'Guías Mayores';
const COMMENT_MAX = 500;
const REASON_MAX = 1000;

export const INVESTITURE_SYSTEM_REJECTION_TEXT =
  'Al comprobar el avance, esta persona no cubría los requisitos mínimos. Revisar sus evidencias de avance.';

export const INVESTITURE_REQUEST_USER_LOCK_PREFIX =
  'investiture-authorization-user:';

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
  class_id: number;
  enrollment_id: number;
  investiture_date: string;
  status: PersonStatus;
  can_authorize: boolean;
  authorization_comment: string | null;
  rejection_reason: string | null;
  system_reason: string | null;
  resolved_by_id: string | null;
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
  people: InvestitureRequestPersonView[];
};

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

type EnrollmentRow = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  record_kind: string;
  cross_type_enrollment: boolean;
  active: boolean;
  classes: {
    name?: string | null;
    min_duration_years: number;
    max_duration_years: number;
    club_type_id: number;
    club_types: { name: string } | null;
  } | null;
  ecclesiastical_year: { start_date: Date } | null;
};

@Injectable()
export class InvestitureAuthorizationRequestService {
  private readonly logger = new Logger(
    InvestitureAuthorizationRequestService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: ClassRequirementEligibilityService,
    private readonly achievements: AchievementsService,
  ) {}

  async present(
    authorization: AuthorizationSnapshot,
    actorId: string,
    clubSectionId: number,
    ecclesiasticalYearId: number,
    investitureDate: string,
    enrollmentIds: number[],
    now = new Date(),
  ): Promise<InvestitureRequestView> {
    this.assertMarker(authorization, clubSectionId, ecclesiasticalYearId);
    this.assertSelection(enrollmentIds, investitureDate);
    const context = await this.loadContext(clubSectionId, ecclesiasticalYearId);
    this.assertYearOpen(context, now);
    this.assertTodayAllowsPresentation(context, now);
    this.assertDateInside(context, investitureDate);
    return this.append(actorId, context, null, investitureDate, enrollmentIds);
  }

  async addPeople(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    investitureDate: string,
    enrollmentIds: number[],
    now = new Date(),
  ): Promise<InvestitureRequestView> {
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
    this.assertYearOpen(context, now);
    this.assertTodayAllowsPresentation(context, now);
    this.assertDateInside(context, investitureDate);
    return this.append(
      actorId,
      context,
      requestId,
      investitureDate,
      enrollmentIds,
    );
  }

  async remove(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    personId: string,
    now = new Date(),
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
    this.assertYearOpen(context, now);
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
    _actorId: string,
    requestId: string,
    investitureDate: string,
    personIds: string[],
    now = new Date(),
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
    this.assertYearOpen(context, now);
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
        data: { investiture_date: civilDateToUtc(investitureDate) },
      });
      return this.readRequest(tx, requestId);
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
    if (!pending) {
      return null;
    }
    return this.readRequest(this.prisma, pending.request_id);
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
        people: { some: { status: 'PENDING' } },
      },
      select: { request_id: true },
      orderBy: { request_id: 'asc' },
    });
    const views: InvestitureRequestView[] = [];
    for (const row of rows) {
      views.push(await this.readRequest(this.prisma, row.request_id));
    }
    return views;
  }

  async readForAuthorizer(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
  ): Promise<InvestitureRequestView> {
    const request = await this.requireRequest(requestId);
    const context = await this.loadContext(
      request.club_section_id,
      request.ecclesiastical_year_id,
    );
    await this.assertAuthorizer(authorization, actorId, context);
    return this.readRequest(this.prisma, requestId);
  }

  async resolve(
    authorization: AuthorizationSnapshot,
    actorId: string,
    requestId: string,
    input: InvestitureResolutionInput,
    now = new Date(),
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
    this.assertYearOpen(context, now);
    this.assertTodayAllowsPresentation(context, now);
    const rejectIds = new Set(reject.map((item) => item.person_id));
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.investiture_authorization_people.findMany({
        where: { request_id: requestId, person_id: { in: ids } },
      });
      if (rows.length !== ids.length) {
        throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
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
      const emit: Array<{
        userId: string;
        classId: number;
        className: string | null;
        clubTypeId: number | null;
      }> = [];
      for (const personId of ids) {
        const person = current.find((row) => row.person_id === personId);
        if (!person) {
          throw new AppNotFoundException(
            ErrorCode.INVESTITURE_REQUEST_NOT_FOUND,
          );
        }
        if (person.status !== 'PENDING') {
          alreadyResolved.push({
            person_id: person.person_id,
            status: person.status,
          });
          continue;
        }
        const enrollment = await this.loadEnrollment(person.enrollment_id, tx);
        const date = civilDate(person.investiture_date);
        if (
          date < context.yearStart ||
          date > context.yearEnd ||
          !context.window ||
          date < context.window.start_date ||
          date > context.window.end_date
        ) {
          blocked.push({
            person_id: person.person_id,
            code:
              date < context.yearStart || date > context.yearEnd
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
        if (enrollment.investiture_status === 'INVESTIDO') {
          const updated = await tx.investiture_authorization_people.updateMany({
            where: { person_id: person.person_id, status: 'PENDING' },
            data: {
              status: 'REMOVED',
              resolution_code: 'ALREADY_INVESTED',
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
              resolution_code: 'ALREADY_INVESTED',
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
        const failed = await this.failsRequirements(tx, context, enrollment);
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
        const updated = await tx.investiture_authorization_people.updateMany({
          where: { person_id: person.person_id, status: 'PENDING' },
          data: {
            status: 'INVESTED',
            resolution_code: 'INVESTED',
            authorization_comment: comment,
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
        await tx.enrollments.update({
          where: { enrollment_id: person.enrollment_id },
          data: {
            investiture_status: 'INVESTIDO',
            investiture_date: person.investiture_date,
          },
        });
        invested.push(
          this.personView({
            ...person,
            status: 'INVESTED',
            authorization_comment: comment,
            resolved_by_id: actorId,
          }),
        );
        emit.push({
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
      if (wrote === 0 && blocked.length > 0) {
        throw new AppBadRequestException(blocked[0].code as ErrorCode);
      }
      if (wrote === 0) {
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
      };
    });
    for (const item of outcome.emit) {
      try {
        await this.achievements.emitEvent({
          userId: item.userId,
          eventType: 'class.completed',
          payload: {
            class_id: item.classId,
            class_name: item.className,
            club_type_id: item.clubTypeId,
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo emitir class.completed para ${item.userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return outcome.view;
  }

  async closePendingByYearEnd(personId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const person = await tx.investiture_authorization_people.findUnique({
        where: { person_id: personId },
      });
      if (!person || person.status !== 'PENDING') {
        return false;
      }
      const request = await tx.investiture_authorization_requests.findUnique({
        where: { request_id: person.request_id },
        select: { club_section_id: true, ecclesiastical_year_id: true },
      });
      if (!request) {
        return false;
      }
      await this.lockSection(
        tx,
        request.club_section_id,
        request.ecclesiastical_year_id,
      );
      await this.lockUsers(tx, [person.user_id]);
      await this.lockEnrollments(tx, [person.enrollment_id]);
      const updated = await tx.investiture_authorization_people.updateMany({
        where: { person_id: personId, status: 'PENDING' },
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      });
      return updated.count === 1;
    });
  }

  private async append(
    actorId: string,
    context: SectionContext,
    requestId: string | null,
    investitureDate: string,
    enrollmentIds: number[],
  ): Promise<InvestitureRequestView> {
    const uniqueIds = [...new Set(enrollmentIds)];
    const loaded = await Promise.all(
      uniqueIds.map((enrollmentId) => this.loadEnrollment(enrollmentId)),
    );
    try {
      await this.writePeople(
        actorId,
        context,
        requestId,
        investitureDate,
        loaded,
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
    return this.readRequest(this.prisma, saved.request_id);
  }

  private async writePeople(
    actorId: string,
    context: SectionContext,
    requestId: string | null,
    investitureDate: string,
    loaded: EnrollmentRow[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockSection(tx, context.clubSectionId, context.yearId);
      await this.lockUsers(
        tx,
        loaded.map((enrollment) => enrollment.user_id),
      );
      await this.lockEnrollments(
        tx,
        loaded.map((enrollment) => enrollment.enrollment_id),
      );
      const open = await tx.investiture_authorization_people.findFirst({
        where: {
          status: 'PENDING',
          request: {
            club_section_id: context.clubSectionId,
            ecclesiastical_year_id: context.yearId,
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
              club_section_id: context.clubSectionId,
              ecclesiastical_year_id: context.yearId,
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
        const singleSlot = await this.acceptEnrollment(tx, context, enrollment);
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
    });
  }

  private async acceptEnrollment(
    store: Prisma.TransactionClient,
    context: SectionContext,
    enrollment: EnrollmentRow,
  ): Promise<boolean> {
    if (!enrollment.active || enrollment.record_kind !== 'OPERATIONAL') {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_NOT_OPERATIONAL,
      );
    }
    if (enrollment.classes?.club_type_id !== context.clubTypeId) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
      );
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
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_OUTSIDE_SECTION,
      );
    }
    if (enrollment.investiture_status === 'INVESTIDO') {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_ALREADY_INVESTED,
        {
          userId: enrollment.user_id,
          classId: enrollment.class_id,
        },
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
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_ACTIVE_EXISTS,
      );
    }
    const result = await this.eligibility.calculateForEnrollment(
      enrollment.enrollment_id,
    );
    if (!result?.investiture_eligibility.eligible) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE,
      );
    }
    if (!enrollment.classes || !enrollment.ecclesiastical_year) {
      throw new AppConflictException(
        ErrorCode.INVESTITURE_REQUEST_NOT_ELIGIBLE,
      );
    }
    if (enrollment.investiture_status === 'EXPIRED') {
      throw new AppBadRequestException(ErrorCode.INVESTITURE_DURATION_EXPIRED);
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
      throw new AppBadRequestException(
        ErrorCode.INVESTITURE_DURATION_MIN_NOT_MET,
      );
    }
    if (elapsed > enrollment.classes.max_duration_years) {
      throw new AppBadRequestException(ErrorCode.INVESTITURE_DURATION_EXPIRED);
    }
    return singleSlot;
  }

  private async hasCrossTypeHome(
    store: Prisma.TransactionClient,
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
    store: Prisma.TransactionClient,
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

  private async loadEnrollment(
    enrollmentId: number,
    store: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<EnrollmentRow> {
    const enrollment = await store.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        record_kind: true,
        cross_type_enrollment: true,
        active: true,
        classes: {
          select: {
            name: true,
            min_duration_years: true,
            max_duration_years: true,
            club_type_id: true,
            club_types: { select: { name: true } },
          },
        },
        ecclesiastical_year: { select: { start_date: true } },
      },
    });
    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    return enrollment;
  }

  private async loadContext(
    clubSectionId: number,
    ecclesiasticalYearId: number,
  ): Promise<SectionContext> {
    const section = await this.prisma.club_sections.findUnique({
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
    const year = await this.prisma.ecclesiastical_years.findUnique({
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
    const stored = await this.prisma.local_field_investiture_windows.findUnique(
      {
        where: {
          local_field_id_ecclesiastical_year_id: {
            local_field_id: section.clubs.local_field_id,
            ecclesiastical_year_id: ecclesiasticalYearId,
          },
        },
        select: { start_date: true, end_date: true },
      },
    );
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
      timeZone: section.clubs.local_fields?.timezone || 'America/Mexico_City',
      yearId: ecclesiasticalYearId,
      yearStart,
      yearEnd,
      yearActive: year.active,
      window: explicit ?? defaultInvestitureWindow(yearStart, yearEnd),
      districtId: section.clubs.churches?.districlub_type_id ?? null,
    };
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

  private assertYearOpen(context: SectionContext, now: Date): void {
    const day = localDay(now, context.timeZone);
    if (
      !context.yearActive ||
      day < context.yearStart ||
      day > context.yearEnd
    ) {
      throw new AppConflictException(ErrorCode.INVESTITURE_REQUEST_YEAR_CLOSED);
    }
  }

  private assertTodayAllowsPresentation(
    context: SectionContext,
    now: Date,
  ): void {
    if (
      !investitureWindowAllowsOperation({
        now,
        timeZone: context.timeZone,
        yearStart: context.yearStart,
        yearEnd: context.yearEnd,
        yearActive: context.yearActive,
        windowStart: context.window?.start_date ?? null,
        windowEnd: context.window?.end_date ?? null,
      })
    ) {
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
    await store.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${clubSectionId}:${ecclesiasticalYearId}`}, 0))`,
    );
  }

  private async lockUsers(
    store: Prisma.TransactionClient,
    userIds: string[],
  ): Promise<void> {
    for (const userId of [...new Set(userIds)].sort()) {
      await store.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${INVESTITURE_REQUEST_USER_LOCK_PREFIX}${userId}`}, 0))`,
      );
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
  ): Promise<InvestitureRequestView> {
    const request = await store.investiture_authorization_requests.findUnique({
      where: { request_id: requestId },
      select: {
        request_id: true,
        club_section_id: true,
        ecclesiastical_year_id: true,
        people: {
          orderBy: { person_id: 'asc' },
        },
      },
    });
    if (!request) {
      throw new AppNotFoundException(ErrorCode.INVESTITURE_REQUEST_NOT_FOUND);
    }
    return {
      request_id: request.request_id,
      club_section_id: request.club_section_id,
      ecclesiastical_year_id: request.ecclesiastical_year_id,
      people: request.people.map((person) => this.personView(person)),
    };
  }

  private personView(person: {
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
  }): InvestitureRequestPersonView {
    return {
      person_id: person.person_id,
      user_id: person.user_id,
      class_id: person.class_id,
      enrollment_id: person.enrollment_id,
      investiture_date: civilDate(person.investiture_date),
      status: person.status,
      can_authorize: person.status === 'PENDING',
      authorization_comment: person.authorization_comment ?? null,
      rejection_reason: person.rejection_reason ?? null,
      system_reason: person.system_reason ?? null,
      resolved_by_id: person.resolved_by_id ?? null,
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
  ): Promise<void> {
    const allowed = await this.authorizerMatches(
      authorization,
      actorId,
      context,
    );
    if (!allowed) {
      throw new AppForbiddenException(ErrorCode.INVESTITURE_REQUEST_FORBIDDEN);
    }
  }

  private async authorizerMatches(
    authorization: AuthorizationSnapshot,
    actorId: string,
    context: SectionContext,
  ): Promise<boolean> {
    const fieldId = this.fieldAuthorizerFieldId(authorization);
    if (fieldId != null && fieldId === context.localFieldId) {
      return true;
    }
    if (!this.hasGlobalRole(authorization, 'pastor') || !context.districtId) {
      return false;
    }
    const assignment = await this.prisma.district_investiture_pastors.findFirst(
      {
        where: {
          user_id: actorId,
          districlub_type_id: context.districtId,
          active: true,
        },
        select: { user_id: true },
      },
    );
    return assignment != null;
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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
