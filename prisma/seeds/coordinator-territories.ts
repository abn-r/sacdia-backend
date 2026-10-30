/**
 * Coordinator territories for the test users.
 *
 * A coordinator role only opens the coordination surface; the territory comes
 * from `coordinator_assignments` (docs/canon/runtime-coordination.md). Without
 * an active assignment every scoped admin page answers
 * 403 ADMIN_USER_SCOPE_MISSING.
 *
 * - zone-coordinator    -> ZONE assignment: a test zone that groups the
 *                          districts with active clubs, for one club type.
 * - general-coordinator -> GENERAL assignment: every section of the local field.
 *
 * Idempotent. Never touches other users' assignments: when the slot is already
 * taken by someone else (one active GENERAL per local field, one active ZONE
 * per zone and club type) it warns and skips.
 */

import type { PrismaClient } from '@prisma/client';

export const TEST_ZONE_NAME = 'Zona Test';
export const TEST_ZONE_CLUB_TYPE_NAME = 'Conquistadores';

export type CoordinatorTerritoryResult = {
  zoneId: number;
  districtIds: number[];
  zone: 'created' | 'kept' | 'skipped';
  general: 'created' | 'kept' | 'skipped';
};

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === 'P2002' || /uq_coordinator_/.test(e?.message ?? '');
}

async function ensureZone(
  prisma: PrismaClient,
  localFieldId: number,
): Promise<number> {
  const zone = await prisma.coordination_zones.upsert({
    where: {
      local_field_id_name: {
        local_field_id: localFieldId,
        name: TEST_ZONE_NAME,
      },
    },
    create: {
      local_field_id: localFieldId,
      name: TEST_ZONE_NAME,
      description: 'Zona de prueba para el coordinador de zona de QA',
      active: true,
    },
    update: { active: true },
    select: { zone_id: true },
  });
  return zone.zone_id;
}

/**
 * Links the districts that hold active clubs of the local field to the zone. A
 * district can sit in one active zone at a time, so one already linked to
 * another zone stays where it is.
 */
async function ensureZoneDistricts(
  prisma: PrismaClient,
  localFieldId: number,
  zoneId: number,
): Promise<number[]> {
  const clubs = await prisma.clubs.findMany({
    where: {
      active: true,
      local_field_id: localFieldId,
      districts: { is: { active: true } },
    },
    select: { districlub_type_id: true },
    distinct: ['districlub_type_id'],
    orderBy: { districlub_type_id: 'asc' },
  });

  const linked: number[] = [];
  for (const { districlub_type_id } of clubs) {
    const inAnotherZone = await prisma.coordination_zone_districts.findFirst({
      where: {
        districlub_type_id,
        active: true,
        zone_id: { not: zoneId },
      },
      select: { zone_district_id: true },
    });
    if (inAnotherZone) continue;

    await prisma.coordination_zone_districts.upsert({
      where: {
        zone_id_districlub_type_id: {
          zone_id: zoneId,
          districlub_type_id,
        },
      },
      create: { zone_id: zoneId, districlub_type_id, active: true },
      update: { active: true },
    });
    linked.push(districlub_type_id);
  }
  return linked;
}

export async function seedCoordinatorTerritories(
  prisma: PrismaClient,
  opts: {
    localFieldId: number;
    zoneCoordinatorId: string;
    generalCoordinatorId: string;
  },
): Promise<CoordinatorTerritoryResult> {
  const { localFieldId, zoneCoordinatorId, generalCoordinatorId } = opts;

  const clubType = await prisma.club_types.findFirst({
    where: { name: TEST_ZONE_CLUB_TYPE_NAME },
    select: { club_type_id: true },
  });
  if (!clubType) {
    throw new Error(
      `Club type "${TEST_ZONE_CLUB_TYPE_NAME}" not found in DB. Run the club_types seed first.`,
    );
  }

  const zoneId = await ensureZone(prisma, localFieldId);
  const districtIds = await ensureZoneDistricts(prisma, localFieldId, zoneId);

  const zone = await ensureAssignment(prisma, {
    user_id: zoneCoordinatorId,
    local_field_id: localFieldId,
    assignment_type: 'ZONE',
    zone_id: zoneId,
    club_type_id: clubType.club_type_id,
  });
  const general = await ensureAssignment(prisma, {
    user_id: generalCoordinatorId,
    local_field_id: localFieldId,
    assignment_type: 'GENERAL',
  });

  return { zoneId, districtIds, zone, general };
}

async function ensureAssignment(
  prisma: PrismaClient,
  where: {
    user_id: string;
    local_field_id: number;
    assignment_type: 'ZONE' | 'GENERAL';
    zone_id?: number;
    club_type_id?: number;
  },
): Promise<'created' | 'kept' | 'skipped'> {
  const existing = await prisma.coordinator_assignments.findFirst({
    where: { ...where, active: true },
    select: { assignment_id: true },
  });
  if (existing) {
    // Re-opens an assignment whose window was closed by hand.
    await prisma.coordinator_assignments.update({
      where: { assignment_id: existing.assignment_id },
      data: { end_date: null },
    });
    return 'kept';
  }

  try {
    await prisma.coordinator_assignments.create({
      data: { ...where, active: true },
    });
    return 'created';
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    console.warn(
      `  ⚠ ${where.assignment_type} assignment skipped for ${where.user_id}: another user holds the slot`,
    );
    return 'skipped';
  }
}
