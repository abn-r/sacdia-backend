import { Prisma } from '@prisma/client';

/**
 * Club role assignments that still hold a role: active or pending, not ended
 * and not expired. Future start dates count, because the person already holds
 * the role once it begins.
 *
 * Shared by the role usage count (which blocks deactivating a role) and the
 * admin users list filtered by role, so "N people" and the list linked from it
 * show the same people. This is a holder rule, not an authority rule: pending
 * and future assignments grant nothing (see ClubAssignmentEffectivityPolicy).
 */
export const ROLE_HOLDER_ASSIGNMENT_STATUSES = ['active', 'pending'] as const;

export function roleHolderAssignmentWhere(
  now: Date = new Date(),
): Prisma.club_role_assignmentsWhereInput {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return {
    active: true,
    status: { in: [...ROLE_HOLDER_ASSIGNMENT_STATUSES] },
    AND: [
      { OR: [{ end_date: null }, { end_date: { gte: today } }] },
      { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
    ],
  };
}
