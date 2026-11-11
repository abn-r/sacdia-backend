import { SectionResponsiblesService } from './section-responsibles.service';

type Row = { section: number; role: string; name: string; last?: string };

function setup(rows: Row[], club: { local_field_id: number | null } | null) {
  const findMany = jest.fn().mockResolvedValue(
    rows.map((r) => ({
      club_section_id: r.section,
      roles: { role_name: r.role },
      users: { name: r.name, paternal_last_name: r.last ?? null },
    })),
  );
  const prisma = {
    clubs: { findUnique: jest.fn().mockResolvedValue(club) },
    club_role_assignments: { findMany },
  };
  const effective = { active: true, status: 'active' };
  const memberScope = {
    effectiveAssignmentForLocalField: jest.fn().mockResolvedValue(effective),
  };
  const service = new SectionResponsiblesService(
    prisma as never,
    memberScope as never,
  );
  return { service, findMany, memberScope, effective };
}

describe('SectionResponsiblesService', () => {
  it('returns director and treasurer per section, built on the effective predicate', async () => {
    const { service, findMany, memberScope, effective } = setup(
      [
        { section: 10, role: 'director', name: 'Ana', last: 'Ruiz' },
        { section: 10, role: 'treasurer', name: 'Luis', last: 'Paz' },
        { section: 11, role: 'director', name: 'Carlos', last: 'Pérez' },
      ],
      { local_field_id: 7 },
    );

    const result = await service.forSections(1, [10, 11]);

    expect(memberScope.effectiveAssignmentForLocalField).toHaveBeenCalledWith(
      7,
    );
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      ...effective,
      club_section_id: { in: [10, 11] },
    });
    expect(result.get(10)).toEqual({
      director: 'Ana Ruiz',
      treasurer: 'Luis Paz',
    });
    expect(result.get(11)).toEqual({
      director: 'Carlos Pérez',
      treasurer: null,
    });
  });

  it('falls back to the secretary-treasurer and prefers the treasurer', async () => {
    const { service } = setup(
      [
        { section: 10, role: 'secretary-treasurer', name: 'Eva' },
        { section: 11, role: 'secretary-treasurer', name: 'Eva' },
        { section: 11, role: 'treasurer', name: 'Tomás' },
      ],
      { local_field_id: 7 },
    );
    const result = await service.forSections(1, [10, 11]);
    expect(result.get(10)?.treasurer).toBe('Eva');
    expect(result.get(11)?.treasurer).toBe('Tomás');
  });

  it('leaves every post vacant without a local field or sections', async () => {
    const noField = setup([], { local_field_id: null });
    await expect(noField.service.forSections(1, [10])).resolves.toEqual(
      new Map([[10, { director: null, treasurer: null }]]),
    );
    expect(noField.findMany).not.toHaveBeenCalled();

    const none = setup([], null);
    await expect(none.service.forSections(1, [])).resolves.toEqual(new Map());
  });
});
