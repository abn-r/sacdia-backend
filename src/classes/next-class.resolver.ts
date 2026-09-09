import { Injectable } from '@nestjs/common';
import { AppNotFoundException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export interface NextClassResult {
  class_id: number;
  display_order: number;
  club_type_id: number;
  club_section_id: number;
  ecclesiastical_year_id: number;
  crossed_type: boolean;
}

export type NextClassDecision =
  | ({ kind: 'next_class' } & NextClassResult)
  | { kind: 'policy_blocked'; code: ErrorCode }
  | { kind: 'configuration_error'; code: ErrorCode };

const TRAJECTORY_TYPE_NAMES = [
  'Aventureros',
  'Conquistadores',
  'Guías Mayores',
] as const;

@Injectable()
export class NextClassResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    userId: string,
    fromSectionId: number,
    yearId: number,
  ): Promise<NextClassDecision> {
    const fromSection = await this.prisma.club_sections.findUnique({
      where: { club_section_id: fromSectionId },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });

    if (!fromSection) {
      throw new AppNotFoundException(ErrorCode.CLUB_SECTION_NOT_FOUND);
    }

    const targetYear = await this.prisma.ecclesiastical_years.findUnique({
      where: { year_id: yearId },
      select: { year_id: true, start_date: true, end_date: true },
    });

    if (!targetYear) {
      return {
        kind: 'configuration_error',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      };
    }

    const prior = await this.prisma.enrollments.findMany({
      where: {
        user_id: userId,
        cross_type_enrollment: false,
        classes: { club_type_id: fromSection.club_type_id },
        ecclesiastical_year: { end_date: { lt: targetYear.start_date } },
      },
      include: {
        classes: {
          select: { class_id: true, display_order: true, club_type_id: true },
        },
        ecclesiastical_year: { select: { end_date: true, start_date: true } },
      },
    });

    prior.sort((a, b) => {
      const endDiff =
        (b.ecclesiastical_year?.end_date?.getTime() ?? 0) -
        (a.ecclesiastical_year?.end_date?.getTime() ?? 0);
      if (endDiff !== 0) return endDiff;
      return b.classes.display_order - a.classes.display_order;
    });

    const lastEnrollment = prior[0];

    if (!lastEnrollment) {
      const firstClass = await this.prisma.classes.findFirst({
        where: { club_type_id: fromSection.club_type_id, active: true },
        orderBy: { display_order: 'asc' },
        select: { class_id: true, display_order: true, club_type_id: true },
      });

      if (!firstClass) {
        return {
          kind: 'configuration_error',
          code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
        };
      }

      return {
        kind: 'next_class',
        class_id: firstClass.class_id,
        display_order: firstClass.display_order,
        club_type_id: firstClass.club_type_id,
        club_section_id: fromSectionId,
        ecclesiastical_year_id: yearId,
        crossed_type: false,
      };
    }

    const nextSameType = await this.prisma.classes.findFirst({
      where: {
        club_type_id: lastEnrollment.classes.club_type_id,
        display_order: { gt: lastEnrollment.classes.display_order },
        active: true,
      },
      orderBy: { display_order: 'asc' },
      select: { class_id: true, display_order: true, club_type_id: true },
    });

    if (nextSameType) {
      return {
        kind: 'next_class',
        class_id: nextSameType.class_id,
        display_order: nextSameType.display_order,
        club_type_id: nextSameType.club_type_id,
        club_section_id: fromSectionId,
        ecclesiastical_year_id: yearId,
        crossed_type: false,
      };
    }

    const lastClubType = await this.prisma.club_types.findUnique({
      where: { club_type_id: lastEnrollment.classes.club_type_id },
      select: { club_type_id: true, name: true },
    });

    if (
      lastClubType &&
      (TRAJECTORY_TYPE_NAMES as readonly string[]).includes(lastClubType.name)
    ) {
      return {
        kind: 'configuration_error',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      };
    }

    return {
      kind: 'configuration_error',
      code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
    };
  }
}
