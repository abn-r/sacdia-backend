import { Injectable } from '@nestjs/common';
import {
  AppException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { durationStartDate } from './enrollment-duration';

/**
 * How a multi-year class (Guía Mayor family) continues into the new year.
 * Absent for every single-year class: the continuation is a plain enrollment
 * in `class_id` for the new year.
 *
 * - `keep`: the member is still inside the class duration. The SAME open
 *   enrollment is carried into the new year (same row, same progress).
 * - `reopen`: the previous enrollment of this class is over its max duration
 *   without investiture (or already EXPIRED). It is expired (when not yet) and a
 *   fresh enrollment in the same class is opened; the old one stays as history.
 */
export type ClassContinuation =
  | { mode: 'keep'; enrollment_id: number }
  | { mode: 'reopen'; expire_enrollment_id: number | null };

export interface NextClassResult {
  class_id: number;
  display_order: number;
  club_type_id: number;
  club_section_id: number;
  ecclesiastical_year_id: number;
  crossed_type: boolean;
  continuation?: ClassContinuation;
}

/** The statuses `expireEnrollmentsInTx` can move to EXPIRED. */
const EXPIRABLE_STATUSES = new Set(['IN_PROGRESS', 'REJECTED']);

/** Completed classes: INVESTIDO, plus the legacy APPROVED rows (still count). */
const COMPLETED_STATUSES = new Set(['INVESTIDO', 'APPROVED']);

export type NextClassDecision =
  | ({ kind: 'next_class' } & NextClassResult)
  | { kind: 'journey_complete' }
  | { kind: 'policy_blocked'; code: ErrorCode }
  | { kind: 'configuration_error'; code: ErrorCode };

const GM_TYPE_NAME = 'Guías Mayores';

const TYPE_JUMP: Record<string, { destName: string; minAge: number }> = {
  Aventureros: { destName: 'Conquistadores', minAge: 10 },
  Conquistadores: { destName: 'Guías Mayores', minAge: 16 },
};

const unresolved = (): NextClassDecision => ({
  kind: 'configuration_error',
  code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
});

@Injectable()
export class NextClassResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classAssignmentResolver: ClassAssignmentResolverService,
  ) {}

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
      return unresolved();
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
          select: {
            class_id: true,
            display_order: true,
            club_type_id: true,
            min_duration_years: true,
            max_duration_years: true,
          },
        },
        ecclesiastical_year: { select: { end_date: true, start_date: true } },
        duration_start_year: { select: { start_date: true } },
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
      const byAge = await this.classByAge({
        userId,
        clubTypeId: fromSection.club_type_id,
        yearId,
        startDate: targetYear.start_date,
        clubSectionId: fromSectionId,
        crossedType: false,
      });
      return byAge ?? unresolved();
    }

    const continuation = await this.resolveMultiYear(
      lastEnrollment,
      targetYear,
      fromSectionId,
    );
    if (continuation) {
      return continuation;
    }

    // Guía Mayor (GM-01) is the TOP class of its club type. Avanzado and
    // Instructor are legacy/delegated and are never offered: nobody resolves INTO
    // them. Anyone left here (invested, historical certificate, single-year or
    // inactive legacy rows) renews membership without a new class.
    const lastClubTypeName = (
      await this.prisma.club_types.findUnique({
        where: { club_type_id: lastEnrollment.classes.club_type_id },
        select: { name: true },
      })
    )?.name;
    if (lastClubTypeName === GM_TYPE_NAME) {
      return { kind: 'journey_complete' };
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

    const jump = lastClubType ? TYPE_JUMP[lastClubType.name] : undefined;
    if (!jump) {
      return { kind: 'journey_complete' };
    }
    if (fromSection.main_club_id == null) {
      return unresolved();
    }

    const destType = await this.prisma.club_types.findFirst({
      where: { name: jump.destName },
      select: { club_type_id: true, name: true },
    });
    if (!destType) {
      return unresolved();
    }

    const destSection = await this.prisma.club_sections.findFirst({
      where: {
        main_club_id: fromSection.main_club_id,
        club_type_id: destType.club_type_id,
        active: true,
      },
      select: { club_section_id: true, main_club_id: true, club_type_id: true },
    });
    if (!destSection) {
      return unresolved();
    }

    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { birthday: true },
    });
    if (!user?.birthday) {
      return unresolved();
    }

    const age = this.classAssignmentResolver.ageAtDate(
      user.birthday,
      targetYear.start_date,
    );
    if (age < jump.minAge) {
      return unresolved();
    }

    const byAge = await this.classByAge({
      userId,
      clubTypeId: destType.club_type_id,
      yearId,
      startDate: targetYear.start_date,
      clubSectionId: destSection.club_section_id,
      crossedType: true,
    });
    return byAge ?? unresolved();
  }

  /**
   * Multi-year classes (`max_duration_years > 1`). Returns null to fall through
   * to the single-year flow (next class by `display_order`).
   *
   * - invested -> journey complete (GM is the cap: no new class, no new record);
   * - still inside max duration -> keep;
   * - EXPIRED, or past max duration without investiture -> reopen the class.
   */
  private async resolveMultiYear(
    last: {
      enrollment_id: number;
      investiture_status: string;
      active: boolean;
      record_kind: string;
      classes: {
        class_id: number;
        display_order: number;
        club_type_id: number;
        min_duration_years: number;
        max_duration_years: number;
      };
      ecclesiastical_year: { start_date: Date } | null;
      duration_start_year: { start_date: Date } | null;
    },
    targetYear: { year_id: number; start_date: Date },
    fromSectionId: number,
  ): Promise<NextClassDecision | null> {
    const cls = last.classes;
    if (
      !(cls.max_duration_years > 1) ||
      !last.active ||
      last.record_kind !== 'OPERATIONAL' ||
      !last.ecclesiastical_year
    ) {
      return null;
    }

    const origin = durationStartDate({
      ecclesiastical_year: last.ecclesiastical_year,
      duration_start_year: last.duration_start_year,
    });
    const countFrom = (to: Date) =>
      this.prisma.ecclesiastical_years.count({
        where: { start_date: { gte: origin, lte: to } },
      });

    const base = {
      class_id: cls.class_id,
      display_order: cls.display_order,
      club_type_id: cls.club_type_id,
      club_section_id: fromSectionId,
      ecclesiastical_year_id: targetYear.year_id,
      crossed_type: false,
    };
    const keep: NextClassDecision = {
      kind: 'next_class',
      ...base,
      continuation: { mode: 'keep', enrollment_id: last.enrollment_id },
    };

    // Invested in the class: nothing to continue (see the GM cap in `resolve`).
    if (COMPLETED_STATUSES.has(last.investiture_status)) {
      return { kind: 'journey_complete' };
    }

    if (last.investiture_status === 'EXPIRED') {
      return {
        kind: 'next_class',
        ...base,
        continuation: { mode: 'reopen', expire_enrollment_id: null },
      };
    }

    const elapsedAtTarget = await countFrom(targetYear.start_date);
    if (elapsedAtTarget <= cls.max_duration_years) {
      return keep;
    }

    if (!EXPIRABLE_STATUSES.has(last.investiture_status)) {
      return unresolved();
    }
    return {
      kind: 'next_class',
      ...base,
      continuation: {
        mode: 'reopen',
        expire_enrollment_id: last.enrollment_id,
      },
    };
  }

  private async classByAge(params: {
    userId: string;
    clubTypeId: number;
    yearId: number;
    startDate: Date;
    clubSectionId: number;
    crossedType: boolean;
  }): Promise<NextClassDecision | null> {
    try {
      const classId =
        await this.classAssignmentResolver.resolveClassIdForUserClubType(
          this.prisma,
          {
            userId: params.userId,
            clubTypeId: params.clubTypeId,
            currentYear: {
              year_id: params.yearId,
              start_date: params.startDate,
            },
          },
        );

      const cls = await this.prisma.classes.findUnique({
        where: { class_id: classId },
        select: { class_id: true, display_order: true, club_type_id: true },
      });
      if (!cls) {
        return null;
      }

      return {
        kind: 'next_class',
        class_id: cls.class_id,
        display_order: cls.display_order,
        club_type_id: cls.club_type_id,
        club_section_id: params.clubSectionId,
        ecclesiastical_year_id: params.yearId,
        crossed_type: params.crossedType,
      };
    } catch (error) {
      if (error instanceof AppException) {
        return null;
      }
      throw error;
    }
  }
}
