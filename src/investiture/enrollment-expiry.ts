import {
  investiture_action_enum,
  investiture_status_enum,
  Prisma,
} from '@prisma/client';
import { pendingInvestitureAuthorization } from '../investiture-requests/investiture-request-lock';

export const EXPIRABLE_STATUSES: investiture_status_enum[] = [
  investiture_status_enum.IN_PROGRESS,
  investiture_status_enum.REJECTED,
];

/**
 * Moves overdue enrollments to EXPIRED inside the caller's transaction and
 * writes the validation-history audit rows. Shared by the manual overdue sweep
 * and the multi-year continuation (past max_duration_years without investiture).
 *
 * Skips enrollments with a pending investiture authorization (locked) and any
 * row that is no longer expirable. Returns the ids actually expired, so callers
 * can tell which ones were skipped.
 */
export async function expireEnrollmentsInTx(
  tx: Prisma.TransactionClient,
  params: { enrollmentIds: number[]; actorId: string; comments: string },
): Promise<number[]> {
  const stillExpirable = await tx.enrollments.findMany({
    where: {
      enrollment_id: { in: params.enrollmentIds },
      active: true,
      record_kind: 'OPERATIONAL',
      investiture_status: { in: EXPIRABLE_STATUSES },
    },
    select: { enrollment_id: true },
  });
  const revalidatedIds: number[] = [];
  for (const enrollment of [...stillExpirable].sort(
    (left, right) => left.enrollment_id - right.enrollment_id,
  )) {
    if (await pendingInvestitureAuthorization(tx, enrollment.enrollment_id)) {
      continue;
    }
    revalidatedIds.push(enrollment.enrollment_id);
  }

  if (revalidatedIds.length === 0) {
    return [];
  }

  const now = new Date();
  const updateResult = await tx.enrollments.updateMany({
    where: {
      enrollment_id: { in: revalidatedIds },
      active: true,
      record_kind: 'OPERATIONAL',
      investiture_status: { in: EXPIRABLE_STATUSES },
    },
    data: {
      investiture_status: investiture_status_enum.EXPIRED,
      validated_by: params.actorId,
      validated_at: now,
      locked_for_validation: false,
      submitted_for_validation: false,
      rejection_reason: null,
    },
  });

  let auditIds = revalidatedIds;
  if (updateResult.count !== revalidatedIds.length) {
    const actuallyExpired = await tx.enrollments.findMany({
      where: {
        enrollment_id: { in: revalidatedIds },
        investiture_status: investiture_status_enum.EXPIRED,
        validated_by: params.actorId,
        validated_at: now,
      },
      select: { enrollment_id: true },
    });
    auditIds = actuallyExpired.map((enrollment) => enrollment.enrollment_id);
  }

  if (auditIds.length === 0) {
    return [];
  }

  await tx.investiture_validation_history.createMany({
    data: auditIds.map((enrollmentId) => ({
      enrollment_id: enrollmentId,
      action: investiture_action_enum.EXPIRED,
      performed_by: params.actorId,
      comments: params.comments,
    })),
  });

  return auditIds;
}
