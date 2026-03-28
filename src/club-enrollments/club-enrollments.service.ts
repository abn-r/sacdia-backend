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

      return tx.club_enrollments.create({
        data: {
          club_section_id: sectionId,
          ecclesiastical_year_id: currentYear.year_id,
          status: 'active',
          address: dto.address,
          meeting_days: dto.meeting_days,
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

    return this.prisma.club_enrollments.update({
      where: { club_enrollment_id: enrollmentId },
      data: {
        ...dto,
        modified_at: new Date(),
      },
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
