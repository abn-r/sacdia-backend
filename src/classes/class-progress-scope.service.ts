import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClassRequirementEligibilityService,
  type RequirementStatusCounts,
} from './class-requirement-eligibility.service';
import { ClubRole } from '../common/authorization/roles';
import {
  ADMIN_SCOPE_ROLES,
  COORDINATOR_ROLES,
} from '../common/authorization/role-sets';

const SECTION_WIDE_ROLE_NAMES = new Set([
  ClubRole.DIRECTOR,
  ClubRole.DEPUTY_DIRECTOR,
  ClubRole.SECRETARY,
  ClubRole.SECRETARY_TREASURER,
]);

export type ProgressScopeAccessLevel = 'section' | 'assigned';

export type ProgressScopeResponsible = {
  user_id: string;
  name: string;
};

export type ProgressScopeClass = {
  class_id: number;
  name: string;
  club_type_id: number;
  access_level: ProgressScopeAccessLevel;
  members_count: number;
  avg_progress: number;
  status_counts: RequirementStatusCounts;
  counselor: ProgressScopeResponsible | null;
  assistant: ProgressScopeResponsible | null;
};

type BaseProgressScopeClass = Pick<
  ProgressScopeClass,
  'class_id' | 'name' | 'club_type_id' | 'access_level'
>;

const emptyStatusCounts = (): RequirementStatusCounts => ({
  validated: 0,
  submitted: 0,
  rejected: 0,
  pending: 0,
});

const averageProgress = (values: number[]): number =>
  values.length === 0
    ? 0
    : Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

const sumStatusCounts = (
  list: RequirementStatusCounts[],
): RequirementStatusCounts => {
  const total = emptyStatusCounts();
  for (const item of list) {
    total.validated += item.validated;
    total.submitted += item.submitted;
    total.rejected += item.rejected;
    total.pending += item.pending;
  }
  return total;
};

export type ProgressScopeResult = {
  club_section_id: number;
  club_type_id: number;
  ecclesiastical_year_id: number;
  access_level: ProgressScopeAccessLevel;
  classes: ProgressScopeClass[];
};

export type ClassMemberProgress = {
  user_id: string;
  name: string;
  enrollment_id: number;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  cross_type_enrollment: boolean;
  completed_sections: number;
  total_sections: number;
  overall_progress: number;
  status_counts: RequirementStatusCounts;
};

export type ClassMembersProgressResult = {
  club_section_id: number;
  club_type_id: number;
  class_id: number;
  ecclesiastical_year_id: number;
  access_level: ProgressScopeAccessLevel;
  members: ClassMemberProgress[];
  summary: {
    avg_progress: number;
    status_counts: RequirementStatusCounts;
  };
  counselor: ProgressScopeResponsible | null;
  assistant: ProgressScopeResponsible | null;
};

export type GetProgressScopeParams = {
  actorUserId: string;
  clubId: number;
  sectionId: number;
  ecclesiasticalYearId?: number;
};

export type GetClassMembersProgressParams = GetProgressScopeParams & {
  classId: number;
};

@Injectable()
export class ClassProgressScopeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
    private readonly coordinationService: CoordinationService,
    private readonly requirementEligibility: ClassRequirementEligibilityService,
  ) {}

  async getProgressScope(
    params: GetProgressScopeParams,
  ): Promise<ProgressScopeResult> {
    const base = await this.resolveBaseScope(params);
    const enriched = await this.enrichClasses(params.clubId, base);
    return { ...base, classes: enriched };
  }

  private async resolveBaseScope(params: GetProgressScopeParams): Promise<
    Omit<ProgressScopeResult, 'classes'> & {
      classes: BaseProgressScopeClass[];
    }
  > {
    const ecclesiasticalYearId = await this.resolveEcclesiasticalYearId(
      params.ecclesiasticalYearId,
    );
    const section = await this.resolveSection(params.clubId, params.sectionId);

    const hasGlobalAccess = await this.authorizationContext.hasAnyGlobalRole(
      params.actorUserId,
      [...ADMIN_SCOPE_ROLES],
    );
    const hasCoordinatorSectionAccess =
      (await this.authorizationContext.hasAnyGlobalRole(params.actorUserId, [
        ...COORDINATOR_ROLES,
      ])) &&
      (
        await this.coordinationService.getEffectiveCoordinatorSectionIds(
          params.actorUserId,
        )
      ).includes(params.sectionId);
    const hasSectionWideAccess =
      hasGlobalAccess ||
      hasCoordinatorSectionAccess ||
      (await this.hasSectionWideAccess({
        actorUserId: params.actorUserId,
        sectionId: params.sectionId,
        ecclesiasticalYearId,
      }));

    if (hasSectionWideAccess) {
      const classes = await this.prisma.classes.findMany({
        where: {
          active: true,
          club_type_id: section.club_type_id,
        },
        select: {
          class_id: true,
          name: true,
          club_type_id: true,
        },
        orderBy: [{ display_order: 'asc' }, { class_id: 'asc' }],
      });

      return {
        club_section_id: section.club_section_id,
        club_type_id: section.club_type_id,
        ecclesiastical_year_id: ecclesiasticalYearId,
        access_level: 'section',
        classes: classes.map((row) => ({
          class_id: row.class_id,
          name: row.name,
          club_type_id: row.club_type_id,
          access_level: 'section',
        })),
      };
    }

    const assignments = await this.prisma.class_counselor_assignments.findMany({
      where: {
        user_id: params.actorUserId,
        club_section_id: params.sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
      },
      select: {
        class_id: true,
        classes: {
          select: {
            class_id: true,
            name: true,
            club_type_id: true,
            active: true,
            display_order: true,
          },
        },
      },
      orderBy: [{ created_at: 'asc' }, { class_id: 'asc' }],
    });

    const seenClassIds = new Set<number>();
    const classes = assignments
      .map((assignment) => assignment.classes)
      .filter((klass) => klass.active)
      .filter((klass) => {
        if (seenClassIds.has(klass.class_id)) {
          return false;
        }

        seenClassIds.add(klass.class_id);
        return true;
      });

    return {
      club_section_id: section.club_section_id,
      club_type_id: section.club_type_id,
      ecclesiastical_year_id: ecclesiasticalYearId,
      access_level: 'assigned',
      classes: classes.map((row) => ({
        class_id: row.class_id,
        name: row.name,
        club_type_id: row.club_type_id,
        access_level: 'assigned',
      })),
    };
  }

  async getClassMembersProgress(
    params: GetClassMembersProgressParams,
  ): Promise<ClassMembersProgressResult> {
    const scope = await this.resolveBaseScope({
      actorUserId: params.actorUserId,
      clubId: params.clubId,
      sectionId: params.sectionId,
      ecclesiasticalYearId: params.ecclesiasticalYearId,
    });

    const accessibleClass = scope.classes.find(
      (klass) => klass.class_id === params.classId,
    );

    if (!accessibleClass) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }

    const enrollments = await this.prisma.enrollments.findMany({
      where: this.buildEnrollmentWhere(params.classId, scope, params.clubId),
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
        cross_type_enrollment: true,
        users: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: [{ users: { name: 'asc' } }, { user_id: 'asc' }],
    });

    const responsibles = await this.loadResponsibles(
      [params.classId],
      scope.club_section_id,
      scope.ecclesiastical_year_id,
    );
    const responsible = responsibles.get(params.classId);

    if (enrollments.length === 0) {
      return {
        club_section_id: scope.club_section_id,
        club_type_id: scope.club_type_id,
        class_id: params.classId,
        ecclesiastical_year_id: scope.ecclesiastical_year_id,
        access_level: scope.access_level,
        members: [],
        summary: { avg_progress: 0, status_counts: emptyStatusCounts() },
        counselor: responsible?.counselor ?? null,
        assistant: responsible?.assistant ?? null,
      };
    }

    const eligibilityByEnrollment =
      await this.requirementEligibility.calculateForEnrollments(
        enrollments.map((enrollment) => enrollment.enrollment_id),
      );
    const summaries = enrollments.map((enrollment) => {
      const eligibility = eligibilityByEnrollment.get(enrollment.enrollment_id);
      return {
        enrollment_id: enrollment.enrollment_id,
        completed: eligibility?.investiture_progress.completed ?? 0,
        total: eligibility?.investiture_progress.total ?? 0,
        overall: eligibility?.overall_progress ?? 0,
        statusCounts: eligibility?.status_counts ?? emptyStatusCounts(),
      };
    });
    const summaryByEnrollment = new Map(
      summaries.map((summary) => [summary.enrollment_id, summary]),
    );

    return {
      club_section_id: scope.club_section_id,
      club_type_id: scope.club_type_id,
      class_id: params.classId,
      ecclesiastical_year_id: scope.ecclesiastical_year_id,
      access_level: scope.access_level,
      members: enrollments.map((enrollment) => {
        const summary = summaryByEnrollment.get(enrollment.enrollment_id);
        const completed_sections = summary?.completed ?? 0;
        const total_sections = summary?.total ?? 0;
        const overall_progress = summary?.overall ?? 0;

        return {
          user_id: enrollment.user_id,
          name: enrollment.users?.name ?? '',
          enrollment_id: enrollment.enrollment_id,
          class_id: enrollment.class_id,
          ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
          investiture_status: enrollment.investiture_status,
          cross_type_enrollment: enrollment.cross_type_enrollment,
          completed_sections,
          total_sections,
          overall_progress,
          status_counts: summary?.statusCounts ?? emptyStatusCounts(),
        };
      }),
      summary: {
        avg_progress: averageProgress(summaries.map((item) => item.overall)),
        status_counts: sumStatusCounts(summaries.map((i) => i.statusCounts)),
      },
      counselor: responsible?.counselor ?? null,
      assistant: responsible?.assistant ?? null,
    };
  }

  private buildEnrollmentWhere(
    classId: number | { in: number[] },
    scope: { club_section_id: number; ecclesiastical_year_id: number },
    clubId: number,
  ): Prisma.enrollmentsWhereInput {
    return {
      class_id: classId,
      ecclesiastical_year_id: scope.ecclesiastical_year_id,
      active: true,
      record_kind: 'OPERATIONAL',
      OR: [
        // Regular section members
        {
          users: {
            club_role_assignments: {
              some: {
                club_section_id: scope.club_section_id,
                ecclesiastical_year_id: scope.ecclesiastical_year_id,
                active: true,
                status: 'active',
              },
            },
          },
        },
        // Cross-type enrollments: GM catching up in AV/CQ in another section
        // of the same club (cross_type_enrollment=true marks these rows).
        {
          cross_type_enrollment: true,
          users: {
            club_role_assignments: {
              some: {
                ecclesiastical_year_id: scope.ecclesiastical_year_id,
                active: true,
                status: 'active',
                club_sections: { main_club_id: clubId },
              },
            },
          },
        },
      ],
    };
  }

  private async enrichClasses(
    clubId: number,
    base: Omit<ProgressScopeResult, 'classes'> & {
      classes: BaseProgressScopeClass[];
    },
  ): Promise<ProgressScopeClass[]> {
    if (base.classes.length === 0) return [];
    const classIds = base.classes.map((klass) => klass.class_id);

    const [enrollments, responsibles] = await Promise.all([
      this.prisma.enrollments.findMany({
        where: this.buildEnrollmentWhere({ in: classIds }, base, clubId),
        select: { enrollment_id: true, class_id: true },
      }),
      this.loadResponsibles(
        classIds,
        base.club_section_id,
        base.ecclesiastical_year_id,
      ),
    ]);

    const eligibilityByEnrollment =
      await this.requirementEligibility.calculateForEnrollments(
        enrollments.map((row) => row.enrollment_id),
      );

    return base.classes.map((klass) => {
      const rows = enrollments.filter((row) => row.class_id === klass.class_id);
      const results = rows.map((row) =>
        eligibilityByEnrollment.get(row.enrollment_id),
      );
      const responsible = responsibles.get(klass.class_id);
      return {
        ...klass,
        members_count: rows.length,
        avg_progress: averageProgress(
          results.map((result) => result?.overall_progress ?? 0),
        ),
        status_counts: sumStatusCounts(
          results.map((result) => result?.status_counts ?? emptyStatusCounts()),
        ),
        counselor: responsible?.counselor ?? null,
        assistant: responsible?.assistant ?? null,
      };
    });
  }

  /**
   * Primary/assistant of each class (batched). Names are read straight from
   * `users`, so they do not depend on `club_roles:read`.
   */
  private async loadResponsibles(
    classIds: number[],
    sectionId: number,
    ecclesiasticalYearId: number,
  ): Promise<
    Map<
      number,
      {
        counselor: ProgressScopeResponsible | null;
        assistant: ProgressScopeResponsible | null;
      }
    >
  > {
    const rows = await this.prisma.class_counselor_assignments.findMany({
      where: {
        class_id: { in: classIds },
        club_section_id: sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
        responsibility_type: { in: ['primary', 'assistant'] },
      },
      select: {
        class_id: true,
        user_id: true,
        responsibility_type: true,
        users: {
          select: {
            name: true,
            paternal_last_name: true,
            maternal_last_name: true,
          },
        },
      },
      orderBy: [{ created_at: 'asc' }, { assignment_id: 'asc' }],
    });

    const result = new Map<
      number,
      {
        counselor: ProgressScopeResponsible | null;
        assistant: ProgressScopeResponsible | null;
      }
    >();
    for (const row of rows) {
      const entry = result.get(row.class_id) ?? {
        counselor: null,
        assistant: null,
      };
      const person: ProgressScopeResponsible = {
        user_id: row.user_id,
        name: [
          row.users?.name,
          row.users?.paternal_last_name,
          row.users?.maternal_last_name,
        ]
          .filter((part): part is string => Boolean(part?.trim()))
          .join(' '),
      };
      if (row.responsibility_type === 'primary' && !entry.counselor) {
        entry.counselor = person;
      } else if (row.responsibility_type === 'assistant' && !entry.assistant) {
        entry.assistant = person;
      }
      result.set(row.class_id, entry);
    }
    return result;
  }

  private async resolveEcclesiasticalYearId(
    ecclesiasticalYearId?: number,
  ): Promise<number> {
    if (ecclesiasticalYearId !== undefined) {
      return ecclesiasticalYearId;
    }

    const year = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: {
        year_id: true,
      },
      orderBy: { start_date: 'desc' },
    });

    if (!year) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    return year.year_id;
  }

  private async resolveSection(
    clubId: number,
    sectionId: number,
  ): Promise<{
    club_section_id: number;
    club_type_id: number;
  }> {
    const section = await this.prisma.club_sections.findFirst({
      where: {
        club_section_id: sectionId,
        main_club_id: clubId,
        active: true,
      },
      select: {
        club_section_id: true,
        club_type_id: true,
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_SECTION_NOT_FOUND,
      );
    }

    return section;
  }

  private async hasSectionWideAccess(params: {
    actorUserId: string;
    sectionId: number;
    ecclesiasticalYearId: number;
  }): Promise<boolean> {
    // Excepción documentada: la decisión se toma por (sección, año
    // eclesiástico) arbitrarios del request, no por el club activo del perfil
    // resuelto; ActorScope solo conoce `active_assignment`. Reproducirlo con
    // ActorScope cambiaría el comportamiento (y la vigencia: este predicado
    // no filtra `status`). Por eso conserva la consulta local.
    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: params.actorUserId,
        club_section_id: params.sectionId,
        ecclesiastical_year_id: params.ecclesiasticalYearId,
        active: true,
        roles: {
          role_name: {
            in: Array.from(SECTION_WIDE_ROLE_NAMES),
          },
        },
      },
      select: {
        assignment_id: true,
      },
    });

    return Boolean(assignment);
  }
}
