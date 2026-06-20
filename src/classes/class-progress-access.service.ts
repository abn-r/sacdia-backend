import { Injectable } from '@nestjs/common';
import {
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { PrismaService } from '../prisma/prisma.service';

const SECTION_WIDE_ROLE_NAMES = new Set([
  'director',
  'deputy-director',
  'secretary',
  'secretary-treasurer',
]);

const GLOBAL_PROGRESS_ACCESS_ROLES = [
  'super-admin',
  'admin',
  'assistant-admin',
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
];

export type ClassProgressAccessParams = {
  actorUserId: string;
  targetUserId: string;
  classId: number;
  ecclesiasticalYearId: number;
  clubSectionId?: number;
};

@Injectable()
export class ClassProgressAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationContext: AuthorizationContextService,
  ) {}

  async canAccessClassProgress(
    params: ClassProgressAccessParams,
  ): Promise<boolean> {
    return this.evaluateAccess(params);
  }

  async canAccessProgress(params: ClassProgressAccessParams): Promise<boolean> {
    return this.canAccessClassProgress(params);
  }

  async assertCanAccessClassProgress(
    params: ClassProgressAccessParams,
  ): Promise<void> {
    const allowed = await this.evaluateAccess(params);

    if (!allowed) {
      throw new AppForbiddenException(ErrorCode.GUARD_PERMISSION_DENIED);
    }
  }

  async assertCanAccessProgress(params: ClassProgressAccessParams): Promise<void> {
    return this.assertCanAccessClassProgress(params);
  }

  private async evaluateAccess(
    params: ClassProgressAccessParams,
  ): Promise<boolean> {
    if (params.actorUserId === params.targetUserId) {
      return true;
    }

    if (
      await this.authorizationContext.hasAnyGlobalRole(
        params.actorUserId,
        GLOBAL_PROGRESS_ACCESS_ROLES,
      )
    ) {
      return true;
    }

    const targetEnrollment = await this.prisma.enrollments.findFirst({
      where: {
        user_id: params.targetUserId,
        class_id: params.classId,
        ecclesiastical_year_id: params.ecclesiasticalYearId,
        active: true,
      },
      select: {
        enrollment_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        classes: {
          select: {
            club_type_id: true,
          },
        },
      },
    });

    if (!targetEnrollment) {
      return false;
    }

    const targetSectionIds = await this.resolveTargetSectionIds({
      targetUserId: params.targetUserId,
      ecclesiasticalYearId: params.ecclesiasticalYearId,
      clubTypeId: targetEnrollment.classes.club_type_id,
      clubSectionId: params.clubSectionId,
    });

    if (targetSectionIds.length === 0) {
      return false;
    }

    const counselorAssignment = await this.prisma.class_counselor_assignments.findFirst(
      {
        where: {
          user_id: params.actorUserId,
          club_section_id: { in: targetSectionIds },
          class_id: params.classId,
          ecclesiastical_year_id: params.ecclesiasticalYearId,
          active: true,
        },
        select: {
          assignment_id: true,
          club_section_id: true,
          class_id: true,
          ecclesiastical_year_id: true,
          active: true,
        },
      },
    );

    if (counselorAssignment) {
      return true;
    }

    const sectionWideAssignments = await this.prisma.club_role_assignments.findMany(
      {
        where: {
          user_id: params.actorUserId,
          club_section_id: { in: targetSectionIds },
          ecclesiastical_year_id: params.ecclesiasticalYearId,
          active: true,
          roles: {
            role_name: {
              in: Array.from(SECTION_WIDE_ROLE_NAMES),
            },
          },
        },
        include: {
          roles: {
            select: {
              role_name: true,
            },
          },
          club_sections: {
            select: {
              club_section_id: true,
              club_type_id: true,
            },
          },
        },
      },
    );

    return sectionWideAssignments.some(
      (assignment) => {
        const sectionId = assignment.club_sections?.club_section_id;

        return (
          SECTION_WIDE_ROLE_NAMES.has(
            assignment.roles?.role_name?.toLowerCase?.() ?? '',
          ) &&
          sectionId !== undefined &&
          targetSectionIds.includes(sectionId)
        );
      },
    );
  }

  private async resolveTargetSectionIds(params: {
    targetUserId: string;
    ecclesiasticalYearId: number;
    clubTypeId: number;
    clubSectionId?: number;
  }): Promise<number[]> {
    const targetMemberships = await this.prisma.club_role_assignments.findMany({
      where: {
        user_id: params.targetUserId,
        ecclesiastical_year_id: params.ecclesiasticalYearId,
        active: true,
        ...(params.clubSectionId !== undefined
          ? { club_section_id: params.clubSectionId }
          : {}),
        club_sections: {
          active: true,
          club_type_id: params.clubTypeId,
        },
      },
      select: {
        club_section_id: true,
        club_sections: {
          select: {
            club_section_id: true,
            club_type_id: true,
          },
        },
      },
    });

    return [
      ...new Set(
        targetMemberships
          .map((membership) => membership.club_section_id)
          .filter((sectionId): sectionId is number => typeof sectionId === 'number'),
      ),
    ];
  }
}
