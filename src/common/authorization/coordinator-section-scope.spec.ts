import { coordinator_assignment_type } from '@prisma/client';
import {
  coordinatorScopeIncludesSection,
  resolveCoordinatorAssignmentSectionIds,
  type CoordinatorScopePrisma,
} from './coordinator-section-scope';

const USER_ID = '99999999-9999-4999-8999-999999999999';
const SECTION_ID = 22;
const LOCAL_FIELD_ID = 50;
const NOW = new Date('2026-10-20T15:30:00.000Z');
const TODAY = new Date('2026-10-20T00:00:00.000Z');

/** The expansion side (club_sections / zone districts), read by findMany. */
function fakePrisma({
  expandedSectionIds = [] as number[],
  zoneDistrictIds = [] as number[],
} = {}) {
  return {
    coordinator_assignments: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    club_sections: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          expandedSectionIds.map((club_section_id) => ({ club_section_id })),
        ),
    },
    coordination_zone_districts: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          zoneDistrictIds.map((districlub_type_id) => ({ districlub_type_id })),
        ),
    },
  };
}

const asPrisma = (prisma: ReturnType<typeof fakePrisma>) =>
  prisma as unknown as CoordinatorScopePrisma;

type SectionRow = {
  club_type_id: number;
  clubs: {
    active: boolean;
    local_field_id: number;
    districlub_type_id: number;
  } | null;
};

const DISTRICT_ID = 7;
const CLUB_TYPE_ID = 2;

const activeSection = (overrides: Partial<SectionRow> = {}): SectionRow => ({
  club_type_id: CLUB_TYPE_ID,
  clubs: {
    active: true,
    local_field_id: LOCAL_FIELD_ID,
    districlub_type_id: DISTRICT_ID,
  },
  ...overrides,
});

function targetedPrisma({
  section = activeSection(),
  match = null as { assignment_id: string } | null,
} = {}) {
  const prisma = fakePrisma();
  return {
    ...prisma,
    coordinator_assignments: {
      ...prisma.coordinator_assignments,
      findFirst: jest.fn().mockResolvedValue(match),
    },
    club_sections: {
      ...prisma.club_sections,
      findFirst: jest.fn().mockResolvedValue(section),
    },
  };
}

const targeted = (prisma: ReturnType<typeof targetedPrisma>) =>
  prisma as unknown as CoordinatorScopePrisma;

const ACTIVE_WINDOW = {
  active: true,
  start_date: { lte: TODAY },
  OR: [{ end_date: null }, { end_date: { gte: TODAY } }],
};

describe('coordinatorScopeIncludesSection (one section against the active assignments, no expansion)', () => {
  it('reads THAT section once (active only) with what an assignment can match on', async () => {
    const prisma = targetedPrisma();

    await coordinatorScopeIncludesSection(
      targeted(prisma),
      USER_ID,
      SECTION_ID,
      NOW,
    );

    expect(prisma.club_sections.findFirst).toHaveBeenCalledWith({
      where: { club_section_id: SECTION_ID, active: true },
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
  });

  it('asks for ONE active assignment of that user that covers the section (SECTION, GENERAL of its local field, ZONE of its type and district)', async () => {
    const prisma = targetedPrisma({ match: { assignment_id: 'a-1' } });

    expect(
      await coordinatorScopeIncludesSection(
        targeted(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(true);
    expect(prisma.coordinator_assignments.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: USER_ID,
        AND: [
          ACTIVE_WINDOW,
          {
            OR: [
              {
                assignment_type: coordinator_assignment_type.SECTION,
                club_section_id: SECTION_ID,
              },
              {
                assignment_type: coordinator_assignment_type.GENERAL,
                local_field_id: LOCAL_FIELD_ID,
              },
              {
                assignment_type: coordinator_assignment_type.ZONE,
                local_field_id: LOCAL_FIELD_ID,
                club_type_id: CLUB_TYPE_ID,
                coordination_zones: {
                  is: {
                    active: true,
                    districts: {
                      some: {
                        districlub_type_id: DISTRICT_ID,
                        active: true,
                        districts: { is: { active: true } },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      select: { assignment_id: true },
    });
  });

  it('never expands an assignment to its section list (no findMany at all)', async () => {
    const prisma = targetedPrisma({ match: { assignment_id: 'a-1' } });

    await coordinatorScopeIncludesSection(
      targeted(prisma),
      USER_ID,
      SECTION_ID,
      NOW,
    );

    expect(prisma.coordinator_assignments.findMany).not.toHaveBeenCalled();
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
    expect(prisma.coordination_zone_districts.findMany).not.toHaveBeenCalled();
  });

  it('is false when no active assignment covers the section', async () => {
    const prisma = targetedPrisma({ match: null });

    expect(
      await coordinatorScopeIncludesSection(
        targeted(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
  });

  it('a missing or INACTIVE section is outside the scope, without reading assignments', async () => {
    const prisma = targetedPrisma({
      section: null,
      match: { assignment_id: 'a-1' },
    });

    expect(
      await coordinatorScopeIncludesSection(
        targeted(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
    expect(prisma.coordinator_assignments.findFirst).not.toHaveBeenCalled();
  });

  it('a section of an INACTIVE club is outside the scope for every assignment type (SECTION included), without reading assignments', async () => {
    const prisma = targetedPrisma({
      section: activeSection({
        clubs: {
          active: false,
          local_field_id: LOCAL_FIELD_ID,
          districlub_type_id: DISTRICT_ID,
        },
      }),
      match: { assignment_id: 'a-1' },
    });

    expect(
      await coordinatorScopeIncludesSection(
        targeted(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
    expect(prisma.coordinator_assignments.findFirst).not.toHaveBeenCalled();
  });

  it('a section without a club is outside the scope', async () => {
    const prisma = targetedPrisma({
      section: activeSection({ clubs: null }),
      match: { assignment_id: 'a-1' },
    });

    expect(
      await coordinatorScopeIncludesSection(
        targeted(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
    expect(prisma.coordinator_assignments.findFirst).not.toHaveBeenCalled();
  });
});

describe('resolveCoordinatorAssignmentSectionIds', () => {
  it('GENERAL expands to the active sections of active clubs in its local field', async () => {
    const prisma = fakePrisma({ expandedSectionIds: [21, SECTION_ID] });

    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.GENERAL,
      }),
    ).toEqual([21, SECTION_ID]);
    expect(prisma.club_sections.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        clubs: { is: { active: true, local_field_id: LOCAL_FIELD_ID } },
      },
      select: { club_section_id: true },
    });
  });

  it('ZONE expands to the sections of its club type in the active districts linked to the active zone', async () => {
    const prisma = fakePrisma({
      zoneDistrictIds: [7, 8],
      expandedSectionIds: [SECTION_ID],
    });

    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.ZONE,
        zoneId: 4,
        clubTypeId: 2,
      }),
    ).toEqual([SECTION_ID]);
    expect(prisma.coordination_zone_districts.findMany).toHaveBeenCalledWith({
      where: {
        zone_id: 4,
        active: true,
        districts: { is: { active: true } },
        zone: { active: true },
      },
      select: { districlub_type_id: true },
    });
    expect(prisma.club_sections.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        club_type_id: 2,
        clubs: {
          is: {
            active: true,
            local_field_id: LOCAL_FIELD_ID,
            districlub_type_id: { in: [7, 8] },
          },
        },
      },
      select: { club_section_id: true },
    });
  });

  it('ZONE whose zone has no active district expands to nothing', async () => {
    const prisma = fakePrisma({ zoneDistrictIds: [] });

    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.ZONE,
        zoneId: 4,
        clubTypeId: 2,
      }),
    ).toEqual([]);
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
  });

  it('SECTION without a section id expands to nothing', async () => {
    const prisma = fakePrisma();
    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.SECTION,
      }),
    ).toEqual([]);
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
  });

  it('SECTION expands to that section only while it and its club are active', async () => {
    const prisma = fakePrisma({ expandedSectionIds: [SECTION_ID] });

    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.SECTION,
        clubSectionId: SECTION_ID,
      }),
    ).toEqual([SECTION_ID]);
    expect(prisma.club_sections.findMany).toHaveBeenCalledWith({
      where: {
        club_section_id: SECTION_ID,
        active: true,
        clubs: { is: { active: true } },
      },
      select: { club_section_id: true },
    });
  });

  it('SECTION of an inactive section or club expands to nothing', async () => {
    const prisma = fakePrisma({ expandedSectionIds: [] });

    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.SECTION,
        clubSectionId: SECTION_ID,
      }),
    ).toEqual([]);
  });

  it('ZONE without zone or club type expands to nothing (no query)', async () => {
    const prisma = fakePrisma({ zoneDistrictIds: [7] });
    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.ZONE,
        zoneId: 4,
      }),
    ).toEqual([]);
    expect(prisma.coordination_zone_districts.findMany).not.toHaveBeenCalled();
  });
});
