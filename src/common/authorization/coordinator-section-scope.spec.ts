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

type AssignmentRow = {
  local_field_id: number;
  assignment_type: coordinator_assignment_type;
  zone_id: number | null;
  club_type_id: number | null;
  club_section_id: number | null;
};

const assignment = (overrides: Partial<AssignmentRow>): AssignmentRow => ({
  local_field_id: LOCAL_FIELD_ID,
  assignment_type: coordinator_assignment_type.SECTION,
  zone_id: null,
  club_type_id: null,
  club_section_id: null,
  ...overrides,
});

function fakePrisma({
  assignments = [] as AssignmentRow[],
  expandedSectionIds = [] as number[],
  zoneDistrictIds = [] as number[],
  activeSectionCount = 1,
} = {}) {
  return {
    coordinator_assignments: {
      findMany: jest.fn().mockResolvedValue(assignments),
    },
    club_sections: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          expandedSectionIds.map((club_section_id) => ({ club_section_id })),
        ),
      count: jest.fn().mockResolvedValue(activeSectionCount),
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

describe('coordinatorScopeIncludesSection (canonical coordinator_scope -> club_section_ids)', () => {
  it('reads only the active assignment window of THAT user (UTC day)', async () => {
    const prisma = fakePrisma();

    await coordinatorScopeIncludesSection(
      asPrisma(prisma),
      USER_ID,
      SECTION_ID,
      NOW,
    );

    expect(prisma.coordinator_assignments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: USER_ID,
          active: true,
          start_date: { lte: TODAY },
          OR: [{ end_date: null }, { end_date: { gte: TODAY } }],
        },
      }),
    );
  });

  it('is false without any active assignment', async () => {
    const prisma = fakePrisma();

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
    expect(prisma.club_sections.count).not.toHaveBeenCalled();
  });

  it('SECTION assignment covers exactly that section', async () => {
    const inside = fakePrisma({
      assignments: [assignment({ club_section_id: SECTION_ID })],
    });
    const outside = fakePrisma({
      assignments: [assignment({ club_section_id: 99 })],
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(inside),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(true);
    expect(inside.club_sections.count).toHaveBeenCalledWith({
      where: { club_section_id: SECTION_ID, active: true },
    });
    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(outside),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
  });

  it('a covered but INACTIVE section is outside the scope (same as resolveCoordinatorScope)', async () => {
    const prisma = fakePrisma({
      assignments: [assignment({ club_section_id: SECTION_ID })],
      activeSectionCount: 0,
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
  });

  it('GENERAL assignment covers the active sections of its local field', async () => {
    const inside = fakePrisma({
      assignments: [
        assignment({ assignment_type: coordinator_assignment_type.GENERAL }),
      ],
      expandedSectionIds: [21, SECTION_ID, 30],
    });
    const outside = fakePrisma({
      assignments: [
        assignment({ assignment_type: coordinator_assignment_type.GENERAL }),
      ],
      expandedSectionIds: [21, 30],
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(inside),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(true);
    expect(inside.club_sections.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        clubs: { is: { active: true, local_field_id: LOCAL_FIELD_ID } },
      },
      select: { club_section_id: true },
    });
    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(outside),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
  });

  it('ZONE assignment covers sections of its club type in the zone districts only', async () => {
    const zone = assignment({
      assignment_type: coordinator_assignment_type.ZONE,
      zone_id: 4,
      club_type_id: 2,
    });
    const inside = fakePrisma({
      assignments: [zone],
      zoneDistrictIds: [7, 8],
      expandedSectionIds: [SECTION_ID],
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(inside),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(true);
    expect(inside.coordination_zone_districts.findMany).toHaveBeenCalledWith({
      where: { zone_id: 4, active: true },
      select: { districlub_type_id: true },
    });
    expect(inside.club_sections.findMany).toHaveBeenCalledWith({
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

  it('ZONE assignment whose zone has no active district covers nothing', async () => {
    const prisma = fakePrisma({
      assignments: [
        assignment({
          assignment_type: coordinator_assignment_type.ZONE,
          zone_id: 4,
          club_type_id: 2,
        }),
      ],
      zoneDistrictIds: [],
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(false);
    expect(prisma.club_sections.findMany).not.toHaveBeenCalled();
  });

  it('the union of assignments counts: a later assignment can cover the section', async () => {
    const prisma = fakePrisma({
      assignments: [
        assignment({ club_section_id: 99 }),
        assignment({ club_section_id: SECTION_ID }),
      ],
    });

    expect(
      await coordinatorScopeIncludesSection(
        asPrisma(prisma),
        USER_ID,
        SECTION_ID,
        NOW,
      ),
    ).toBe(true);
  });
});

describe('resolveCoordinatorAssignmentSectionIds', () => {
  it('SECTION without a section id expands to nothing', async () => {
    const prisma = fakePrisma();
    expect(
      await resolveCoordinatorAssignmentSectionIds(asPrisma(prisma), {
        localFieldId: LOCAL_FIELD_ID,
        assignmentType: coordinator_assignment_type.SECTION,
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
