import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
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
    formative_program_type: 'STANDARD' | 'GUIDE_MAJOR';
    requires_invested_gm: boolean;
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
    const userId = this.normalizeUserId(params.userId);
    const poolIds = this.normalizePool(params.poolClubTypeIds);
    let targetProgram: 'STANDARD' | 'GUIDE_MAJOR' | null = null;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const lockIdentity =
            `class-enrollment:${userId}:` +
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
              formative_program_type: true,
              requires_invested_gm: true,
              available_from_year: { select: { start_date: true } },
              available_until_year: { select: { start_date: true } },
            },
          });
          if (!targetClass?.active) {
            throw new AppNotFoundException(ErrorCode.CLASS_NOT_FOUND);
          }
          targetProgram = targetClass.formative_program_type;
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
            userId,
            targetClassId: params.targetClassId,
            targetYearStart: targetYear.start_date,
          });
          return write({ tx, plan, targetClass, targetYear });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      const code = (error as { code?: string }).code;
      if (
        targetProgram &&
        code === 'P2010' &&
        this.matchesCapacityViolation(error)
      ) {
        throw new AppConflictException(
          targetProgram === 'GUIDE_MAJOR'
            ? ErrorCode.CLASS_MAX_GM_ACTIVE
            : ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE,
        );
      }
      if (code === 'P2002') {
        const targetMatch = this.matchesEnrollmentUnique(error);
        const winner =
          targetMatch === null
            ? await this.prisma.enrollments.findUnique({
                where: {
                  user_id_class_id_ecclesiastical_year_id: {
                    user_id: userId,
                    class_id: params.targetClassId,
                    ecclesiastical_year_id: params.ecclesiasticalYearId,
                  },
                },
                select: { enrollment_id: true },
              })
            : null;
        if (targetMatch || winner) {
          throw new AppConflictException(ErrorCode.CLASS_ALREADY_ENROLLED);
        }
        throw error;
      }
      if (code === 'P2034') {
        throw new AppConflictException(ErrorCode.INVESTITURE_CONCURRENT_UPDATE);
      }
      throw error;
    }
  }
  private normalizeUserId(userId: string): string {
    const normalized = userId.toLowerCase();
    if (!isUUID(normalized)) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
      );
    }
    return normalized;
  }
  private normalizePool(poolIds: number[]): number[] {
    if (
      poolIds.length === 0 ||
      poolIds.some((id) => !Number.isInteger(id) || id <= 0)
    ) {
      throw new AppBadRequestException(
        ErrorCode.CLASS_PROGRESSION_CONFIG_INVALID,
      );
    }
    return [...new Set(poolIds)].sort((left, right) => left - right);
  }
  private matchesEnrollmentUnique(error: unknown): boolean | null {
    const record = this.asRecord(error);
    const meta = this.asRecord(record?.meta);
    const adapter = this.asRecord(meta?.driverAdapterError);
    const cause = this.asRecord(adapter?.cause);
    const target = meta?.target ?? meta?.constraint ?? cause?.constraint;
    if (target === undefined || target === null) return null;
    const constraint = this.asRecord(target);
    const index =
      typeof target === 'string'
        ? target
        : typeof constraint?.index === 'string'
          ? constraint.index
          : null;
    if (index) {
      return (
        index === 'enrollments_user_id_class_id_ecclesiastical_year_id_key'
      );
    }
    const fields = Array.isArray(target)
      ? target
      : Array.isArray(constraint?.fields)
        ? constraint.fields
        : null;
    if (!fields?.every((field) => typeof field === 'string')) return false;
    const normalized = fields.map((field) => field.replaceAll('"', ''));
    return (
      normalized.length === 3 &&
      ['user_id', 'class_id', 'ecclesiastical_year_id'].every((field) =>
        normalized.includes(field),
      )
    );
  }
  private matchesCapacityViolation(error: unknown): boolean {
    const record = this.asRecord(error);
    const meta = this.asRecord(record?.meta);
    const cause = this.asRecord(this.asRecord(meta?.driverAdapterError)?.cause);
    return (
      cause?.code === '23514' &&
      cause.detail === 'SACDIA_ENROLLMENT_PROGRAM_CAPACITY'
    );
  }
  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }
}
