import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClubEnrollmentDto, UpdateClubEnrollmentDto } from './dto';

@Injectable()
export class ClubEnrollmentsService {
  private readonly logger = new Logger(ClubEnrollmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
      throw new NotFoundException(
        `Club section with ID ${sectionId} not found`,
      );
    }

    if (section.main_club_id !== clubId) {
      throw new BadRequestException(
        `Section ${sectionId} does not belong to club ${clubId}`,
      );
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
            ecclesiastical_year_id: currentYear.year_id,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `An enrollment already exists for section ${sectionId} in the current ecclesiastical year`,
        );
      }

      this.validateSecretaryTreasurerConstraint(dto);

      return tx.club_enrollments.create({
        data: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.year_id,
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
    const currentYear = await this.getActiveEcclesiasticalYear();

    const enrollment = await this.prisma.club_enrollments.findUnique({
      where: {
        club_section_id_ecclesiastical_year_id: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.year_id,
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
      throw new NotFoundException(
        `Enrollment with ID ${enrollmentId} not found`,
      );
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
          ecclesiastical_year_id: currentYear.year_id,
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
      throw new BadRequestException(
        'secretary_treasurer_id is mutually exclusive with secretary_id and treasurer_id. ' +
          'A club must use either the combined role or separate roles, not both.',
      );
    }
  }

  private async getActiveEcclesiasticalYear() {
    const currentYear = await this.prisma.ecclesiastical_years.findFirst({
      where: {
        start_date: { lte: new Date() },
        end_date: { gte: new Date() },
      },
    });

    if (!currentYear) {
      throw new BadRequestException('No active ecclesiastical year configured');
    }

    return currentYear;
  }
}
