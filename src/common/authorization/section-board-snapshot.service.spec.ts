import { SectionBoardSnapshotService } from './section-board-snapshot.service';

type Row = { user_id: string; role: string };

function setup(rows: Row[]) {
  const findMany = jest.fn().mockResolvedValue(
    rows.map((r) => ({
      user_id: r.user_id,
      start_date: new Date('2026-01-01'),
      roles: { role_name: r.role },
    })),
  );
  const service = new SectionBoardSnapshotService({
    club_role_assignments: { findMany },
  } as never);
  return { service, findMany };
}

describe('SectionBoardSnapshotService', () => {
  it('fills every slot from the role holders', async () => {
    const { service } = setup([
      { user_id: 'd', role: 'director' },
      { user_id: 'dep1', role: 'deputy-director' },
      { user_id: 'dep2', role: 'deputy-director' },
      { user_id: 's', role: 'secretary' },
      { user_id: 't', role: 'treasurer' },
    ]);
    await expect(service.snapshot(10, 2026)).resolves.toEqual({
      director_id: 'd',
      deputy_director_ids: ['dep1', 'dep2'],
      secretary_id: 's',
      treasurer_id: 't',
      secretary_treasurer_id: null,
    });
  });

  it('maps a secretary-treasurer without secretary or treasurer', async () => {
    const { service } = setup([{ user_id: 'st', role: 'secretary-treasurer' }]);
    await expect(service.snapshot(10, 2026)).resolves.toMatchObject({
      secretary_id: null,
      treasurer_id: null,
      secretary_treasurer_id: 'st',
    });
  });

  it('returns nulls and no deputies when no role has a holder', async () => {
    const { service } = setup([]);
    await expect(service.snapshot(10, 2026)).resolves.toEqual({
      director_id: null,
      deputy_director_ids: [],
      secretary_id: null,
      treasurer_id: null,
      secretary_treasurer_id: null,
    });
  });

  it('keeps at most two deputies, in the order the query returns (start date, user id)', async () => {
    const { service } = setup([
      { user_id: 'a', role: 'deputy-director' },
      { user_id: 'b', role: 'deputy-director' },
      { user_id: 'c', role: 'deputy-director' },
    ]);
    const board = await service.snapshot(10, 2026);
    expect(board.deputy_director_ids).toEqual(['a', 'b']);
  });

  it('ignores other roles (member, counselor)', async () => {
    const { service } = setup([
      { user_id: 'm', role: 'member' },
      { user_id: 'c', role: 'counselor' },
    ]);
    const board = await service.snapshot(10, 2026);
    expect(board.director_id).toBeNull();
    expect(board.deputy_director_ids).toEqual([]);
  });

  it('queries only active, not ended assignments of that section and year, ordered', async () => {
    const { service, findMany } = setup([]);
    await service.snapshot(10, 2026);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      club_section_id: 10,
      ecclesiastical_year_id: 2026,
      active: true,
      status: 'active',
    });
    expect(args.where.OR).toEqual([
      { end_date: null },
      { end_date: { gte: expect.any(Date) } },
    ]);
    expect(args.where.roles.role_name.in).toEqual(
      expect.arrayContaining([
        'director',
        'deputy-director',
        'secretary',
        'treasurer',
        'secretary-treasurer',
      ]),
    );
    expect(args.orderBy).toEqual([{ start_date: 'asc' }, { user_id: 'asc' }]);
  });
});
