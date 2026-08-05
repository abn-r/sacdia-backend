import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LegalRepresentativesService } from '../legal-representatives/legal-representatives.service';
import { MembershipRequestsService } from '../membership-requests/membership-requests.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import {
  ClassAssignmentResolverService,
  ClassResolutionYear,
} from '../common/services/class-assignment-resolver.service';
import {
  AppBadRequestException,
  AppConflictException,
  AppException,
  AppInternalServerErrorException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

export type PostRegistrationActorContext = {
  actorUserId: string;
  isOwner: boolean;
};

type ClubInstanceField = 'club_section_id';

type ResolvedClubSection = {
  club_section_id: number;
  club_type_id: number;
};

type ResolvedMemberAssignment = {
  assignment_id: string;
  user_id: string;
  club_section_id: number | null;
  active: boolean;
  status: string | null;
};

type ResolveMemberAssignmentResult = {
  assignment: ResolvedMemberAssignment;
  shouldNotifyReviewers: boolean;
};

@Injectable()
export class PostRegistrationService {
  private readonly logger = new Logger(PostRegistrationService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private legalRepService: LegalRepresentativesService,
    private classAssignmentResolver: ClassAssignmentResolverService,
    private membershipRequestsService: MembershipRequestsService,
    private authorizationContext: AuthorizationContextService,
    private authorizationContextVersion: AuthorizationContextVersionService,
  ) {}

  async getStatus(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
    });

    if (!userPr) {
      throw new AppBadRequestException(ErrorCode.POST_REG_NOT_INITIATED);
    }

    let nextStep: string | null = null;
    if (!userPr.profile_picture_complete) {
      nextStep = 'profilePicture';
    } else if (!userPr.personal_info_complete) {
      nextStep = 'personalInfo';
    } else if (!userPr.club_selection_complete) {
      nextStep = 'clubSelection';
    }

    const response = {
      status: 'success',
      data: {
        complete: userPr.complete,
        steps: {
          profilePicture: userPr.profile_picture_complete,
          personalInfo: userPr.personal_info_complete,
          clubSelection: userPr.club_selection_complete,
        },
        nextStep,
        dateCompleted: userPr.date_completed,
      },
    };

    if (actor.isOwner) {
      return response;
    }

    return {
      status: 'success',
      data: {
        complete: response.data.complete,
        steps: response.data.steps,
        dateCompleted: response.data.dateCompleted,
      },
    };
  }

  async getPhotoStatus(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_image: true },
    });

    return {
      has_photo: !!user?.user_image,
    };
  }

  async completeStep1(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      // Verificar que el usuario tenga foto
      const user = await this.prisma.users.findUnique({
        where: { user_id: userId },
        select: { user_image: true },
      });

      if (!user?.user_image) {
        throw new AppBadRequestException(ErrorCode.POST_REG_PHOTO_REQUIRED);
      }

      await this.prisma.users_pr.update({
        where: { user_id: userId },
        data: { profile_picture_complete: true },
      });

      this.logger.log(`Step 1 (profile picture) completed for user ${userId}`);

      return actor.isOwner
        ? {
            status: 'success',
            message: 'Paso 1 completado: Foto de perfil',
          }
        : {
            status: 'success',
            message: 'Paso 1 completado',
          };
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 1 para este usuario',
      );
    }
  }

  async completeStep2(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      // Validar que tenga info personal completa
      const user = await this.prisma.users.findUnique({
        where: { user_id: userId },
        select: {
          gender: true,
          birthday: true,
          baptism: true,
        },
      });

      if (!user) {
        throw new AppBadRequestException(ErrorCode.POST_REG_USER_NOT_FOUND);
      }

      if (!user.gender || !user.birthday || user.baptism === null) {
        throw new AppBadRequestException(
          ErrorCode.POST_REG_PERSONAL_INFO_INCOMPLETE,
        );
      }

      // Validar contactos de emergencia (al menos 1)
      const contactsCount = await this.prisma.emergency_contacts.count({
        where: {
          owner_id: userId,
          active: true,
        },
      });

      if (contactsCount === 0) {
        throw new AppBadRequestException(
          ErrorCode.POST_REG_EMERGENCY_CONTACT_REQUIRED,
        );
      }

      // Si es menor de 18, validar representante legal
      const requiresRep =
        await this.usersService.requiresLegalRepresentative(userId);

      if (requiresRep) {
        try {
          await this.legalRepService.findOne(userId);
        } catch {
          throw new AppBadRequestException(
            ErrorCode.POST_REG_LEGAL_REP_REQUIRED,
          );
        }
      }

      await this.prisma.users_pr.update({
        where: { user_id: userId },
        data: { personal_info_complete: true },
      });

      this.logger.log(`Step 2 (personal info) completed for user ${userId}`);

      return actor.isOwner
        ? {
            status: 'success',
            message: 'Paso 2 completado: Información personal',
          }
        : {
            status: 'success',
            message: 'Paso 2 completado',
          };
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 2 para este usuario',
      );
    }
  }

  async completeStep3(
    userId: string,
    dto: CompleteClubSelectionDto,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      const completion = await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const currentYear = await this.resolveActiveEcclesiasticalYear(tx, now);
        const memberRoleId = await this.resolveMemberRoleId(tx);
        const clubInstanceField: ClubInstanceField = 'club_section_id';

        const selectedClub = await this.resolveSelectedClub(tx, dto);
        const resolvedClassId =
          await this.classAssignmentResolver.resolveClassIdForUserClubType(tx, {
            userId,
            requestedClassId: dto.class_id,
            clubTypeId: selectedClub.club_type_id,
            currentYear,
          });

        const authorityUser = await tx.users.update({
          where: { user_id: userId },
          data: {
            country_id: dto.country_id,
            union_id: dto.union_id,
            local_field_id: dto.local_field_id,
          },
          select: { user_id: true },
        });

        const membershipRequest = await this.resolveMemberAssignment(tx, {
          userId,
          roleId: memberRoleId,
          clubInstanceField,
          clubInstanceId: dto.club_section_id,
          ecclesiasticalYearId: currentYear.year_id,
          assignmentStartDate: currentYear.start_date,
        });

        await tx.enrollments.updateMany({
          where: {
            user_id: userId,
            ecclesiastical_year_id: currentYear.year_id,
            active: true,
            NOT: { class_id: resolvedClassId },
          },
          data: {
            active: false,
          },
        });

        await this.resolveOperationalEnrollment(tx, {
          userId,
          classId: resolvedClassId,
          ecclesiasticalYearId: currentYear.year_id,
        });

        await tx.users_pr.update({
          where: { user_id: userId },
          data: {
            club_selection_complete: true,
            complete: true,
            date_completed: now,
          },
        });

        await this.authorizationContextVersion.bump(tx, authorityUser.user_id);

        this.logger.log(
          `Step 3 (club selection) completed for user ${userId} - Post-registration COMPLETE`,
        );

        const response = {
          status: 'success',
          message: 'Post-registro completado exitosamente',
          data: {
            clubSectionId: dto.club_section_id,
            classId: resolvedClassId,
            ecclesiasticalYear: currentYear.year_id,
          },
        };

        if (actor.isOwner) {
          return {
            response,
            membershipRequest,
            affectedAuthorizationUserId: authorityUser.user_id,
          };
        }

        return {
          response: {
            status: 'success',
            message: 'Paso 3 completado',
          },
          membershipRequest,
          affectedAuthorizationUserId: authorityUser.user_id,
        };
      });

      await this.authorizationContext.invalidateUserAuthorizationCache(
        completion.affectedAuthorizationUserId,
      );

      if (completion.membershipRequest.shouldNotifyReviewers) {
        await this.membershipRequestsService.notifyNewRequestCreated({
          userId,
          clubSectionId:
            completion.membershipRequest.assignment.club_section_id ??
            dto.club_section_id,
          assignmentId: completion.membershipRequest.assignment.assignment_id,
        });
      }

      return completion.response;
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 3 para este usuario',
      );
    }
  }

  async cancelPendingMembershipRequest(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      await this.membershipRequestsService.cancelPendingForUser(
        userId,
        actor.actorUserId,
      );

      return actor.isOwner
        ? {
            status: 'success',
            message:
              'Solicitud de membresía cancelada. Puedes elegir club y sección nuevamente.',
          }
        : {
            status: 'success',
            message: 'Solicitud de membresía cancelada',
          };
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede cancelar la solicitud de membresía para este usuario',
      );
    }
  }

  private async resolveActiveEcclesiasticalYear(
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<ClassResolutionYear> {
    const currentYear = await tx.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: at },
        end_date: { gte: at },
      },
      select: {
        year_id: true,
        start_date: true,
      },
    });

    if (!currentYear) {
      throw new AppInternalServerErrorException(
        ErrorCode.POST_REG_NO_ACTIVE_YEAR,
      );
    }

    return currentYear;
  }

  private async resolveMemberRoleId(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const memberRole = await tx.roles.findFirst({
      where: {
        role_name: 'member',
        role_category: 'CLUB',
      },
      select: {
        role_id: true,
      },
    });

    if (!memberRole) {
      throw new AppInternalServerErrorException(
        ErrorCode.POST_REG_MEMBER_ROLE_NOT_FOUND,
      );
    }

    return memberRole.role_id;
  }

  private async resolveSelectedClub(
    tx: Prisma.TransactionClient,
    dto: CompleteClubSelectionDto,
  ): Promise<ResolvedClubSection> {
    const section = await tx.club_sections.findUnique({
      where: { club_section_id: dto.club_section_id },
      select: {
        club_section_id: true,
        club_type_id: true,
      },
    });

    if (!section) {
      throw new AppBadRequestException(ErrorCode.POST_REG_CLUB_NOT_FOUND);
    }

    return section;
  }

  private async resolveMemberAssignment(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      roleId: string;
      clubInstanceField: ClubInstanceField;
      clubInstanceId: number;
      ecclesiasticalYearId: number;
      assignmentStartDate: Date;
    },
  ): Promise<ResolveMemberAssignmentResult> {
    // --- Multi-club same-type validation ---
    const targetSection = await tx.club_sections.findUnique({
      where: { club_section_id: params.clubInstanceId },
      select: { club_type_id: true },
    });

    if (!targetSection) {
      throw new AppBadRequestException(ErrorCode.POST_REG_CLUB_NOT_FOUND);
    }

    const currentAssignmentIdentity = {
      role_id: params.roleId,
      ecclesiastical_year_id: params.ecclesiasticalYearId,
      [params.clubInstanceField]: params.clubInstanceId,
      start_date: params.assignmentStartDate,
    };

    const existingConflictingMembership =
      await tx.club_role_assignments.findFirst({
        where: {
          user_id: params.userId,
          active: true,
          OR: [
            { status: 'pending' },
            {
              status: 'active',
              club_sections: {
                club_type_id: targetSection.club_type_id,
              },
            },
          ],
          NOT: currentAssignmentIdentity,
        },
      });

    if (existingConflictingMembership) {
      throw new AppConflictException(ErrorCode.POST_REG_DUPLICATE_MEMBERSHIP);
    }

    // --- Create or reactivate assignment with pending status ---
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 8);

    const assignmentSelect = {
      assignment_id: true,
      user_id: true,
      club_section_id: true,
      active: true,
      status: true,
    } satisfies Prisma.club_role_assignmentsSelect;

    const where: Prisma.club_role_assignmentsWhereInput = {
      user_id: params.userId,
      ...currentAssignmentIdentity,
    };

    const existingAssignment = await tx.club_role_assignments.findFirst({
      where,
      select: assignmentSelect,
    });

    if (existingAssignment) {
      if (
        !existingAssignment.active ||
        existingAssignment.status !== 'pending'
      ) {
        const updatedAssignment = await tx.club_role_assignments.update({
          where: {
            assignment_id: existingAssignment.assignment_id,
          },
          data: {
            active: true,
            status: 'pending',
            expires_at: expiresAt,
            end_date: null,
          },
          select: assignmentSelect,
        });

        return {
          assignment: updatedAssignment,
          shouldNotifyReviewers: true,
        };
      }

      return {
        assignment: existingAssignment,
        shouldNotifyReviewers: false,
      };
    }

    try {
      const createdAssignment = await tx.club_role_assignments.create({
        data: {
          user_id: params.userId,
          role_id: params.roleId,
          [params.clubInstanceField]: params.clubInstanceId,
          ecclesiastical_year_id: params.ecclesiasticalYearId,
          start_date: params.assignmentStartDate,
          active: true,
          status: 'pending',
          expires_at: expiresAt,
        },
        select: assignmentSelect,
      });

      return {
        assignment: createdAssignment,
        shouldNotifyReviewers: true,
      };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const recoveredAssignment = await tx.club_role_assignments.findFirst({
        where,
        select: assignmentSelect,
      });

      if (!recoveredAssignment) {
        throw new AppInternalServerErrorException(
          ErrorCode.POST_REG_ASSIGNMENT_FAILED,
        );
      }

      if (
        !recoveredAssignment.active ||
        recoveredAssignment.status !== 'pending'
      ) {
        const updatedRecoveredAssignment =
          await tx.club_role_assignments.update({
            where: {
              assignment_id: recoveredAssignment.assignment_id,
            },
            data: {
              active: true,
              status: 'pending',
              expires_at: expiresAt,
              end_date: null,
            },
            select: assignmentSelect,
          });

        return {
          assignment: updatedRecoveredAssignment,
          shouldNotifyReviewers: true,
        };
      }

      return {
        assignment: recoveredAssignment,
        shouldNotifyReviewers: false,
      };
    }
  }

  private async resolveOperationalEnrollment(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      classId: number;
      ecclesiasticalYearId: number;
    },
  ) {
    const enrollmentWhere = {
      user_id_class_id_ecclesiastical_year_id: {
        user_id: params.userId,
        class_id: params.classId,
        ecclesiastical_year_id: params.ecclesiasticalYearId,
      },
    };

    const existingEnrollment = await tx.enrollments.findUnique({
      where: enrollmentWhere,
      select: {
        enrollment_id: true,
        active: true,
      },
    });

    if (existingEnrollment) {
      if (!existingEnrollment.active) {
        await tx.enrollments.update({
          where: {
            enrollment_id: existingEnrollment.enrollment_id,
          },
          data: {
            active: true,
          },
        });
      }

      return;
    }

    try {
      await tx.enrollments.create({
        data: {
          user_id: params.userId,
          class_id: params.classId,
          ecclesiastical_year_id: params.ecclesiasticalYearId,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const recoveredEnrollment = await tx.enrollments.findUnique({
        where: enrollmentWhere,
        select: {
          enrollment_id: true,
        },
      });

      if (!recoveredEnrollment) {
        throw new AppInternalServerErrorException(
          ErrorCode.POST_REG_ENROLLMENT_FAILED,
        );
      }
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private createOwnerContext(userId: string): PostRegistrationActorContext {
    return {
      actorUserId: userId,
      isOwner: true,
    };
  }

  private sanitizeAdministrativeValidationError(
    error: unknown,
    actor: PostRegistrationActorContext,
    _genericMessage: string,
  ): Error {
    // Owner always sees the real error (specific code or message)
    if (actor.isOwner) {
      return error as Error;
    }
    // Non-owner: hide specific validation details — return a generic AppException
    // that produces a 400 without exposing business logic
    if (error instanceof AppException) {
      return new AppBadRequestException(ErrorCode.POST_REG_NOT_INITIATED);
    }
    // Legacy fallback for any remaining plain NestJS exceptions
    if (
      error instanceof Error &&
      error.constructor.name.includes('Exception')
    ) {
      return new AppBadRequestException(ErrorCode.POST_REG_NOT_INITIATED);
    }
    // Unknown errors propagate as-is
    return error as Error;
  }
}
