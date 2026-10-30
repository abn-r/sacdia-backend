import type { PrismaClient } from '@prisma/client';
import {
  TEST_ZONE_CLUB_TYPE_NAME,
  TEST_ZONE_NAME,
  seedCoordinatorTerritories,
} from '../../prisma/seeds/coordinator-territories';

const OPTS = {
  localFieldId: 4,
  zoneCoordinatorId: 'zone-user',
  generalCoordinatorId: 'general-user',
};

function buildPrisma(overrides: Record<string, any> = {}) {
  const prisma = {
    club_types: {
      findFirst: jest.fn().mockResolvedValue({ club_type_id: 2 }),
    },
    coordination_zones: {
      upsert: jest.fn().mockResolvedValue({ zone_id: 7 }),
    },
    clubs: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { districlub_type_id: 20 },
          { districlub_type_id: 22 },
        ]),
    },
    coordination_zone_districts: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    coordinator_assignments: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return prisma as unknown as PrismaClient & typeof prisma;
}

describe('seedCoordinatorTerritories', () => {
  it('creates the test zone, links the districts and both assignments', async () => {
    const prisma = buildPrisma();

    const result = await seedCoordinatorTerritories(prisma, OPTS);

    expect(prisma.club_types.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: TEST_ZONE_CLUB_TYPE_NAME },
      }),
    );
    expect(prisma.coordination_zones.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          local_field_id_name: {
            local_field_id: 4,
            name: TEST_ZONE_NAME,
          },
        },
      }),
    );
    expect(prisma.coordination_zone_districts.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.coordinator_assignments.create).toHaveBeenCalledWith({
      data: {
        user_id: 'zone-user',
        local_field_id: 4,
        assignment_type: 'ZONE',
        zone_id: 7,
        club_type_id: 2,
        active: true,
      },
    });
    expect(prisma.coordinator_assignments.create).toHaveBeenCalledWith({
      data: {
        user_id: 'general-user',
        local_field_id: 4,
        assignment_type: 'GENERAL',
        active: true,
      },
    });
    expect(result).toEqual({
      zoneId: 7,
      districtIds: [20, 22],
      zone: 'created',
      general: 'created',
    });
  });

  it('is idempotent: keeps existing assignments and creates nothing', async () => {
    const prisma = buildPrisma();
    prisma.coordinator_assignments.findFirst.mockResolvedValue({
      assignment_id: 'a1',
    });

    const result = await seedCoordinatorTerritories(prisma, OPTS);

    expect(prisma.coordinator_assignments.create).not.toHaveBeenCalled();
    expect(prisma.coordinator_assignments.update).toHaveBeenCalledTimes(2);
    expect(result.zone).toBe('kept');
    expect(result.general).toBe('kept');
  });

  it('leaves a district that already sits in another active zone', async () => {
    const prisma = buildPrisma();
    prisma.coordination_zone_districts.findFirst
      .mockResolvedValueOnce({ zone_district_id: 1 })
      .mockResolvedValueOnce(null);

    const result = await seedCoordinatorTerritories(prisma, OPTS);

    expect(result.districtIds).toEqual([22]);
    expect(prisma.coordination_zone_districts.upsert).toHaveBeenCalledTimes(1);
  });

  it('skips with a warning when another user holds the slot', async () => {
    const prisma = buildPrisma();
    prisma.coordinator_assignments.create.mockRejectedValue({ code: 'P2002' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await seedCoordinatorTerritories(prisma, OPTS);

    expect(result.zone).toBe('skipped');
    expect(result.general).toBe('skipped');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('rethrows unexpected errors', async () => {
    const prisma = buildPrisma();
    prisma.coordinator_assignments.create.mockRejectedValue(new Error('boom'));

    await expect(seedCoordinatorTerritories(prisma, OPTS)).rejects.toThrow(
      'boom',
    );
  });

  it('fails clearly when the club type is missing', async () => {
    const prisma = buildPrisma();
    prisma.club_types.findFirst.mockResolvedValue(null);

    await expect(seedCoordinatorTerritories(prisma, OPTS)).rejects.toThrow(
      /club_types seed/,
    );
  });
});
