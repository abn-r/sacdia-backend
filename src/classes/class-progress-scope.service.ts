import { Injectable } from '@nestjs/common';
import { evidence_validation_enum } from '@prisma/client';
import {
  AppForbiddenException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { CoordinationService } from '../coordination/coordination.service';
import { PrismaService } from '../prisma/prisma.service';

const SECTION_WIDE_ROLE_NAMES = new Set([
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
]);

const GLOBAL_PROGRESS_SCOPE_ROLES = [
  'super-admin',
  'admin',
  'assistant-admin',
];

const COORDINATOR_PROGRESS_SCOPE_ROLES = [
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
];

export type ProgressScopeAccessLevel = 'section' | 'assigned';

export type ProgressScopeClass = {
  class_id: number;
  name: string;
  club_type_id: number;
  access_level: ProgressScopeAccessLevel;
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
  completed_sections: number;
  total_sections: number;
  overall_progress: number;
};

export type ClassMembersProgressResult = {
  club_section_id: number;
  club_type_id: number;
  class_id: number;
  ecclesiastical_year_id: number;
  access_level: ProgressScopeAccessLevel;
  members: ClassMemberProgress[];
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
  ) {}

  async getProgressScope(
    params: GetProgressScopeParams,
  ): Promise<ProgressScopeResult> {
    const ecclesiasticalYearId = await this.resolveEcclesiasticalYearId(
      params.ecclesiasticalYearId,
    );
    const section = await this.resolveSection(params.clubId, params.sectionId);

    const hasGlobalAccess = await this.authorizationContext.hasAnyGlobalRole(
      params.actorUserId,
      GLOBAL_PROGRESS_SCOPE_ROLES,
    );
    const hasCoordinatorSectionAccess =
      (await this.authorizationContext.hasAnyGlobalRole(
        params.actorUserId,
        COORDINATOR_PROGRESS_SCOPE_ROLES,
      )) &&
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
    const scope = await this.getProgressScope({
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
      where: {
        class_id: params.classId,
        ecclesiastical_year_id: scope.ecclesiastical_year_id,
        active: true,
        users: {
          club_role_assignments: {
            some: {
              club_section_id: scope.club_section_id,
              ecclesiastical_year_id: scope.ecclesiastical_year_id,
              active: true,
            },
          },
        },
      },
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
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

    if (enrollments.length === 0) {
      return {
        club_section_id: scope.club_section_id,
        club_type_id: scope.club_type_id,
        class_id: params.classId,
        ecclesiastical_year_id: scope.ecclesiastical_year_id,
        access_level: scope.access_level,
        members: [],
      };
    }

    const enrollmentIds = enrollments.map(
      (enrollment) => enrollment.enrollment_id,
    );
    const [completedRows, totalSections] = await Promise.all([
      this.prisma.class_section_progress.groupBy({
        by: ['enrollment_id'],
        where: {
          enrollment_id: { in: enrollmentIds },
          class_id: params.classId,
          active: true,
          OR: [
            { status: evidence_validation_enum.VALIDATED },
            { score: { gte: 70 } },
          ],
        },
        _count: { section_progress_id: true },
      }),
      this.prisma.class_sections.count({
        where: {
          active: true,
          class_modules: {
            class_id: params.classId,
            active: true,
          },
        },
      }),
    ]);

    const completedByEnrollment = new Map<number, number>();
    for (const row of completedRows) {
      if (row.enrollment_id !== null) {
        completedByEnrollment.set(
          row.enrollment_id,
          row._count.section_progress_id,
        );
      }
    }

    return {
      club_section_id: scope.club_section_id,
      club_type_id: scope.club_type_id,
      class_id: params.classId,
      ecclesiastical_year_id: scope.ecclesiastical_year_id,
      access_level: scope.access_level,
      members: enrollments.map((enrollment) => {
        const completed_sections =
          completedByEnrollment.get(enrollment.enrollment_id) ?? 0;
        const overall_progress =
          totalSections > 0
            ? Math.round((completed_sections / totalSections) * 100)
            : 0;

        return {
          user_id: enrollment.user_id,
          name: enrollment.users?.name ?? '',
          enrollment_id: enrollment.enrollment_id,
          class_id: enrollment.class_id,
          ecclesiastical_year_id: enrollment.ecclesiastical_year_id,
          investiture_status: enrollment.investiture_status,
          completed_sections,
          total_sections: totalSections,
          overall_progress,
        };
      }),
    };
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

  private async resolveSection(clubId: number, sectionId: number): Promise<{
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
      throw new AppNotFoundException(ErrorCode.CLASS_COUNSELOR_SECTION_NOT_FOUND);
    }

    return section;
  }

  private async hasSectionWideAccess(params: {
    actorUserId: string;
    sectionId: number;
    ecclesiasticalYearId: number;
  }): Promise<boolean> {
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
