import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { LIVE_ASSIGNMENT_STATUSES } from './guardianships.constants';
import type { DependentClubMembership } from './guardianships.types';

export type Db = Prisma.TransactionClient | PrismaService;

/** Rows that still count: not revoked. */
export const NOT_REVOKED = { consent_status: { not: 'revoked' } } as const;

/**
 * A real person who can act for the dependent: an account holder, not a club
 * custody row, not an external name, not seeded test data.
 */
export const ACTIVE_USER_GUARDIAN = {
  ...NOT_REVOKED,
  is_custodian: false,
  is_test_data: false,
  guardian_user_id: { not: null },
} as const satisfies Prisma.guardianshipsWhereInput;

export function displayName(
  user: { name: string | null; paternal_last_name: string | null } | null,
): string {
  if (!user) return '';
  return [user.name, user.paternal_last_name]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(' ');
}

/** Number of active user guardians of a dependent. */
export async function countActiveGuardians(
  db: Db,
  dependentId: string,
): Promise<number> {
  return db.guardianships.count({
    where: { dependent_user_id: dependentId, ...ACTIVE_USER_GUARDIAN },
  });
}

export interface LiveAssignment {
  assignmentId: string;
  clubSectionId: number;
  /** Null when the section has no main club; custody needs a club. */
  clubId: number | null;
}

/**
 * The dependent's current club membership (active first, then the newest
 * pending request). Drives club custody when the last guardian leaves.
 */
export async function findLiveAssignment(
  db: Db,
  dependentId: string,
): Promise<LiveAssignment | null> {
  const rows = await db.club_role_assignments.findMany({
    where: {
      user_id: dependentId,
      active: true,
      status: { in: [...LIVE_ASSIGNMENT_STATUSES] },
      club_section_id: { not: null },
    },
    orderBy: { created_at: 'desc' },
    select: {
      assignment_id: true,
      status: true,
      club_section_id: true,
      club_sections: { select: { main_club_id: true } },
    },
  });
  if (rows.length === 0) return null;
  const chosen = rows.find((row) => row.status === 'active') ?? rows[0];
  return {
    assignmentId: chosen.assignment_id,
    clubSectionId: chosen.club_section_id as number,
    clubId: chosen.club_sections?.main_club_id ?? null,
  };
}

/** Is this dependent an active/pending member of THIS section? (claim codes) */
export async function hasLiveAssignmentInSection(
  db: Db,
  dependentId: string,
  clubSectionId: number,
): Promise<boolean> {
  const found = await db.club_role_assignments.findFirst({
    where: {
      user_id: dependentId,
      club_section_id: clubSectionId,
      active: true,
      status: { in: [...LIVE_ASSIGNMENT_STATUSES] },
    },
    select: { assignment_id: true },
  });
  return found !== null;
}

const CLUB_MEMBERSHIP_STATUSES = [
  'pending',
  'active',
  'rejected',
  'expired',
  'cancelled',
] as const;

/**
 * One batched query for every dependent. Membership HISTORY is read on purpose
 * (rejected/expired/cancelled show the guardian what happened), and a live
 * membership wins over older history. Never used to grant authority.
 */
export async function loadClubMemberships(
  db: Db,
  dependentIds: string[],
): Promise<Map<string, DependentClubMembership>> {
  const assignments = await db.club_role_assignments.findMany({
    where: {
      user_id: { in: dependentIds },
      club_section_id: { not: null },
      status: { in: [...CLUB_MEMBERSHIP_STATUSES] },
    },
    orderBy: { created_at: 'desc' },
    select: {
      assignment_id: true,
      user_id: true,
      status: true,
      club_section_id: true,
      club_sections: {
        select: {
          clubs: { select: { name: true } },
          club_types: { select: { name: true } },
        },
      },
    },
  });

  const result = new Map<string, DependentClubMembership>();
  const isLive = (status: string | null) =>
    status === 'active' || status === 'pending';
  for (const assignment of assignments) {
    const current = result.get(assignment.user_id);
    const candidate: DependentClubMembership = {
      assignment_id: assignment.assignment_id,
      status: assignment.status as DependentClubMembership['status'],
      club_section_id: assignment.club_section_id as number,
      club_name: assignment.club_sections?.clubs?.name ?? null,
      club_type_name: assignment.club_sections?.club_types?.name ?? null,
    };
    // Newest first: keep it unless an older row is live and ours is history.
    if (!current || (!isLive(current.status) && isLive(assignment.status))) {
      result.set(assignment.user_id, candidate);
    }
  }
  return result;
}
