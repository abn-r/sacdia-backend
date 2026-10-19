import type { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { lockDependent } from '../guardianships/guardianship-queries';

/**
 * The ONE rule every write that makes a `club_role_assignments` row ACTIVE must
 * pass (family-profiles FP-39/C7, verify 2c C1/C2): a dependent (a user with a
 * `dependent_profiles` row) needs a VERIFIED guardian consent. Adults, including
 * self-registered teenagers, are never gated.
 *
 * - Call it with the SAME transaction client that writes the assignment, right
 *   before the write, so a consent revoked meanwhile blocks the activation.
 * - For dependents it takes the per-dependent advisory lock (the one verify,
 *   revoke, leave and evidence upload take), so an activation and a consent
 *   change are serialized instead of racing under READ COMMITTED.
 * - Rows with `is_test_data` never count (FP-03); a revoked row is never
 *   `verified` (DB check `guardianships_revoked_ck`).
 *
 * The guard spec `assignment-activation-gate.inventory.spec.ts` fails when a
 * new activating write does not call one of these helpers.
 */
export async function isAssignmentActivationAllowed(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const profile = await tx.dependent_profiles.findUnique({
    where: { user_id: userId },
    select: { user_id: true },
  });
  if (!profile) return true;

  await lockDependent(tx, userId);

  const verified = await tx.guardianships.findFirst({
    where: {
      dependent_user_id: userId,
      consent_status: 'verified',
      is_test_data: false,
    },
    select: { guardianship_id: true },
  });
  return verified !== null;
}

/**
 * Throwing form of {@link isAssignmentActivationAllowed}: 409
 * MR_CONSENT_NOT_VERIFIED for a dependent without verified consent.
 */
export async function assertAssignmentActivationAllowed(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  if (!(await isAssignmentActivationAllowed(tx, userId))) {
    throw new AppConflictException(ErrorCode.MR_CONSENT_NOT_VERIFIED);
  }
}
