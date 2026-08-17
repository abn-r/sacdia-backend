import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { CreateClubEnrollmentDto, UpdateClubEnrollmentDto } from './dto';
import { AnnualFoldersService } from '../annual-folders/annual-folders.service';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { ResolvedAuthorizationProfile } from '../common/services/authorization-context.service';

export const CLUB_ENROLLMENT_STATUS = {
  PENDING_VALIDATION: 'pending_validation',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  INACTIVE: 'inactive',
} as const;

export type ClubEnrollmentStatus =
  (typeof CLUB_ENROLLMENT_STATUS)[keyof typeof CLUB_ENROLLMENT_STATUS];

type ValidationQueueFilters = {
  status?: ClubEnrollmentStatus | 'all';
  search?: string;
  ecclesiastical_year_id?: number;
  local_field_id?: number;
  club_type_id?: number;
  page?: number;
  limit?: number;
};

@Injectable()
export class ClubEnrollmentsService {
  private readonly logger = new Logger(ClubEnrollmentsService.name);

  private readonly enrollmentInclude = {
    club_section: {
      include: {
        clubs: {
          include: {
            local_fields: {
              include: {
                unions: true,
              },
            },
          },
        },
        club_types: true,
      },
    },
    ecclesiastical_year: true,
    creator: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        email: true,
      },
    },
    director: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        email: true,
      },
    },
    secretary: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        email: true,
      },
    },
    treasurer: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        email: true,
      },
    },
    secretary_treasurer: {
      select: {
        user_id: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        email: true,
      },
    },
  } satisfies Prisma.club_enrollmentsInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogsService: CatalogsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ========================================
  // CREATE
  // ========================================

  async create(
    clubId: number,
    sectionId: number,
    dto: CreateClubEnrollmentDto,
    userId: string,
  ) {
    // Validate club section exists and belongs to the club
    const section = await this.prisma.club_sections.findUnique({
      where: { club_section_id: sectionId },
    });

    if (!section) {
      throw new AppNotFoundException(ErrorCode.CE_SECTION_NOT_FOUND);
    }

    if (section.main_club_id !== clubId) {
      throw new AppBadRequestException(ErrorCode.CE_SECTION_NOT_FOUND);
    }

    // Get current ecclesiastical year
    const currentYear = await this.getActiveEcclesiasticalYear();

    // Wrap the existence check + create in a transaction to prevent duplicate
    // enrollments under concurrent requests (check-then-create race condition).
    const enrollment = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.club_enrollments.findUnique({
        where: {
          club_section_id_ecclesiastical_year_id: {
            club_section_id: sectionId,
            ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
          },
        },
      });

      if (
        existing &&
        existing.status !== CLUB_ENROLLMENT_STATUS.REJECTED &&
        existing.status !== CLUB_ENROLLMENT_STATUS.INACTIVE
      ) {
        throw new AppConflictException(ErrorCode.CE_ALREADY_ENROLLED);
      }

      this.validateSecretaryTreasurerConstraint(dto);

      const enrollmentData = {
        club_section_id: sectionId,
        ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
        status: CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION,
        address: dto.address,
        meeting_days: dto.meeting_days,
        latitude: dto.latitude,
        longitude: dto.longitude,
        meeting_schedule: dto.meeting_schedule
          ? dto.meeting_schedule.map((item) => ({
              day: item.day,
              time: item.time,
            }))
          : undefined,
        souls_target: dto.souls_target,
        fee: dto.fee ?? false,
        fee_amount: dto.fee_amount ?? null,
        director_id: dto.director_id,
        deputy_director_ids: dto.deputy_director_ids ?? [],
        secretary_id: dto.secretary_id,
        treasurer_id: dto.treasurer_id,
        secretary_treasurer_id: dto.secretary_treasurer_id,
        created_by: userId,
      };

      if (existing) {
        return tx.club_enrollments.update({
          where: { club_enrollment_id: existing.club_enrollment_id },
          data: {
            ...enrollmentData,
            modified_at: new Date(),
          },
          include: this.enrollmentInclude,
        });
      }

      return tx.club_enrollments.create({
        data: {
          ...enrollmentData,
        },
        include: this.enrollmentInclude,
      });
    });

    return enrollment;
  }

  // ========================================
  // READ
  // ========================================

  async findCurrentBySectionId(sectionId: number) {
    const currentYear =
      await this.catalogsService.getCurrentEcclesiasticalYear();
    if (!currentYear) {
      return null;
    }

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: {
        club_section_id_ecclesiastical_year_id: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
        },
      },
      include: {
        club_section: {
          include: { club_types: { select: { name: true } } },
        },
        ecclesiastical_year: true,
        creator: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
    });

    return enrollment ?? null;
  }

  async findBySectionId(sectionId: number, filters?: { year?: number }) {
    const where: Record<string, unknown> = {
      club_section_id: sectionId,
    };

    if (filters?.year) {
      where.ecclesiastical_year_id = filters.year;
    }

    // Per-section enrollments: at most one per ecclesiastical year.
    // Safety cap of 100 covers decades of operation.
    return this.prisma.club_enrollments.findMany({
      where,
      include: {
        club_section: {
          include: { club_types: { select: { name: true } } },
        },
        ecclesiastical_year: true,
        creator: {
          select: {
            user_id: true,
            name: true,
            paternal_last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }

  async findValidationQueue(
    filters: ValidationQueueFilters = {},
    authorizationProfile?: ResolvedAuthorizationProfile,
  ) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.club_enrollmentsWhereInput = {
      ...(filters.status && filters.status !== 'all'
        ? { status: filters.status }
        : { status: CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION }),
      ...this.buildValidationQueueCatalogWhere(filters),
      ...this.buildValidationQueueSearchWhere(filters.search),
      ...this.buildValidationQueueScopeWhere(authorizationProfile),
    };

    const [data, total] = await Promise.all([
      this.prisma.club_enrollments.findMany({
        where,
        include: this.enrollmentInclude,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.club_enrollments.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  // ========================================
  // UPDATE
  // ========================================

  async update(enrollmentId: string, dto: UpdateClubEnrollmentDto) {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    this.validateSecretaryTreasurerConstraint(dto);

    // Build a clean data object — avoid passing `undefined` properties to Prisma
    // so that omitted fields are not accidentally nulled out.
    const data: Record<string, unknown> = { modified_at: new Date() };

    if (
      enrollment.status === CLUB_ENROLLMENT_STATUS.REJECTED ||
      enrollment.status === CLUB_ENROLLMENT_STATUS.INACTIVE
    ) {
      data.status = CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION;
    }

    if (dto.address !== undefined) data.address = dto.address;
    if (dto.meeting_days !== undefined) data.meeting_days = dto.meeting_days;
    if (dto.latitude !== undefined) data.latitude = dto.latitude;
    if (dto.longitude !== undefined) data.longitude = dto.longitude;
    if (dto.meeting_schedule !== undefined)
      data.meeting_schedule = dto.meeting_schedule.map((item) => ({
        day: item.day,
        time: item.time,
      }));
    if (dto.souls_target !== undefined) data.souls_target = dto.souls_target;
    if (dto.fee !== undefined) data.fee = dto.fee;
    if (dto.fee_amount !== undefined) data.fee_amount = dto.fee_amount;
    if (dto.director_id !== undefined) data.director_id = dto.director_id;
    if (dto.deputy_director_ids !== undefined)
      data.deputy_director_ids = dto.deputy_director_ids;
    if (dto.secretary_id !== undefined) data.secretary_id = dto.secretary_id;
    if (dto.treasurer_id !== undefined) data.treasurer_id = dto.treasurer_id;
    if (dto.secretary_treasurer_id !== undefined)
      data.secretary_treasurer_id = dto.secretary_treasurer_id;

    return this.prisma.club_enrollments.update({
      where: { club_enrollment_id: enrollmentId },
      data,
      include: this.enrollmentInclude,
    });
  }

  async approve(enrollmentId: string, reviewerId: string) {
    const enrollment = await this.findEnrollmentForReview(enrollmentId);

    if (enrollment.status === CLUB_ENROLLMENT_STATUS.ACTIVE) {
      return enrollment;
    }

    if (enrollment.status !== CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION) {
      throw new AppConflictException(ErrorCode.RECORD_CONFLICT, {
        status: enrollment.status,
      });
    }

    const updated = await this.prisma.club_enrollments.update({
      where: { club_enrollment_id: enrollmentId },
      data: {
        status: CLUB_ENROLLMENT_STATUS.ACTIVE,
        modified_at: new Date(),
      },
      include: this.enrollmentInclude,
    });

    this.logger.log(
      `Annual club enrollment ${enrollmentId} approved by ${reviewerId}`,
    );

    await this.createAnnualFolderForEnrollmentIfTemplateExists(enrollmentId);

    return updated;
  }

  async reject(enrollmentId: string, reviewerId: string) {
    const enrollment = await this.findEnrollmentForReview(enrollmentId);

    if (enrollment.status !== CLUB_ENROLLMENT_STATUS.PENDING_VALIDATION) {
      throw new AppConflictException(ErrorCode.RECORD_CONFLICT, {
        status: enrollment.status,
      });
    }

    const updated = await this.prisma.club_enrollments.update({
      where: { club_enrollment_id: enrollmentId },
      data: {
        status: CLUB_ENROLLMENT_STATUS.REJECTED,
        modified_at: new Date(),
      },
      include: this.enrollmentInclude,
    });

    this.logger.log(
      `Annual club enrollment ${enrollmentId} rejected by ${reviewerId}`,
    );

    return updated;
  }

  // ========================================
  // GUARDS / HELPERS
  // ========================================

  async hasActiveEnrollment(sectionId: number): Promise<boolean> {
    const currentYear = await this.getActiveEcclesiasticalYear();

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: {
        club_section_id_ecclesiastical_year_id: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
        },
        status: CLUB_ENROLLMENT_STATUS.ACTIVE,
      },
      select: { club_enrollment_id: true },
    });

    return !!enrollment;
  }

  /**
   * A club can have either a secretary + treasurer OR a combined secretary-treasurer,
   * never both configurations at the same time.
   */
  private validateSecretaryTreasurerConstraint(
    dto: CreateClubEnrollmentDto | UpdateClubEnrollmentDto,
  ): void {
    const hasIndividualRoles = dto.secretary_id || dto.treasurer_id;
    const hasCombinedRole = dto.secretary_treasurer_id;

    if (hasIndividualRoles && hasCombinedRole) {
      throw new AppBadRequestException(
        ErrorCode.CE_ECCLESIASTICAL_YEAR_REQUIRED,
      );
    }
  }

  private async findEnrollmentForReview(enrollmentId: string) {
    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: { club_enrollment_id: enrollmentId },
      include: this.enrollmentInclude,
    });

    if (!enrollment) {
      throw new AppNotFoundException(ErrorCode.CE_ENROLLMENT_NOT_FOUND);
    }

    return enrollment;
  }

  private buildValidationQueueSearchWhere(
    search: string | undefined,
  ): Prisma.club_enrollmentsWhereInput {
    const value = search?.trim();
    if (!value) return {};

    return {
      OR: [
        { club_section: { clubs: { name: { contains: value } } } },
        { club_section: { club_types: { name: { contains: value } } } },
        { creator: { name: { contains: value } } },
        { creator: { paternal_last_name: { contains: value } } },
        { creator: { maternal_last_name: { contains: value } } },
        { creator: { email: { contains: value } } },
      ],
    };
  }

  private buildValidationQueueCatalogWhere(
    filters: ValidationQueueFilters,
  ): Prisma.club_enrollmentsWhereInput {
    const and: Prisma.club_enrollmentsWhereInput[] = [];

    if (filters.ecclesiastical_year_id !== undefined) {
      and.push({ ecclesiastical_year_id: filters.ecclesiastical_year_id });
    }

    if (filters.club_type_id !== undefined) {
      and.push({
        club_section: { club_type_id: filters.club_type_id },
      });
    }

    if (filters.local_field_id !== undefined) {
      and.push({
        club_section: {
          clubs: { local_field_id: filters.local_field_id },
        },
      });
    }

    return and.length > 0 ? { AND: and } : {};
  }

  private buildValidationQueueScopeWhere(
    authorizationProfile?: ResolvedAuthorizationProfile,
  ): Prisma.club_enrollmentsWhereInput {
    if (!authorizationProfile) return {};

    if (
      this.hasGlobalRole(authorizationProfile, 'super-admin') ||
      this.hasGlobalRole(authorizationProfile, 'admin')
    ) {
      return {};
    }

    const localFieldId =
      this.toNumericScopeId(
        authorizationProfile.authorization.effective.scope.global.local_field
          ?.id,
      ) ?? authorizationProfile.profile.local_field_id;

    if (typeof localFieldId === 'number') {
      return {
        club_section: { clubs: { local_field_id: localFieldId } },
      };
    }

    const unionId =
      this.toNumericScopeId(
        authorizationProfile.authorization.effective.scope.global.union?.id,
      ) ?? authorizationProfile.profile.union_id;

    if (typeof unionId === 'number') {
      return {
        club_section: {
          clubs: { local_fields: { union_id: unionId } },
        },
      };
    }

    const activeAssignmentId =
      authorizationProfile.authorization.active_assignment.assignment_id;

    if (activeAssignmentId) {
      return {
        club_section: {
          club_role_assignments: {
            some: {
              assignment_id: activeAssignmentId,
              active: true,
              status: 'active',
            },
          },
        },
      };
    }

    return { club_enrollment_id: '00000000-0000-0000-0000-000000000000' };
  }

  private hasGlobalRole(
    authorizationProfile: ResolvedAuthorizationProfile,
    roleName: string,
  ): boolean {
    const normalizedRole = roleName.toLowerCase();
    return authorizationProfile.authorization.grants.global_roles.some(
      (grant) => grant.role_name.toLowerCase() === normalizedRole,
    );
  }

  private toNumericScopeId(value: number | string | undefined): number | null {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private async createAnnualFolderForEnrollmentIfTemplateExists(
    enrollmentId: string,
  ): Promise<void> {
    let annualFoldersService: AnnualFoldersService;
    try {
      annualFoldersService = this.moduleRef.get(AnnualFoldersService, {
        strict: false,
      });
    } catch {
      // Unit-test/module contexts may load club enrollments without the annual
      // folders module. Enrollment creation remains the source operation.
      return;
    }

    try {
      await annualFoldersService.createFolderForEnrollment(enrollmentId);
    } catch (err: unknown) {
      const code = err instanceof Error && 'code' in err ? err.code : undefined;
      if (
        code === ErrorCode.ANNUAL_FOLDER_TEMPLATE_NO_MATCH ||
        code === ErrorCode.ANNUAL_FOLDER_ALREADY_EXISTS
      ) {
        this.logger.warn(
          `Annual folder not auto-created for enrollment ${enrollmentId}: ${String(code)}`,
        );
        return;
      }

      this.logger.error(
        `Annual folder auto-creation failed for enrollment ${enrollmentId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async getActiveEcclesiasticalYear() {
    const currentYear =
      await this.catalogsService.getCurrentEcclesiasticalYear();

    if (!currentYear) {
      throw new AppBadRequestException(ErrorCode.CE_NO_ACTIVE_YEAR);
    }

    return currentYear;
  }
}
