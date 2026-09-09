import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export type EnrollmentIfExists = 'return' | 'conflict';

/**
 * Persistencia de `enrollments` reutilizable dentro de una transacción.
 * La inscripción anual por directiva usa `ifExists: 'return'` y `crossType: false`.
 * `POST /users/:userId/classes/enroll` conserva su motor de límites R12/pool;
 * este writer no crea `club_role_assignments`.
 */

export type UpsertEnrollmentResult = {
  enrollment_id: number;
  created: boolean;
};

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ClassEnrollmentWriter {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    tx: DbClient,
    params: {
      userId: string;
      classId: number;
      ecclesiasticalYearId: number;
      crossType: boolean;
      ifExists: EnrollmentIfExists;
    },
  ): Promise<UpsertEnrollmentResult> {
    const existing = await tx.enrollments.findUnique({
      where: {
        user_id_class_id_ecclesiastical_year_id: {
          user_id: params.userId,
          class_id: params.classId,
          ecclesiastical_year_id: params.ecclesiasticalYearId,
        },
      },
      select: {
        enrollment_id: true,
        active: true,
        cross_type_enrollment: true,
      },
    });

    if (existing) {
      if (params.ifExists === 'conflict' && existing.active) {
        throw new AppConflictException(ErrorCode.CLASS_ALREADY_ENROLLED);
      }

      if (!existing.active) {
        await tx.enrollments.update({
          where: { enrollment_id: existing.enrollment_id },
          data: {
            active: true,
            cross_type_enrollment: params.crossType,
          },
        });
      }

      return { enrollment_id: existing.enrollment_id, created: false };
    }

    try {
      const created = await tx.enrollments.create({
        data: {
          user_id: params.userId,
          class_id: params.classId,
          ecclesiastical_year_id: params.ecclesiasticalYearId,
          cross_type_enrollment: params.crossType,
        },
        select: { enrollment_id: true },
      });
      return { enrollment_id: created.enrollment_id, created: true };
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
      const recovered = await tx.enrollments.findUnique({
        where: {
          user_id_class_id_ecclesiastical_year_id: {
            user_id: params.userId,
            class_id: params.classId,
            ecclesiastical_year_id: params.ecclesiasticalYearId,
          },
        },
        select: { enrollment_id: true },
      });
      if (!recovered) {
        throw error;
      }
      return { enrollment_id: recovered.enrollment_id, created: false };
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }
}
