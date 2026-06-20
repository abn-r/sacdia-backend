import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  CLASS_COUNSELOR_RESPONSIBILITY_TYPES,
  ClassCounselorResponsibilityType,
  CreateClassCounselorAssignmentDto,
  UpdateClassCounselorAssignmentDto,
} from './dto';

type CreateAssignmentParams = {
  clubId: number;
  sectionId: number;
  actorUserId: string;
  dto: CreateClassCounselorAssignmentDto;
};

type ListAssignmentParams = {
  clubId: number;
  sectionId: number;
  ecclesiasticalYearId?: number;
  classId?: number;
  active?: boolean;
};

const ASSIGNABLE_ROLE_NAMES = new Set(['counselor', 'secretary']);
const MAX_ASSIGNMENTS_PER_CLASS = 3;
const MAX_ASSIGNMENTS_PER_USER = 2;
const GUIDE_MAJOR_CLASS_NAME_FILTERS = [
  { name: { contains: 'Guía Mayor', mode: 'insensitive' as const } },
  { name: { contains: 'Guia Mayor', mode: 'insensitive' as const } },
];
const GUIDE_MAJOR_FINISHED_STATUSES = ['APPROVED', 'INVESTIDO'] as const;
const GUIDE_MAJOR_INELIGIBLE_ACTIVE_STATUSES = ['REJECTED', 'EXPIRED'] as const;

@Injectable()
export class ClassCounselorAssignmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAssignments(params: ListAssignmentParams) {
    const { clubId, sectionId, classId } = params;
    const ecclesiasticalYearId =
      params.ecclesiasticalYearId ??
      (await this.getActiveEcclesiasticalYearId());

    await this.assertSectionBelongsToClub(clubId, sectionId);

    return (this.prisma as any).class_counselor_assignments.findMany({
      where: {
        club_section_id: sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        ...(classId ? { class_id: classId } : {}),
        active: params.active ?? true,
      },
      select: this.assignmentSelect(),
      orderBy: [
        { classes: { display_order: 'asc' } },
        { responsibility_type: 'asc' },
        { created_at: 'asc' },
      ],
    });
  }

  async createAssignment(params: CreateAssignmentParams) {
    const { clubId, sectionId, actorUserId, dto } = params;
    const ecclesiasticalYearId =
      dto.ecclesiastical_year_id ??
      (await this.getActiveEcclesiasticalYearId());
    const responsibilityType = this.resolveResponsibilityType(
      dto.responsibility_type,
    );

    const section = await this.assertSectionBelongsToClub(clubId, sectionId);

    const targetClass = await this.prisma.classes.findFirst({
      where: {
        class_id: dto.class_id,
        active: true,
      },
      select: {
        class_id: true,
        club_type_id: true,
        active: true,
      },
    });

    if (!targetClass) {
      throw new AppNotFoundException(ErrorCode.CLASS_COUNSELOR_CLASS_NOT_FOUND);
    }

    if (targetClass.club_type_id !== section.club_type_id) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_CLASS_TYPE_MISMATCH,
      );
    }

    const roleAssignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: dto.user_id,
        club_section_id: sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
      },
      select: {
        assignment_id: true,
        roles: {
          select: {
            role_name: true,
          },
        },
      },
      orderBy: { start_date: 'desc' },
    });

    if (!roleAssignment) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_ROLE_ASSIGNMENT_REQUIRED,
      );
    }

    const roleName = roleAssignment.roles.role_name.toLowerCase();
    if (!ASSIGNABLE_ROLE_NAMES.has(roleName)) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_ROLE_NOT_ASSIGNABLE,
      );
    }

    await this.assertGuideMajorEligibility(dto.user_id);

    const existingSameAssignment = await (
      this.prisma as any
    ).class_counselor_assignments.findFirst({
      where: {
        user_id: dto.user_id,
        club_section_id: sectionId,
        class_id: dto.class_id,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
      },
      select: { assignment_id: true },
    });

    if (existingSameAssignment) {
      throw new AppConflictException(
        ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_DUPLICATE,
      );
    }

    const activeAssignmentsForClass = await (
      this.prisma as any
    ).class_counselor_assignments.count({
      where: {
        club_section_id: sectionId,
        class_id: dto.class_id,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
      },
    });

    if (activeAssignmentsForClass >= MAX_ASSIGNMENTS_PER_CLASS) {
      throw new AppConflictException(
        ErrorCode.CLASS_COUNSELOR_CLASS_LIMIT_REACHED,
      );
    }

    if (responsibilityType === 'primary') {
      const existingPrimary = await (
        this.prisma as any
      ).class_counselor_assignments.findFirst({
        where: {
          club_section_id: sectionId,
          class_id: dto.class_id,
          ecclesiastical_year_id: ecclesiasticalYearId,
          responsibility_type: 'primary',
          active: true,
        },
        select: { assignment_id: true },
      });

      if (existingPrimary) {
        throw new AppConflictException(
          ErrorCode.CLASS_COUNSELOR_PRIMARY_EXISTS,
        );
      }
    }

    const activeAssignmentsForUser = await (
      this.prisma as any
    ).class_counselor_assignments.count({
      where: {
        user_id: dto.user_id,
        club_section_id: sectionId,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
      },
    });

    if (activeAssignmentsForUser >= MAX_ASSIGNMENTS_PER_USER) {
      throw new AppConflictException(
        ErrorCode.CLASS_COUNSELOR_USER_LIMIT_REACHED,
      );
    }

    if (
      activeAssignmentsForUser >= 1 &&
      (!dto.exceptional || !dto.exception_reason?.trim())
    ) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_EXCEPTION_REQUIRED,
      );
    }

    return (this.prisma as any).class_counselor_assignments.create({
      data: {
        user_id: dto.user_id,
        club_section_id: sectionId,
        class_id: dto.class_id,
        ecclesiastical_year_id: ecclesiasticalYearId,
        club_role_assignment_id: roleAssignment.assignment_id,
        responsibility_type: responsibilityType,
        exceptional: dto.exceptional ?? false,
        exception_reason: dto.exception_reason?.trim() || null,
        assigned_by_id: actorUserId,
        start_date: dto.start_date ?? new Date(),
        end_date: dto.end_date ?? null,
        active: true,
      },
      select: this.assignmentSelect(),
    });
  }

  async updateAssignment(
    assignmentId: string,
    dto: UpdateClassCounselorAssignmentDto,
  ) {
    const existing = await (
      this.prisma as any
    ).class_counselor_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: {
        assignment_id: true,
        club_section_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        responsibility_type: true,
        exceptional: true,
        exception_reason: true,
        active: true,
      },
    });

    if (!existing) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_NOT_FOUND,
      );
    }

    const updateData: Record<string, unknown> = {
      modified_at: new Date(),
    };

    if (dto.responsibility_type !== undefined) {
      const responsibilityType = this.resolveResponsibilityType(
        dto.responsibility_type,
      );

      if (responsibilityType === 'primary' && existing.active) {
        const existingPrimary = await (
          this.prisma as any
        ).class_counselor_assignments.findFirst({
          where: {
            assignment_id: { not: assignmentId },
            club_section_id: existing.club_section_id,
            class_id: existing.class_id,
            ecclesiastical_year_id: existing.ecclesiastical_year_id,
            responsibility_type: 'primary',
            active: true,
          },
          select: { assignment_id: true },
        });

        if (existingPrimary) {
          throw new AppConflictException(
            ErrorCode.CLASS_COUNSELOR_PRIMARY_EXISTS,
          );
        }
      }

      updateData.responsibility_type = responsibilityType;
    }

    if (dto.exceptional !== undefined) {
      if (dto.exceptional) {
        const reason =
          dto.exception_reason?.trim() || existing.exception_reason?.trim();

        if (!reason) {
          throw new AppBadRequestException(
            ErrorCode.CLASS_COUNSELOR_EXCEPTION_REQUIRED,
          );
        }

        updateData.exceptional = true;
        updateData.exception_reason = reason;
      } else {
        updateData.exceptional = false;
        updateData.exception_reason = null;
      }
    } else if (dto.exception_reason !== undefined) {
      const reason = dto.exception_reason.trim();

      if (existing.exceptional && !reason) {
        throw new AppBadRequestException(
          ErrorCode.CLASS_COUNSELOR_EXCEPTION_REQUIRED,
        );
      }

      updateData.exception_reason = reason || null;
    }

    if (dto.start_date !== undefined) {
      updateData.start_date = dto.start_date;
    }

    if (dto.end_date !== undefined) {
      updateData.end_date = dto.end_date;
    }

    return (this.prisma as any).class_counselor_assignments.update({
      where: { assignment_id: assignmentId },
      data: updateData,
      select: this.assignmentSelect(),
    });
  }

  async removeAssignment(assignmentId: string) {
    const existing = await (
      this.prisma as any
    ).class_counselor_assignments.findUnique({
      where: { assignment_id: assignmentId },
      select: { assignment_id: true },
    });

    if (!existing) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_ASSIGNMENT_NOT_FOUND,
      );
    }

    return (this.prisma as any).class_counselor_assignments.update({
      where: { assignment_id: assignmentId },
      data: {
        active: false,
        end_date: new Date(),
        modified_at: new Date(),
      },
      select: this.assignmentSelect(),
    });
  }

  private async assertSectionBelongsToClub(clubId: number, sectionId: number) {
    const section = await this.prisma.club_sections.findFirst({
      where: {
        club_section_id: sectionId,
        main_club_id: clubId,
        active: true,
      },
      select: {
        club_section_id: true,
        club_type_id: true,
        main_club_id: true,
      },
    });

    if (!section) {
      throw new AppNotFoundException(
        ErrorCode.CLASS_COUNSELOR_SECTION_NOT_FOUND,
      );
    }

    return section;
  }

  private resolveResponsibilityType(
    responsibilityType?: ClassCounselorResponsibilityType,
  ): ClassCounselorResponsibilityType {
    const resolved = responsibilityType ?? 'primary';

    if (!CLASS_COUNSELOR_RESPONSIBILITY_TYPES.includes(resolved)) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_INVALID_RESPONSIBILITY_TYPE,
      );
    }

    return resolved;
  }

  private async getActiveEcclesiasticalYearId(): Promise<number> {
    const year = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
      select: { year_id: true },
      orderBy: { start_date: 'desc' },
    });

    if (!year) {
      throw new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND);
    }

    return year.year_id;
  }

  private async assertGuideMajorEligibility(userId: string): Promise<void> {
    const guideMajorEnrollment = await this.prisma.enrollments.findFirst({
      where: {
        user_id: userId,
        classes: {
          OR: GUIDE_MAJOR_CLASS_NAME_FILTERS,
        },
        OR: [
          {
            active: true,
            investiture_status: {
              notIn: [...GUIDE_MAJOR_INELIGIBLE_ACTIVE_STATUSES],
            },
          },
          {
            investiture_status: {
              in: [...GUIDE_MAJOR_FINISHED_STATUSES],
            },
          },
        ],
      },
      select: { enrollment_id: true },
    });

    if (!guideMajorEnrollment) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_COUNSELOR_GUIDE_MAJOR_REQUIRED,
      );
    }
  }

  private assignmentSelect() {
    return {
      assignment_id: true,
      user_id: true,
      club_section_id: true,
      class_id: true,
      ecclesiastical_year_id: true,
      club_role_assignment_id: true,
      responsibility_type: true,
      active: true,
      exceptional: true,
      exception_reason: true,
      assigned_by_id: true,
      start_date: true,
      end_date: true,
      created_at: true,
      modified_at: true,
      users: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
          email: true,
          user_image: true,
        },
      },
      assigned_by: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
        },
      },
      classes: {
        select: {
          class_id: true,
          name: true,
          club_type_id: true,
          display_order: true,
        },
      },
      club_role_assignments: {
        select: {
          assignment_id: true,
          roles: {
            select: {
              role_name: true,
            },
          },
        },
      },
    };
  }
}
