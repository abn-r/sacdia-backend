import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AnnualMembershipPolicyService } from './annual-membership-policy.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NextClassResolver } from '../classes/next-class.resolver';
import { ClassEnrollmentPolicyService } from '../classes/class-enrollment-policy.service';
import { ClassEnrollmentWriter } from '../classes/class-enrollment-writer.service';
import {
  AppConflictException,
  AppException,
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma } from '@prisma/client';
import {
  PaginationDto,
  PaginatedResult,
  createPaginatedResult,
} from '../common/dto/pagination.dto';


export type SuggestedClass = {
  status: 'pending' | 'blocked' | 'resolved' | 'complete';
  class_id?: number;
  code?: string;
};

export interface ContinuationListItem {
  user_id: string;
  name: string;
  base_section_id: number;
  ecclesiastical_year_id: number;
  annual_status: 'not_enrolled';
  current_role: string | null;
  eligibility: 'eligible' | 'blocked';
  blocked_reason: string | null;
  suggested_class: SuggestedClass;
}

export type ContinuationOutcome =
  | 'enrolled'
  | 'path_complete'
  | 'already_enrolled'
  | 'blocked'
  | 'failed';

export interface ContinuationUserResult {
  user_id: string;
  outcome: ContinuationOutcome;
  club_section_id: number;
  ecclesiastical_year_id: number;
  enrollment_id: number | null;
  error_code: string | null;
}

export interface ContinuationResult {
  results: ContinuationUserResult[];
}

export interface EnrollResult {
  already_enrolled: boolean;
  club_section_id: number;
  ecclesiastical_year_id: number;
}

const CLASS_POLICY_BLOCKED_CODES = new Set<string>([
  ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
  ErrorCode.CLASS_PREREQUISITE_NOT_MET,
  ErrorCode.CLASS_GM_INVESTITURE_REQUIRED,
  ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR,
  ErrorCode.CLASS_NOT_FOUND,
]);

type CurrentYear = {
  year_id: number;
  start_date: Date;
  end_date?: Date;
};

type HistoricalAssignmentRow = {
  user_id: string;
  status: string | null;
  active: boolean;
  ecclesiastical_year_id: number;
  club_section_id?: number | null;
  users?: {
    name?: string | null;
    paternal_last_name?: string | null;
    maternal_last_name?: string | null;
  } | null;
  roles?: { role_name?: string | null } | null;
};

@Injectable()
export class AnnualMembershipService {
  private readonly logger = new Logger(AnnualMembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
    private readonly authorizationContextVersion: AuthorizationContextVersionService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly membershipPolicy: AnnualMembershipPolicyService,
    private readonly auditLogs: AuditLogsService,
    private readonly nextClassResolver: NextClassResolver,
    private readonly classEnrollmentPolicy: ClassEnrollmentPolicyService,
    private readonly classEnrollmentWriter: ClassEnrollmentWriter,
  ) {}

  async listContinuations(
    sectionId: number,
    pagination: PaginationDto = new PaginationDto(),
    search?: string,
  ): Promise<PaginatedResult<ContinuationListItem>> {
    const currentYear = await this.ecclesiasticalYear.getCurrentYear();
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: {
        club_section_id: true,
        main_club_id: true,
        active: true,
        club_type_id: true,
        club_types: { select: { name: true } },
      },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const notEnrolled = await this.membershipPolicy.listNotEnrolled(
      this.prisma,
      sectionId,
      currentYear.year_id,
    );

    const historical = (await this.prisma.club_role_assignments.findMany({
      where: {
        club_section_id: sectionId,
        status: { in: ['active', 'inactive', 'ended'] },
      },
      select: {
        user_id: true,
        status: true,
        active: true,
        ecclesiastical_year_id: true,
        club_section_id: true,
        users: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
        roles: { select: { role_name: true } },
      },
    })) as HistoricalAssignmentRow[];

    const destHistorical = historical.filter(
      (row) => row.club_section_id == null || row.club_section_id === sectionId,
    );

    const enrolledHere = new Set(
      destHistorical
        .filter(
          (row) =>
            row.ecclesiastical_year_id === currentYear.year_id &&
            row.status === 'active' &&
            row.roles?.role_name === 'member',
        )
        .map((row) => row.user_id),
    );

    const directorHere = new Set(
      destHistorical
        .filter(
          (row) =>
            row.ecclesiastical_year_id === currentYear.year_id &&
            row.status === 'active' &&
            row.roles?.role_name === 'director',
        )
        .map((row) => row.user_id),
    );

    const byUser = new Map<string, ContinuationListItem>();

    for (const row of notEnrolled) {
      if (enrolledHere.has(row.user_id) || directorHere.has(row.user_id)) {
        continue;
      }
      byUser.set(
        row.user_id,
        this._toListItem({
          userId: row.user_id,
          name: row.name ?? '',
          sectionId,
          yearId: currentYear.year_id,
          currentRole: this._currentRole(destHistorical, row.user_id, currentYear.year_id),
        }),
      );
    }

    const extraIds = [
      ...new Set(historical.map((row) => row.user_id)),
    ].filter(
      (userId) =>
        !byUser.has(userId) && !enrolledHere.has(userId) && !directorHere.has(userId),
    );

    for (const userId of extraIds) {
      try {
        const base = await this.membershipPolicy.resolveBase(this.prisma, userId);
        if (base.baseSectionId !== sectionId) {
          continue;
        }
      } catch {
        continue;
      }

      const hist = historical.find((row) => row.user_id === userId);
      byUser.set(
        userId,
        this._toListItem({
          userId,
          name: this._formatName(hist?.users),
          sectionId,
          yearId: currentYear.year_id,
          currentRole: this._currentRole(destHistorical, userId, currentYear.year_id),
        }),
      );
    }

    const jumpCandidates = await this._listTypeJumpCandidates({
      destSection: section,
      year: currentYear,
      enrolledHere,
      directorHere,
    });
    for (const candidate of jumpCandidates) {
      if (byUser.has(candidate.user_id)) {
        continue;
      }
      byUser.set(candidate.user_id, candidate);
    }

    let items = [...byUser.values()];
    const query = search?.trim().toLowerCase();
    if (query) {
      items = items.filter((item) => item.name.toLowerCase().includes(query));
    }

    const total = items.length;
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);
    const withSuggestions = await Promise.all(
      pageItems.map(async (item) => ({
        ...item,
        suggested_class: await this._suggestedClass(
          item.user_id,
          sectionId,
          currentYear.year_id,
        ),
      })),
    );
    return createPaginatedResult(withSuggestions, total, pagination);
  }

  async continueUsers(
    sectionId: number,
    userIds: string[],
    actorUserId: string,
  ): Promise<ContinuationResult> {
    const currentYear = await this.ecclesiasticalYear.getCurrentYear();
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
      select: { club_section_id: true, main_club_id: true },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const uniqueIds = [...new Set(userIds)];
    const results: ContinuationUserResult[] = [];

    for (const userId of uniqueIds) {
      results.push(
        await this._enrollOneUser({
          userId,
          sectionId,
          clubId: section.main_club_id,
          year: currentYear,
          actorUserId,
        }),
      );
    }

    return { results };
  }

  async writeTypeJumpEnrollment(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      destSectionId: number;
      year: CurrentYear;
    },
  ): Promise<'enrolled' | 'already_enrolled' | 'skipped'> {
    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });
    if (!memberRole) {
      return 'skipped';
    }

    const existingMember = await tx.club_role_assignments.findFirst({
      where: {
        user_id: params.userId,
        role_id: memberRole.role_id,
        club_section_id: params.destSectionId,
        ecclesiastical_year_id: params.year.year_id,
        status: { in: ['active', 'inactive'] },
      },
      select: { assignment_id: true, status: true },
    });
    if (existingMember?.status === 'active') {
      return 'already_enrolled';
    }

    const directorRole = await tx.roles.findFirst({
      where: { role_name: 'director', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });
    if (directorRole) {
      const destDirector = await tx.club_role_assignments.findFirst({
        where: {
          user_id: params.userId,
          role_id: directorRole.role_id,
          club_section_id: params.destSectionId,
          ecclesiastical_year_id: params.year.year_id,
          status: 'active',
        },
        select: { assignment_id: true },
      });
      if (destDirector) {
        return 'already_enrolled';
      }
    }

    const accepted = await this._acceptTypeJump(tx, {
      userId: params.userId,
      sectionId: params.destSectionId,
      year: params.year,
    });
    if (!accepted) {
      return 'skipped';
    }

    if (existingMember?.status === 'inactive') {
      await tx.club_role_assignments.update({
        where: { assignment_id: existingMember.assignment_id },
        data: { status: 'active' },
      });
    } else {
      await tx.club_role_assignments.create({
        data: {
          user_id: params.userId,
          role_id: memberRole.role_id,
          club_section_id: params.destSectionId,
          ecclesiastical_year_id: params.year.year_id,
          start_date: params.year.start_date,
          active: true,
          status: 'active',
        },
        select: { assignment_id: true },
      });
    }

    await this.authorizationContextVersion.bumpMany(tx, [params.userId]);
    await this._applyClassInTransaction(tx, {
      userId: params.userId,
      sectionId: params.destSectionId,
      year: params.year,
    });
    return 'enrolled';
  }

  async annualEnroll(
    _userId: string,
    _clubSectionId?: number,
  ): Promise<EnrollResult> {
    throw new AppForbiddenException(ErrorCode.ANNUAL_ENROLL_REQUIRES_DIRECTIVE);
  }

  private async _enrollOneUser(params: {
    userId: string;
    sectionId: number;
    clubId: number | null;
    year: CurrentYear;
    actorUserId: string;
  }): Promise<ContinuationUserResult> {
    const baseResult: ContinuationUserResult = {
      user_id: params.userId,
      outcome: 'failed',
      club_section_id: params.sectionId,
      ecclesiastical_year_id: params.year.year_id,
      enrollment_id: null,
      error_code: null,
    };

    try {
      const result = await this.prisma.$transaction((tx) =>
        this._enrollInTransaction(tx, params),
      );

      if (result.outcome === 'enrolled' || result.outcome === 'path_complete') {
        await this.authorizationContext.invalidateUserAuthorizationCache(params.userId);
        await this.auditLogs.recordEvent({
          entity_type: 'annual_membership',
          entity_id: params.userId,
          action: 'ANNUAL_ENROLL',
          actor_user_id: params.actorUserId,
          club_id: params.clubId ?? undefined,
          summary: `Inscripción anual en sección ${params.sectionId}`,
          changes: {
            club_section_id: params.sectionId,
            ecclesiastical_year_id: params.year.year_id,
            outcome: result.outcome,
            enrollment_id: result.enrollment_id,
          },
        });
      }

      return result;
    } catch (error) {
      if (
        error instanceof AppException &&
        CLASS_POLICY_BLOCKED_CODES.has(error.code)
      ) {
        return {
          ...baseResult,
          outcome: 'blocked',
          error_code: error.code,
        };
      }
      this.logger.error(
        `AnnualMembership: failed to enroll user ${params.userId} in section ${params.sectionId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        ...baseResult,
        outcome: 'failed',
        error_code:
          error instanceof AppException
            ? error.code
            : ErrorCode.INTERNAL_SERVER_ERROR,
      };
    }
  }

  private async _enrollInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      sectionId: number;
      year: CurrentYear;
    },
  ): Promise<ContinuationUserResult> {
    const memberRole = await tx.roles.findFirst({
      where: { role_name: 'member', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    if (!memberRole) {
      throw new AppNotFoundException(ErrorCode.POST_REG_MEMBER_ROLE_NOT_FOUND);
    }

    const directorRole = await tx.roles.findFirst({
      where: { role_name: 'director', role_category: 'CLUB', active: true },
      select: { role_id: true },
    });

    const existingMember = await tx.club_role_assignments.findFirst({
      where: {
        user_id: params.userId,
        role_id: memberRole.role_id,
        club_section_id: params.sectionId,
        ecclesiastical_year_id: params.year.year_id,
        status: { in: ['active', 'inactive'] },
      },
      select: { assignment_id: true, status: true, role_id: true },
    });

    if (existingMember?.status === 'active') {
      return this._outcome(params, 'already_enrolled');
    }

    if (existingMember?.status === 'inactive') {
      await tx.club_role_assignments.update({
        where: { assignment_id: existingMember.assignment_id },
        data: { status: 'active' },
      });
      await this.authorizationContextVersion.bumpMany(tx, [params.userId]);
      return this._afterClass(tx, params);
    }

    if (directorRole) {
      const destDirector = await tx.club_role_assignments.findFirst({
        where: {
          user_id: params.userId,
          role_id: directorRole.role_id,
          club_section_id: params.sectionId,
          ecclesiastical_year_id: params.year.year_id,
          status: 'active',
        },
        select: { assignment_id: true, status: true },
      });

      if (destDirector) {
        return this._outcome(params, 'already_enrolled');
      }
    }

    const stalledMembership = await tx.club_role_assignments.findFirst({
      where: {
        user_id: params.userId,
        club_section_id: params.sectionId,
        ecclesiastical_year_id: params.year.year_id,
        status: { in: ['pending', 'rejected'] },
      },
      select: { assignment_id: true, status: true },
    });

    if (stalledMembership) {
      return this._outcome(params, 'blocked', ErrorCode.MR_ALREADY_PENDING);
    }

    let base: { baseSectionId: number } | null = null;
    let baseError: ErrorCode | null = null;
    try {
      base = await this.membershipPolicy.resolveBase(tx, params.userId);
    } catch (error) {
      baseError =
        error instanceof AppException
          ? error.code
          : ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED;
    }

    if (base?.baseSectionId === params.sectionId) {
      const ensured = await this.membershipPolicy.ensureNotEnrolled(
        tx,
        params.userId,
        params.sectionId,
        params.year,
      );

      if (!ensured.assignment_id) {
        return this._outcome(params, 'already_enrolled');
      }

      await tx.club_role_assignments.update({
        where: { assignment_id: ensured.assignment_id },
        data: { status: 'active' },
      });
    } else {
      const acceptedJump = await this._acceptTypeJump(tx, params);
      if (!acceptedJump) {
        return this._outcome(
          params,
          'blocked',
          baseError ?? ErrorCode.ANNUAL_MEMBERSHIP_BASE_UNRESOLVED,
        );
      }

      await tx.club_role_assignments.create({
        data: {
          user_id: params.userId,
          role_id: memberRole.role_id,
          club_section_id: params.sectionId,
          ecclesiastical_year_id: params.year.year_id,
          start_date: params.year.start_date,
          active: true,
          status: 'active',
        },
        select: { assignment_id: true },
      });
    }

    await this.authorizationContextVersion.bumpMany(tx, [params.userId]);
    return this._afterClass(tx, params);
  }

  private async _afterClass(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      sectionId: number;
      year: CurrentYear;
    },
  ): Promise<ContinuationUserResult> {
    const enrollmentId = await this._applyClassInTransaction(tx, params);
    if (enrollmentId == null) {
      return this._outcome(params, 'path_complete');
    }
    return this._outcome(params, 'enrolled', null, enrollmentId);
  }

  private originTypeNameForDest(destTypeName: string | null | undefined): string | null {
    if (destTypeName === 'Conquistadores') {
      return 'Aventureros';
    }
    if (destTypeName === 'Guías Mayores') {
      return 'Conquistadores';
    }
    return null;
  }

  private async _listTypeJumpCandidates(params: {
    destSection: {
      club_section_id: number;
      main_club_id: number | null;
      club_types?: { name: string } | null;
    };
    year: CurrentYear;
    enrolledHere: Set<string>;
    directorHere: Set<string>;
  }): Promise<ContinuationListItem[]> {
    const originName = this.originTypeNameForDest(params.destSection.club_types?.name);
    if (!originName || params.destSection.main_club_id == null) {
      return [];
    }

    const originType = await this.prisma.club_types.findFirst({
      where: { name: originName },
      select: { club_type_id: true },
    });
    if (!originType) {
      return [];
    }

    const originSection = await this.prisma.club_sections.findFirst({
      where: {
        main_club_id: params.destSection.main_club_id,
        club_type_id: originType.club_type_id,
        active: true,
      },
      select: { club_section_id: true },
    });
    if (!originSection) {
      return [];
    }

    const lastClass = await this.prisma.classes.findFirst({
      where: { club_type_id: originType.club_type_id, active: true },
      orderBy: { display_order: 'desc' },
      select: { class_id: true },
    });
    if (!lastClass) {
      return [];
    }

    const graduates = await this.prisma.enrollments.findMany({
      where: {
        class_id: lastClass.class_id,
        cross_type_enrollment: false,
        ecclesiastical_year: { end_date: { lt: params.year.start_date } },
      },
      select: {
        user_id: true,
        users: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      distinct: ['user_id'],
    });

    const items: ContinuationListItem[] = [];
    for (const graduate of graduates) {
      if (
        params.enrolledHere.has(graduate.user_id) ||
        params.directorHere.has(graduate.user_id)
      ) {
        continue;
      }

      const decision = await this.nextClassResolver.resolve(
        graduate.user_id,
        originSection.club_section_id,
        params.year.year_id,
      );
      if (
        decision.kind !== 'next_class' ||
        decision.crossed_type !== true ||
        decision.club_section_id !== params.destSection.club_section_id
      ) {
        continue;
      }

      items.push(
        this._toListItem({
          userId: graduate.user_id,
          name: this._formatName(graduate.users),
          sectionId: params.destSection.club_section_id,
          yearId: params.year.year_id,
          currentRole: null,
        }),
      );
    }

    return items;
  }

  private async _acceptTypeJump(
    tx: Prisma.TransactionClient,
    params: { userId: string; sectionId: number; year: CurrentYear },
  ): Promise<boolean> {
    const dest = await tx.club_sections.findUnique({
      where: { club_section_id: params.sectionId },
      select: {
        club_section_id: true,
        main_club_id: true,
        club_types: { select: { name: true } },
      },
    });
    const originName = this.originTypeNameForDest(dest?.club_types?.name);
    if (!originName || dest?.main_club_id == null) {
      return false;
    }

    const originType = await tx.club_types.findFirst({
      where: { name: originName },
      select: { club_type_id: true },
    });
    if (!originType) {
      return false;
    }

    const originSection = await tx.club_sections.findFirst({
      where: {
        main_club_id: dest.main_club_id,
        club_type_id: originType.club_type_id,
        active: true,
      },
      select: { club_section_id: true },
    });
    if (!originSection) {
      return false;
    }

    const decision = await this.nextClassResolver.resolve(
      params.userId,
      originSection.club_section_id,
      params.year.year_id,
    );
    return (
      decision.kind === 'next_class' &&
      decision.crossed_type === true &&
      decision.club_section_id === params.sectionId
    );
  }

  private async _applyClassInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      sectionId: number;
      year: CurrentYear;
    },
  ): Promise<number | null> {
    const decision = await this.nextClassResolver.resolve(
      params.userId,
      params.sectionId,
      params.year.year_id,
    );

    if (decision.kind === 'journey_complete') {
      return null;
    }

    if (decision.kind !== 'next_class') {
      if (decision.kind === 'policy_blocked') {
        throw new AppForbiddenException(decision.code);
      }
      throw new AppConflictException(decision.code);
    }

    if (decision.club_section_id !== params.sectionId) {
      throw new AppConflictException(ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED);
    }

    const policy = await this.classEnrollmentPolicy.evaluate(tx, {
      userId: params.userId,
      classId: decision.class_id,
      year: params.year,
      mode: 'annual',
    });

    if (policy.kind === 'policy_blocked') {
      throw new AppForbiddenException(policy.code);
    }
    if (policy.kind === 'configuration_error') {
      throw new AppConflictException(policy.code);
    }

    const written = await this.classEnrollmentWriter.upsert(tx, {
      userId: params.userId,
      classId: decision.class_id,
      ecclesiasticalYearId: params.year.year_id,
      crossType: false,
      ifExists: 'return',
    });
    return written.enrollment_id;
  }

  private async _suggestedClass(
    userId: string,
    sectionId: number,
    yearId: number,
  ): Promise<SuggestedClass> {
    try {
      const decision = await this.nextClassResolver.resolve(
        userId,
        sectionId,
        yearId,
      );
      if (decision.kind === 'next_class') {
        return { status: 'resolved', class_id: decision.class_id };
      }
      if (decision.kind === 'journey_complete') {
        return { status: 'complete' };
      }
      return { status: 'blocked', code: decision.code };
    } catch {
      return { status: 'pending' };
    }
  }

  private _outcome(
    params: { userId: string; sectionId: number; year: { year_id: number } },
    outcome: ContinuationOutcome,
    errorCode: string | null = null,
    enrollmentId: number | null = null,
  ): ContinuationUserResult {
    return {
      user_id: params.userId,
      outcome,
      club_section_id: params.sectionId,
      ecclesiastical_year_id: params.year.year_id,
      enrollment_id: enrollmentId,
      error_code: errorCode,
    };
  }

  private _toListItem(params: {
    userId: string;
    name: string;
    sectionId: number;
    yearId: number;
    currentRole: string | null;
  }): ContinuationListItem {
    return {
      user_id: params.userId,
      name: params.name,
      base_section_id: params.sectionId,
      ecclesiastical_year_id: params.yearId,
      annual_status: 'not_enrolled',
      current_role: params.currentRole,
      eligibility: 'eligible',
      blocked_reason: null,
      suggested_class: { status: 'pending' },
    };
  }

  private _currentRole(
    rows: HistoricalAssignmentRow[],
    userId: string,
    yearId: number,
  ): string | null {
    const operational = rows.find(
      (row) =>
        row.user_id === userId &&
        row.ecclesiastical_year_id === yearId &&
        row.status === 'active' &&
        row.roles?.role_name &&
        row.roles.role_name !== 'member',
    );
    return operational?.roles?.role_name ?? null;
  }

  private _formatName(
    users?: HistoricalAssignmentRow['users'],
  ): string {
    return [users?.name, users?.paternal_last_name, users?.maternal_last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
  }
}
