import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClassEnrollmentPlanService,
  type ClassEnrollmentPlan,
} from './class-enrollment-plan.service';

type EnrollmentWriteContext = {
  tx: Prisma.TransactionClient;
  plan: ClassEnrollmentPlan;
  targetClass: {
    class_id: number;
    club_type_id: number;
    active: boolean;
    available_from_year: { start_date: Date } | null;
    available_until_year: { start_date: Date } | null;
  };
  targetYear: { year_id: number; start_date: Date; end_date: Date };
};

@Injectable()
export class ClassEnrollmentWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: ClassEnrollmentPlanService,
  ) {}

  async execute<T>(
    params: {
      userId: string;
      targetClassId: number;
      ecclesiasticalYearId: number;
      poolClubTypeIds: number[];
    },
    write: (context: EnrollmentWriteContext) => Promise<T>,
  ): Promise<T> {
    const poolIds = this.normalizePool(params.poolClubTypeIds);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lockIdentity =
            `class-enrollment:${params.userId}:` +
            `${params.ecclesiasticalYearId}:pool:${poolIds.join(',')}`;
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`,
          );

          const targetYear = await tx.ecclesiastical_years.findUnique({
            where: { year_id: params.ecclesiasticalYearId },
            select: {
              year_id: true,
              start_date: true,
              end_date: true,
            },
          });
          if (!targetYear) {
            throw new AppNotFoundException(
              ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND,
            );
          }

          const targetClass = await tx.classes.findUnique({
            where: { class_id: params.targetClassId },
            select: {
              class_id: true,
              club_type_id: true,
              active: true,
              available_from_year: { select: { start_date: true } },
              available_until_year: { select: { start_date: true } },
            },
          });
          if (!targetClass?.active) {
            throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
          }
          if (
            (targetClass.available_from_year?.start_date ??
              targetYear.start_date) > targetYear.start_date ||
            (targetClass.available_until_year?.start_date ??
              targetYear.start_date) < targetYear.start_date
          ) {
            throw new AppBadRequestException(
              ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR,
            );
          }
          if (!poolIds.includes(targetClass.club_type_id)) {
            throw new AppBadRequestException(
              ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
            );
          }

          const plan = await this.planner.resolveSource(tx, {
            userId: params.userId,
            targetClassId: params.targetClassId,
            targetYearStart: targetYear.start_date,
          });
          return write({ tx, plan, targetClass, targetYear });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') {
        throw new AppConflictException(ErrorCode.CLASS_ALREADY_ENROLLED);
      }
      if (code === 'P2034') {
        throw new AppConflictException(ErrorCode.INVESTITURE_CONCURRENT_UPDATE);
      }
      throw error;
    }
  }

  private normalizePool(poolIds: number[]): number[] {
    const normalized = [...new Set(poolIds)].sort(
      (left, right) => left - right,
    );
    if (
      normalized.length === 0 ||
      normalized.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
      );
    }
    return normalized;
  }
}
