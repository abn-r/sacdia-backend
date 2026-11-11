import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClubRole } from '../common/authorization/roles';
import { clubTypeSectionKind, type SectionKind } from './section-display';
import {
  SERVICE_ROLE_NAMES,
  isServiceRoleName,
  type ServiceRoleName,
} from './club-role-rules';

type Db = Prisma.TransactionClient | PrismaService;

/** Member statuses that count as "enrolled in GM this year" (D1). */
export const GM_ENROLLED_STATUSES = ['active', 'pending'] as const;
/** Member statuses that make a person part of the GM base set. */
export const GM_BASE_STATUSES = ['active', 'pending', 'inactive'] as const;

/**
 * The ONE predicate for "holds an active service role": shared by the
 * candidate list, the slots and the assignment POST so none diverges.
 * Ended-at-or-after-today rows still count; future starts count too (the
 * slot validation of the POST peaks over the same overlap).
 */
export function activeAssignmentWhere(
  today: Date,
): Prisma.club_role_assignmentsWhereInput {
  return {
    active: true,
    status: 'active',
    OR: [{ end_date: null }, { end_date: { gte: today } }],
  };
}

function utcToday(now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** The club's enabled Guias Mayores section, or null. */
export async function findClubGmSectionId(
  db: Db,
  clubId: number,
): Promise<number | null> {
  const sections = await db.club_sections.findMany({
    where: { main_club_id: clubId, active: true },
    select: { club_section_id: true, club_types: { select: { name: true } } },
    orderBy: { club_section_id: 'asc' },
  });
  const gm = sections.find(
    (section) => clubTypeSectionKind(section.club_types?.name) === 'GM',
  );
  return gm?.club_section_id ?? null;
}

export type GmMemberRow = {
  user_id: string;
  ecclesiastical_year_id: number;
  status: string | null;
};

/** `member` rows of the GM section for the given years and users. */
export async function findGmMemberRows(
  db: Db,
  params: {
    gmSectionId: number;
    yearIds: number[];
    statuses: readonly string[];
    userWhere?: Prisma.usersWhereInput;
    userIds?: string[];
  },
): Promise<GmMemberRow[]> {
  return db.club_role_assignments.findMany({
    where: {
      club_section_id: params.gmSectionId,
      ecclesiastical_year_id: { in: params.yearIds },
      active: true,
      status: { in: [...params.statuses] },
      roles: { role_name: ClubRole.MEMBER, role_category: 'CLUB' },
      ...(params.userIds ? { user_id: { in: params.userIds } } : {}),
      ...(params.userWhere ? { users: params.userWhere } : {}),
    },
    select: { user_id: true, ecclesiastical_year_id: true, status: true },
  });
}

export type NonMemberAssignmentRow = {
  user_id: string;
  ecclesiastical_year_id: number;
  club_section_id: number | null;
  status: string | null;
  active: boolean;
  end_date: Date | null;
  roles: { role_name: string };
  club_sections: {
    club_section_id: number;
    club_type_id: number | null;
    club_types: { name: string } | null;
  } | null;
  ecclesiastical_year: { start_date: Date; end_date: Date };
};

/**
 * Every non-member, non-rejected assignment of the users in ANY section of the
 * club (history included): current roles and `service_years` come from it.
 */
export async function findClubNonMemberAssignments(
  db: Db,
  params: { clubId: number; userIds: string[] },
): Promise<NonMemberAssignmentRow[]> {
  if (params.userIds.length === 0) return [];
  return db.club_role_assignments.findMany({
    where: {
      user_id: { in: params.userIds },
      club_sections: { main_club_id: params.clubId },
      status: { in: ['active', 'ended'] },
      roles: { role_name: { not: ClubRole.MEMBER }, role_category: 'CLUB' },
    },
    select: {
      user_id: true,
      ecclesiastical_year_id: true,
      club_section_id: true,
      status: true,
      active: true,
      end_date: true,
      roles: { select: { role_name: true } },
      club_sections: {
        select: {
          club_section_id: true,
          club_type_id: true,
          club_types: { select: { name: true } },
        },
      },
      ecclesiastical_year: { select: { start_date: true, end_date: true } },
    },
  });
}

export type SectionOccupancyRow = {
  user_id: string;
  roles: { role_name: string };
  users: { name: string | null; paternal_last_name: string | null } | null;
};

/** Active holders of the service roles of one section for one year. */
export async function findSectionServiceHolders(
  db: Db,
  params: { sectionId: number; yearId: number; now?: Date },
): Promise<SectionOccupancyRow[]> {
  return db.club_role_assignments.findMany({
    where: {
      club_section_id: params.sectionId,
      ecclesiastical_year_id: params.yearId,
      ...activeAssignmentWhere(utcToday(params.now)),
      roles: {
        role_name: { in: [...SERVICE_ROLE_NAMES] },
        role_category: 'CLUB',
      },
    },
    select: {
      user_id: true,
      roles: { select: { role_name: true } },
      users: { select: { name: true, paternal_last_name: true } },
    },
    orderBy: { start_date: 'asc' },
  });
}

/**
 * Assignment-side enforcement of the candidate rules (D1 and D4), run inside
 * the POST transaction right before the write. Only service roles are checked:
 *  - CLUB_ROLE_ALREADY_HELD: the person already holds an active service role in
 *    this section and year (the same role again, or a second one).
 *  - CLUB_ROLE_GM_MEMBERSHIP_REQUIRED: in an AV/CQ section the person must be
 *    an active or pending `member` of the club's GM section THIS year.
 */
export async function assertServiceRoleAssignable(
  db: Db,
  params: {
    userId: string;
    roleName: string;
    clubSectionId: number;
    assignmentYearId: number;
    currentYearId: number;
    /** The assignment being edited (PATCH): not a duplicate of itself. */
    excludeAssignmentId?: string;
    now?: Date;
  },
): Promise<void> {
  if (!isServiceRoleName(params.roleName)) return;

  const section = await db.club_sections.findUnique({
    where: { club_section_id: params.clubSectionId },
    select: { main_club_id: true, club_types: { select: { name: true } } },
  });
  if (!section || section.main_club_id == null) return;
  const kind: SectionKind = clubTypeSectionKind(section.club_types?.name);

  if (kind === 'AV' || kind === 'CQ') {
    const gmSectionId = await findClubGmSectionId(db, section.main_club_id);
    const rows = gmSectionId
      ? await findGmMemberRows(db, {
          gmSectionId,
          yearIds: [params.currentYearId],
          statuses: GM_ENROLLED_STATUSES,
          userIds: [params.userId],
        })
      : [];
    if (rows.length === 0) {
      throw new AppConflictException(
        ErrorCode.CLUB_ROLE_GM_MEMBERSHIP_REQUIRED,
      );
    }
  }

  const held = await db.club_role_assignments.count({
    where: {
      user_id: params.userId,
      club_section_id: params.clubSectionId,
      ecclesiastical_year_id: params.assignmentYearId,
      ...(params.excludeAssignmentId
        ? { assignment_id: { not: params.excludeAssignmentId } }
        : {}),
      ...activeAssignmentWhere(utcToday(params.now)),
      roles: {
        role_name: { in: [...SERVICE_ROLE_NAMES] },
        role_category: 'CLUB',
      },
    },
  });
  if (held > 0) {
    throw new AppConflictException(ErrorCode.CLUB_ROLE_ALREADY_HELD);
  }
}

export type { ServiceRoleName };
