import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { CreateClubEnrollmentDto, UpdateClubEnrollmentDto } from './dto';
import {
  AppBadRequestException,
  AppNotFoundException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class ClubEnrollmentsService {
  private readonly logger = new Logger(ClubEnrollmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogsService: CatalogsService,
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
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.club_enrollments.findUnique({
        where: {
          club_section_id_ecclesiastical_year_id: {
            club_section_id: sectionId,
            ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
          },
        },
      });

      if (existing) {
        throw new AppConflictException(ErrorCode.CE_ALREADY_ENROLLED);
      }

      this.validateSecretaryTreasurerConstraint(dto);

      return tx.club_enrollments.create({
        data: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.ecclesiastical_year_id,
          status: 'active',
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
        },
        include: {
          club_section: {
            include: { club_types: { select: { name: true } } },
          },
          ecclesiastical_year: true,
        },
      });
    });
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
      include: {
        club_section: {
          include: { club_types: { select: { name: true } } },
        },
        ecclesiastical_year: true,
      },
    });
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

  private async getActiveEcclesiasticalYear() {
    const currentYear =
      await this.catalogsService.getCurrentEcclesiasticalYear();

    if (!currentYear) {
      throw new AppBadRequestException(ErrorCode.CE_NO_ACTIVE_YEAR);
    }

    return currentYear;
  }
}
