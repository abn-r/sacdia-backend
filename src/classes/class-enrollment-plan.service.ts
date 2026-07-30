import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AppBadRequestException,
  AppConflictException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClassProgressionResolver } from './class-progression-resolver.service';

export type ClassEnrollmentPlan = {
  source_enrollment_id: number | null;
  source_class_id: number | null;
  target_class_id: number;
  transition_kind: 'SAME_TRACK' | 'CROSSOVER' | null;
};

@Injectable()
export class ClassEnrollmentPlanService {
  constructor(private readonly progressionResolver: ClassProgressionResolver) {}

  async resolveSource(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      targetClassId: number;
      targetYearStart: Date;
    },
  ): Promise<ClassEnrollmentPlan> {
    const candidates = await tx.enrollments.findMany({
      where: {
        user_id: params.userId,
        ecclesiastical_year: {
          start_date: { lt: params.targetYearStart },
        },
      },
      select: {
        enrollment_id: true,
        class_id: true,
        enrollment_date: true,
        ecclesiastical_year: { select: { start_date: true } },
      },
      orderBy: [
        { ecclesiastical_year: { start_date: 'desc' } },
        { enrollment_date: 'desc' },
        { enrollment_id: 'desc' },
      ],
    });

    if (candidates.length === 0) {
      await this.progressionResolver.resolvePredecessor(
        tx,
        params.targetClassId,
        params.targetYearStart,
      );
      return this.emptyPlan(params.targetClassId);
    }

    const sourceClassIds = [...new Set(candidates.map((row) => row.class_id))];
    const matchingClassIds: number[] = [];
    for (const sourceClassId of sourceClassIds) {
      const next = await this.progressionResolver.resolveNext(
        tx,
        sourceClassId,
        params.targetYearStart,
      );
      if (next?.class_id === params.targetClassId) {
        matchingClassIds.push(sourceClassId);
      }
    }

    if (matchingClassIds.length > 1) {
      throw new AppConflictException(ErrorCode.CLASS_ENROLLMENT_AMBIGUOUS);
    }
    if (matchingClassIds.length === 0) {
      throw new AppBadRequestException(ErrorCode.CLASS_LEVEL_TOO_HIGH);
    }

    const source = candidates.find(
      (candidate) => candidate.class_id === matchingClassIds[0],
    )!;
    const transitionKind = await this.progressionResolver.resolveTransition(
      tx,
      source.class_id,
      params.targetClassId,
      params.targetYearStart,
    );

    return {
      source_enrollment_id: source.enrollment_id,
      source_class_id: source.class_id,
      target_class_id: params.targetClassId,
      transition_kind: transitionKind,
    };
  }

  private emptyPlan(targetClassId: number): ClassEnrollmentPlan {
    return {
      source_enrollment_id: null,
      source_class_id: null,
      target_class_id: targetClassId,
      transition_kind: null,
    };
  }
}
