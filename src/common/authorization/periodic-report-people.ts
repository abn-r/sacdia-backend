import type { PrismaService } from '../../prisma/prisma.service';
import {
  CLUB_DIRECTIVA_ROLES,
  directivaRoleOrder,
} from '../constants/club-directiva-roles';

/**
 * Who belonged to a club's sections during a report period (quarterly and
 * annual reports). Both queries are historical: an assignment counts when it
 * OVERLAPPED the period, active or already ended, so a past period keeps the
 * people it had. They live here because `club_role_assignments` predicates are
 * restricted to `src/common/authorization/`.
 */

/** Half-open range of DATE columns (UTC midnights): `[startDate, endExclusiveDate)`. */
export type PeriodDateRange = { startDate: Date; endExclusiveDate: Date };

export interface PeriodBoardMember {
  role: string;
  user_id: string;
  name: string;
}

function overlapWhere(sectionIds: number[], range: PeriodDateRange) {
  return {
    club_section_id: { in: sectionIds },
    start_date: { lt: range.endExclusiveDate },
    AND: [
      // status is nullable; legacy rows without one are active members.
      { OR: [{ status: { in: ['active', 'ended'] } }, { status: null }] },
      { OR: [{ end_date: null }, { end_date: { gte: range.startDate } }] },
    ],
  };
}

/** Distinct user ids with an assignment in the sections that overlaps the period. */
export async function findPeriodMemberIds(
  prisma: Pick<PrismaService, 'club_role_assignments'>,
  sectionIds: number[],
  range: PeriodDateRange,
): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const rows = await prisma.club_role_assignments.findMany({
    where: overlapWhere(sectionIds, range),
    select: { user_id: true },
    distinct: ['user_id'],
  });
  return rows.map((row) => row.user_id);
}

/**
 * Directiva of the period: every board role held at any time during it, one
 * entry per person and role, in display order.
 */
export async function findPeriodBoard(
  prisma: Pick<PrismaService, 'club_role_assignments'>,
  sectionIds: number[],
  range: PeriodDateRange,
): Promise<PeriodBoardMember[]> {
  if (sectionIds.length === 0) return [];
  const assignments = await prisma.club_role_assignments.findMany({
    where: {
      ...overlapWhere(sectionIds, range),
      roles: { role_name: { in: [...CLUB_DIRECTIVA_ROLES] } },
    },
    include: {
      users: {
        select: {
          user_id: true,
          name: true,
          paternal_last_name: true,
          maternal_last_name: true,
        },
      },
      roles: { select: { role_name: true } },
    },
  });

  const seen = new Set<string>();
  const board: PeriodBoardMember[] = [];
  for (const a of assignments) {
    const key = `${a.users.user_id}:${a.roles.role_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    board.push({
      role: a.roles.role_name,
      user_id: a.users.user_id,
      name: [
        a.users.name,
        a.users.paternal_last_name,
        a.users.maternal_last_name,
      ]
        .filter(Boolean)
        .join(' '),
    });
  }
  board.sort((a, b) => directivaRoleOrder(a.role) - directivaRoleOrder(b.role));
  return board;
}
