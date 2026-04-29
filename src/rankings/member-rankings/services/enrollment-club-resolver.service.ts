import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface EnrollmentClubContext {
  clubId: number;
  clubSectionId: number;
}

@Injectable()
export class EnrollmentClubResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    enrollmentId: number,
    ecclesiasticalYearId: number,
  ): Promise<EnrollmentClubContext | null> {
    const enrollment = await this.prisma.enrollments.findUnique({
      where: { enrollment_id: enrollmentId },
      select: { user_id: true },
    });
    if (!enrollment) return null;

    const assignment = await this.prisma.club_role_assignments.findFirst({
      where: {
        user_id: enrollment.user_id,
        ecclesiastical_year_id: ecclesiasticalYearId,
        active: true,
        club_section_id: { not: null },
      },
      orderBy: { created_at: 'asc' },
      select: {
        club_sections: {
          select: { club_section_id: true, main_club_id: true },
        },
      },
    });
    if (!assignment?.club_sections?.main_club_id) return null;

    return {
      clubId: assignment.club_sections.main_club_id,
      clubSectionId: assignment.club_sections.club_section_id,
    };
  }
}
