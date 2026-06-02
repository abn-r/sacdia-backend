import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppBadRequestException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

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

    const ageAtYearStart = this.calculateAgeAtDate(
      user.birthday,
      params.currentYear.start_date,
    );

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

  private calculateAgeAtDate(birthday: Date, referenceDate: Date): number {
    let age = referenceDate.getUTCFullYear() - birthday.getUTCFullYear();
    const monthDiff = referenceDate.getUTCMonth() - birthday.getUTCMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && referenceDate.getUTCDate() < birthday.getUTCDate())
    ) {
      age--;
    }

    return age;
  }
}
