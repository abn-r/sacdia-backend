import type { Prisma } from '@prisma/client';

/** A pending request closed by {@link cancelPendingRequestsOfUsers}. */
export interface CancelledPendingRequest {
  assignment_id: string;
  user_id: string;
  club_section_id: number | null;
}

/**
 * Cancels the PENDING membership requests of `userIds` with the same write
 * `MembershipRequestsService.cancelPendingForUser` does (status 'cancelled',
 * active=false, expires_at cleared, end_date and modified_at = `now`), so the
 * row leaves every pending list and nothing can approve it.
 *
 * Runs on the caller's transaction (the dependent purge, the one-off cleanup
 * script). The status guard sits in the WHERE clause: a row that was approved
 * or rejected meanwhile is left alone. Returns the rows it closed.
 */
export async function cancelPendingRequestsOfUsers(
  tx: Prisma.TransactionClient,
  userIds: string[],
  now: Date,
): Promise<CancelledPendingRequest[]> {
  if (userIds.length === 0) return [];
  return tx.club_role_assignments.updateManyAndReturn({
    where: { user_id: { in: userIds }, status: 'pending', active: true },
    data: {
      status: 'cancelled',
      active: false,
      expires_at: null,
      end_date: now,
      modified_at: now,
    },
    select: { assignment_id: true, user_id: true, club_section_id: true },
  });
}

/** A live assignment closed by {@link endLiveAssignmentsOfUsers}. */
export interface EndedLiveAssignment {
  assignment_id: string;
  user_id: string;
  club_section_id: number | null;
}

/**
 * Ends every LIVE assignment of `userIds`, whatever its role: status 'active'
 * or 'inactive' with active=true. Same shape every other "end" write uses
 * (`removeRoleAssignment`, year-cut): status 'ended', active=false, end_date
 * and modified_at = `now`.
 *
 * Used by the dependent purge (a purged child must not stay in a section's
 * member list) and the one-off cleanup script. Pending requests are NOT
 * touched here: {@link cancelPendingRequestsOfUsers} closes them as
 * 'cancelled'. The status guard sits in the WHERE clause. Returns the rows it
 * closed.
 */
export async function endLiveAssignmentsOfUsers(
  tx: Prisma.TransactionClient,
  userIds: string[],
  now: Date,
): Promise<EndedLiveAssignment[]> {
  if (userIds.length === 0) return [];
  return tx.club_role_assignments.updateManyAndReturn({
    where: {
      user_id: { in: userIds },
      status: { in: ['active', 'inactive'] },
      active: true,
    },
    data: {
      status: 'ended',
      active: false,
      end_date: now,
      modified_at: now,
    },
    select: { assignment_id: true, user_id: true, club_section_id: true },
  });
}
