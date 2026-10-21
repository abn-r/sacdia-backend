import { coordinator_assignment_type, type Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Canonical coordinator territory (docs/canon/runtime-coordination.md):
 * `coordinator_scope(user_id) -> club_section_ids[]`, the union of
 *  - GENERAL: every active section of active clubs in the local field;
 *  - ZONE:    active sections of `club_type_id` in the zone's districts,
 *             while the zone itself is active and only through districts that
 *             are active themselves (`districts.active`) AND actively linked
 *             to the zone (`coordination_zone_districts.active`);
 *  - SECTION: that one section, while it and its club are active.
 * One rule for every type: only ACTIVE territory grants scope (an inactive
 * zone, district, club or section contributes nothing). GENERAL does not look
 * at districts at all: it is the whole local field (the canon says "todas las
 * secciones de club del campo local").
 * The role (`coordinator`, `zone-coordinator`, `general-coordinator`) only opens
 * the door; the assignment is the authority. Never derive it from the user's
 * home local field or union.
 *
 * Lives in common/ so PermissionsGuard (CommonModule, global) can use it
 * without depending on CoordinationModule, which imports CommonModule.
 * CoordinationService delegates here: one expansion, not two.
 */
/** GLOBAL roles whose territory is the coordinator scope below. */
export const COORDINATOR_GLOBAL_ROLE_NAMES: ReadonlySet<string> = new Set([
  'coordinator',
  'zone-coordinator',
  'general-coordinator',
]);

/**
 * The permissions the user's coordinator ROLES carry (direct grants, club
 * assignments and every other global role left out: they say nothing about
 * coordinator territory). Shared by PermissionsGuard (coordinatorSections
 * routes) and the coordinator consent queue.
 */
export function coordinatorRolePermissions(
  globalRoles: ReadonlyArray<{
    role_name: string;
    permissions: readonly string[];
  }>,
): Set<string> {
  return new Set(
    globalRoles
      .filter((grant) =>
        COORDINATOR_GLOBAL_ROLE_NAMES.has(grant.role_name.toLowerCase()),
      )
      .flatMap((grant) => grant.permissions),
  );
}

export type CoordinatorScopePrisma = Pick<
  PrismaService,
  'coordinator_assignments' | 'club_sections' | 'coordination_zone_districts'
>;

export type CoordinatorAssignmentInput = {
  localFieldId: number;
  assignmentType: coordinator_assignment_type;
  zoneId?: number | null;
  clubTypeId?: number | null;
  clubSectionId?: number | null;
};

/** Assignment windows are DATE columns: compare against the UTC day. */
export function startOfUtcDay(now: Date = new Date()): Date {
  const today = new Date(now.getTime());
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

export function activeCoordinatorAssignmentWhere(
  today: Date,
): Prisma.coordinator_assignmentsWhereInput {
  return {
    active: true,
    start_date: { lte: today },
    OR: [{ end_date: null }, { end_date: { gte: today } }],
  };
}

/**
 * The ONE rule for a zone-district link to grant coverage: the link is active
 * AND the district row itself is active. Both the expansion and the targeted
 * check spell their zone-district filter from this, so they cannot diverge.
 */
export function activeZoneDistrictWhere(): Prisma.coordination_zone_districtsWhereInput {
  return { active: true, districts: { is: { active: true } } };
}

export async function resolveCoordinatorAssignmentSectionIds(
  prisma: CoordinatorScopePrisma,
  input: CoordinatorAssignmentInput,
): Promise<number[]> {
  const { localFieldId, assignmentType, zoneId, clubTypeId, clubSectionId } =
    input;

  if (assignmentType === coordinator_assignment_type.SECTION) {
    if (!clubSectionId) return [];
    const sections = await prisma.club_sections.findMany({
      where: {
        club_section_id: clubSectionId,
        active: true,
        clubs: { is: { active: true } },
      },
      select: { club_section_id: true },
    });
    return sections.map((section) => section.club_section_id);
  }

  if (assignmentType === coordinator_assignment_type.GENERAL) {
    const sections = await prisma.club_sections.findMany({
      where: {
        active: true,
        clubs: { is: { active: true, local_field_id: localFieldId } },
      },
      select: { club_section_id: true },
    });
    return sections.map((section) => section.club_section_id);
  }

  if (!zoneId || !clubTypeId) return [];

  const zoneDistricts = await prisma.coordination_zone_districts.findMany({
    where: {
      zone_id: zoneId,
      ...activeZoneDistrictWhere(),
      zone: { active: true },
    },
    select: { districlub_type_id: true },
  });

  const districtIds = zoneDistricts.map(
    (membership) => membership.districlub_type_id,
  );

  if (districtIds.length === 0) return [];

  const sections = await prisma.club_sections.findMany({
    where: {
      active: true,
      club_type_id: clubTypeId,
      clubs: {
        is: {
          active: true,
          local_field_id: localFieldId,
          districlub_type_id: { in: districtIds },
        },
      },
    },
    select: { club_section_id: true },
  });

  return sections.map((section) => section.club_section_id);
}

/**
 * The section is inside the user's coordinator scope today: ONE active
 * assignment covers it and the section itself is active. The same rule as
 * expanding every assignment (resolveCoordinatorAssignmentSectionIds) and
 * looking the section up, asked the other way round so a guarded request
 * never expands a GENERAL assignment to a whole local field. The section and
 * its club must be active for every type:
 *  - SECTION: that section;
 *  - GENERAL: the club is in the assignment's local field;
 *  - ZONE:    same, the section has the assignment's club type and the club's
 *             district is active and an active district of an ACTIVE zone
 *             (activeZoneDistrictWhere).
 * Says nothing about roles or permissions; callers gate on those first.
 * /coordination/me/scope still expands (it lists the sections).
 */
export async function coordinatorScopeIncludesSection(
  prisma: CoordinatorScopePrisma,
  userId: string,
  clubSectionId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const section = await prisma.club_sections.findFirst({
    where: { club_section_id: clubSectionId, active: true },
    select: {
      club_type_id: true,
      clubs: {
        select: {
          active: true,
          local_field_id: true,
          districlub_type_id: true,
        },
      },
    },
  });
  if (!section) return false;

  const club = section.clubs;
  if (!club?.active) return false;

  const covering: Prisma.coordinator_assignmentsWhereInput[] = [
    {
      assignment_type: coordinator_assignment_type.SECTION,
      club_section_id: clubSectionId,
    },
    {
      assignment_type: coordinator_assignment_type.GENERAL,
      local_field_id: club.local_field_id,
    },
    {
      assignment_type: coordinator_assignment_type.ZONE,
      local_field_id: club.local_field_id,
      club_type_id: section.club_type_id,
      coordination_zones: {
        is: {
          active: true,
          districts: {
            some: {
              districlub_type_id: club.districlub_type_id,
              ...activeZoneDistrictWhere(),
            },
          },
        },
      },
    },
  ];

  const match = await prisma.coordinator_assignments.findFirst({
    where: {
      user_id: userId,
      AND: [
        activeCoordinatorAssignmentWhere(startOfUtcDay(now)),
        { OR: covering },
      ],
    },
    select: { assignment_id: true },
  });
  return match !== null;
}
