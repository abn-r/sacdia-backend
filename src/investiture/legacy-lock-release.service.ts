import { Injectable } from '@nestjs/common';
import { Prisma, investiture_action_enum } from '@prisma/client';
import { pendingInvestitureAuthorization } from '../investiture-requests/investiture-request-lock';
import { PrismaService } from '../prisma/prisma.service';
import { ExactSuperAdminWritePolicy } from '../rbac/exact-super-admin-write.policy';

export const LEGACY_LOCK_RELEASE_COMMENT =
  'Bloqueo de la validación anterior liberado después del apagado (fase 8). El estado no cambia.';

/**
 * Regla del usuario: cualquier fila OPERATIONAL bloqueada que no esté INVESTIDO
 * (y sin PENDING, que se descarta aparte). Sin filtro por `active` ni por
 * estado de la cadena: una fila inactiva o REJECTED/EXPIRED también se suelta.
 */
const CANDIDATE_WHERE = {
  locked_for_validation: true,
  record_kind: 'OPERATIONAL',
  investiture_status: { not: 'INVESTIDO' },
} satisfies Prisma.enrollmentsWhereInput;

export type LegacyLockCandidate = {
  enrollment_id: number;
  user_id: string;
  class_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
};

export type LegacyLockReleaseResult = {
  dry_run: boolean;
  candidates: LegacyLockCandidate[];
  skipped_pending: number[];
  released: number[];
};

/**
 * Suelta locked_for_validation de expedientes de la vía anterior que no están
 * INVESTIDO y no tienen una persona PENDING. Una transacción por enrollment,
 * bajo el mismo candado advisory que presentar y resolver. Idempotente.
 */
@Injectable()
export class LegacyLockReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly superAdmin: ExactSuperAdminWritePolicy,
  ) {}

  async release(
    actorId: string,
    params: { dry_run?: boolean },
  ): Promise<LegacyLockReleaseResult> {
    await this.superAdmin.assert(actorId);
    const dryRun = params.dry_run ?? true;
    const candidates = await this.prisma.enrollments.findMany({
      where: CANDIDATE_WHERE,
      select: {
        enrollment_id: true,
        user_id: true,
        class_id: true,
        ecclesiastical_year_id: true,
        investiture_status: true,
      },
      orderBy: { enrollment_id: 'asc' },
    });

    const skippedPending: number[] = [];
    const released: number[] = [];
    for (const candidate of candidates) {
      if (dryRun) {
        const pending =
          await this.prisma.investiture_authorization_people.findFirst({
            where: {
              enrollment_id: candidate.enrollment_id,
              status: 'PENDING',
            },
            select: { person_id: true },
          });
        if (pending) skippedPending.push(candidate.enrollment_id);
        continue;
      }
      const outcome = await this.prisma.$transaction(async (tx) => {
        if (
          await pendingInvestitureAuthorization(tx, candidate.enrollment_id)
        ) {
          return 'pending' as const;
        }
        const updated = await tx.enrollments.updateMany({
          where: { enrollment_id: candidate.enrollment_id, ...CANDIDATE_WHERE },
          data: { locked_for_validation: false },
        });
        if (updated.count !== 1) {
          return 'unchanged' as const;
        }
        await tx.investiture_validation_history.create({
          data: {
            enrollment_id: candidate.enrollment_id,
            action: investiture_action_enum.LEGACY_LOCK_RELEASED,
            performed_by: actorId,
            comments: LEGACY_LOCK_RELEASE_COMMENT,
          },
        });
        return 'released' as const;
      });
      if (outcome === 'pending') skippedPending.push(candidate.enrollment_id);
      if (outcome === 'released') released.push(candidate.enrollment_id);
    }

    return {
      dry_run: dryRun,
      candidates,
      skipped_pending: skippedPending,
      released,
    };
  }
}
