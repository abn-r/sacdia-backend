import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ageAt } from '../age/age.util';

export type ClassResolutionYear = {
  year_id: number;
  start_date: Date;
};

@Injectable()
export class ClassAssignmentResolverService {
  async resolveClassIdForUserClubType(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      requestedClassId?: number | null;
      clubTypeId: number;
      currentYear: ClassResolutionYear;
      userNotFoundExceptionFactory?: () => Error;
    },
  ): Promise<number> {
    const user = await tx.users.findUnique({
      where: { user_id: params.userId },
      select: { birthday: true },
    });

    if (!user) {
      throw (
        params.userNotFoundExceptionFactory?.() ??
        new AppBadRequestException(ErrorCode.POST_REG_USER_NOT_FOUND)
      );
    }

    if (!user.birthday) {
      throw new AppBadRequestException(
        ErrorCode.POST_REG_PERSONAL_INFO_INCOMPLETE,
      );
    }

    const ageAtYearStart = ageAt(user.birthday, params.currentYear.start_date);

    const expectedClass = await tx.classes.findFirst({
      where: {
        active: true,
        club_type_id: params.clubTypeId,
        minimum_age: { lte: ageAtYearStart },
        ...this.buildClassAvailabilityWhere(params.currentYear.start_date),
      },
      orderBy: [
        { minimum_age: 'desc' },
        { display_order: 'desc' },
        { class_id: 'desc' },
      ],
      select: {
        class_id: true,
      },
    });

    if (!expectedClass) {
      throw new AppBadRequestException(ErrorCode.POST_REG_CLASS_NOT_ELIGIBLE, {
        age: ageAtYearStart,
        clubTypeId: params.clubTypeId,
      });
    }

    if (params.requestedClassId == null) {
      return expectedClass.class_id;
    }

    const selectedClass = await tx.classes.findUnique({
      where: { class_id: params.requestedClassId },
      select: {
        class_id: true,
        active: true,
        club_type_id: true,
        available_from_year: { select: { start_date: true } },
        available_until_year: { select: { start_date: true } },
      },
    });

    if (!selectedClass || !selectedClass.active) {
      throw new AppBadRequestException(ErrorCode.POST_REG_CLASS_NOT_FOUND);
    }

    const selectedClassIsAvailable = this.isClassAvailableForYear({
      targetYearStartDate: params.currentYear.start_date,
      available_from_year: selectedClass.available_from_year,
      available_until_year: selectedClass.available_until_year,
    });

    if (
      !selectedClassIsAvailable ||
      selectedClass.club_type_id !== params.clubTypeId ||
      selectedClass.class_id !== expectedClass.class_id
    ) {
      throw new AppBadRequestException(ErrorCode.POST_REG_CLASS_NOT_ELIGIBLE, {
        age: ageAtYearStart,
        requestedClassId: params.requestedClassId,
        expectedClassId: expectedClass.class_id,
        clubTypeId: params.clubTypeId,
      });
    }

    return selectedClass.class_id;
  }

  /**
   * A member must not be older than the club type they join (decision
   * 2026-11-02). The range comes from the class catalog: a club type ends one
   * year before the youngest class of the next older club type (Adventurers
   * 4-9, Pathfinders 10-15, Master Guides 16 and up, with no upper limit when
   * no older club type exists). The age is taken at the start of the
   * ecclesiastical year, like the class assignment. Being too young is
   * already rejected by `resolveClassIdForUserClubType`.
   */
  async assertAgeWithinClubTypeRange(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      clubTypeId: number;
      currentYear: ClassResolutionYear;
    },
  ): Promise<void> {
    const user = await tx.users.findUnique({
      where: { user_id: params.userId },
      select: { birthday: true },
    });
    if (!user?.birthday) {
      return;
    }

    const availability = this.buildClassAvailabilityWhere(
      params.currentYear.start_date,
    );
    const oldestClass = await tx.classes.findFirst({
      where: { active: true, club_type_id: params.clubTypeId, ...availability },
      orderBy: { minimum_age: 'desc' },
      select: { minimum_age: true },
    });
    if (!oldestClass) {
      return;
    }

    const nextClubTypeClass = await tx.classes.findFirst({
      where: {
        active: true,
        club_type_id: { not: params.clubTypeId },
        minimum_age: { gt: oldestClass.minimum_age },
        ...availability,
      },
      orderBy: { minimum_age: 'asc' },
      select: { minimum_age: true },
    });
    if (!nextClubTypeClass) {
      return;
    }

    const ageAtYearStart = ageAt(user.birthday, params.currentYear.start_date);
    const maxAge = nextClubTypeClass.minimum_age - 1;
    if (ageAtYearStart > maxAge) {
      throw new AppBadRequestException(ErrorCode.POST_REG_AGE_ABOVE_CLUB_TYPE, {
        age: ageAtYearStart,
        maxAge,
        clubTypeId: params.clubTypeId,
      });
    }
  }

  private buildClassAvailabilityWhere(
    targetYearStartDate: Date,
  ): Prisma.classesWhereInput {
    return {
      AND: [
        {
          OR: [
            { available_from_year_id: null },
            {
              available_from_year: {
                start_date: { lte: targetYearStartDate },
              },
            },
          ],
        },
        {
          OR: [
            { available_until_year_id: null },
            {
              available_until_year: {
                start_date: { gte: targetYearStartDate },
              },
            },
          ],
        },
      ],
    };
  }

  private isClassAvailableForYear(params: {
    targetYearStartDate: Date;
    available_from_year?: { start_date: Date } | null;
    available_until_year?: { start_date: Date } | null;
  }): boolean {
    const { targetYearStartDate, available_from_year, available_until_year } =
      params;

    const startsAfterFrom =
      !available_from_year ||
      available_from_year.start_date <= targetYearStartDate;
    const startsBeforeUntil =
      !available_until_year ||
      available_until_year.start_date >= targetYearStartDate;

    return startsAfterFrom && startsBeforeUntil;
  }

  ageAtDate(birthday: Date, referenceDate: Date): number {
    return ageAt(birthday, referenceDate);
  }
}
