import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppForbiddenException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';

export type ClassPolicyMode = 'annual' | 'explicit';

export type ClassPolicyDecision =
  | { kind: 'ok' }
  | { kind: 'policy_blocked'; code: ErrorCode }
  | { kind: 'configuration_error'; code: ErrorCode };

const GUIDE_MAJOR_NAME_FILTER = { contains: 'uía', mode: 'insensitive' as const };

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ClassEnrollmentPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ecclesiasticalYear: EcclesiasticalYearService,
  ) {}

  async evaluate(
    tx: DbClient,
    params: {
      userId: string;
      classId: number;
      year: { year_id: number; start_date: Date; end_date?: Date };
      mode: ClassPolicyMode;
    },
  ): Promise<ClassPolicyDecision> {
    const targetClass = await tx.classes.findUnique({
      where: { class_id: params.classId },
      select: {
        class_id: true,
        club_type_id: true,
        display_order: true,
        active: true,
        minimum_age: true,
        requires_invested_gm: true,
        max_duration_years: true,
        available_from_year: { select: { start_date: true } },
        available_until_year: { select: { start_date: true } },
      },
    });

    if (!targetClass || targetClass.active === false) {
      return { kind: 'policy_blocked', code: ErrorCode.CLASS_NOT_FOUND };
    }

    if (params.mode === 'annual' && targetClass.max_duration_years > 1) {
      return {
        kind: 'configuration_error',
        code: ErrorCode.ANNUAL_CLASS_POLICY_UNRESOLVED,
      };
    }

    const startsAfterFrom =
      !targetClass.available_from_year ||
      targetClass.available_from_year.start_date <= params.year.start_date;
    const startsBeforeUntil =
      !targetClass.available_until_year ||
      targetClass.available_until_year.start_date >= params.year.start_date;
    if (!startsAfterFrom || !startsBeforeUntil) {
      return {
        kind: 'policy_blocked',
        code: ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR,
      };
    }

    if (targetClass.requires_invested_gm) {
      const hasInvestiture = await tx.enrollments.findFirst({
        where: {
          user_id: params.userId,
          investiture_status: 'INVESTIDO',
          classes: { club_types: { name: GUIDE_MAJOR_NAME_FILTER } },
        },
        select: { enrollment_id: true },
      });
      if (!hasInvestiture) {
        return {
          kind: 'policy_blocked',
          code: ErrorCode.CLASS_GM_INVESTITURE_REQUIRED,
        };
      }
    }

    const prerequisites = await tx.class_prerequisites.findMany({
      where: { class_id: params.classId, active: true },
      include: {
        prerequisite: {
          select: { class_id: true, club_type_id: true, display_order: true },
        },
      },
    });

    if (prerequisites.length > 0) {
      const predecessor = await tx.classes.findFirst({
        where: {
          club_type_id: targetClass.club_type_id,
          display_order: { lt: targetClass.display_order },
          active: true,
        },
        orderBy: { display_order: 'desc' },
        select: { class_id: true, club_type_id: true, display_order: true },
      });

      const independentIds = prerequisites
        .filter((row) => {
          if (params.mode !== 'annual') return true;
          return row.prerequisite_class_id !== predecessor?.class_id;
        })
        .map((row) => row.prerequisite_class_id);

      if (independentIds.length > 0) {
        const invested = await tx.enrollments.findMany({
          where: {
            user_id: params.userId,
            investiture_status: 'INVESTIDO',
            class_id: { in: independentIds },
          },
          select: { class_id: true },
        });
        const investedSet = new Set(invested.map((row) => row.class_id));
        if (independentIds.some((id) => !investedSet.has(id))) {
          return {
            kind: 'policy_blocked',
            code: ErrorCode.CLASS_PREREQUISITE_NOT_MET,
          };
        }
      }
    }

    return { kind: 'ok' };
  }

  async assertOperationalYearWrite(enrollmentYearId: number): Promise<void> {
    const current = await this.ecclesiasticalYear.getCurrentYear();
    if (current.year_id !== enrollmentYearId) {
      throw new AppForbiddenException(ErrorCode.CLASS_PROGRESS_YEAR_NOT_OPERATIONAL);
    }
  }
}
