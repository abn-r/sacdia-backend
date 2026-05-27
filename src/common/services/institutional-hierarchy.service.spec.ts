import { InstitutionalHierarchyService } from './institutional-hierarchy.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('InstitutionalHierarchyService', () => {
  const mockPrisma = {
    $queryRaw: jest.fn(),
  };

  let service: InstitutionalHierarchyService;

  const hierarchyRow = {
    division_id: 1,
    division_code: 'DIA',
    division_name: 'División Interamericana',
    union_id: 20,
    union_name: 'Unión Norte',
    local_field_id: 30,
    local_field_name: 'Campo Centro',
    district_id: 40,
    district_name: 'Distrito Norte',
    church_id: 50,
    church_name: 'Iglesia Central',
    club_id: 60,
    club_name: 'Club Amanecer',
    as_of: '2026-01-01T00:00:00.000Z',
    source: 'current',
    precision: 'exact',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InstitutionalHierarchyService(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('resolves the current hierarchy for a club', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([hierarchyRow]);

    await expect(service.resolveCurrent({ clubId: 60 })).resolves.toMatchObject(
      {
        division_id: 1,
        union_id: 20,
        local_field_id: 30,
        club_id: 60,
        source: 'current',
        precision: 'exact',
      },
    );
  });

  it('resolves an as-of union hierarchy from relationship history', async () => {
    const asOf = new Date('2025-06-01T00:00:00.000Z');
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        ...hierarchyRow,
        local_field_id: null,
        club_id: null,
        as_of: asOf,
        source: 'as_of',
      },
    ]);

    const result = await service.resolveAsOf({ type: 'union', id: 20 }, asOf);

    expect(result).toMatchObject({
      division_id: 1,
      union_id: 20,
      local_field_id: null,
      source: 'as_of',
      precision: 'exact',
    });
  });

  it('falls back to current hierarchy with unknown precision when as-of history is missing', async () => {
    const asOf = new Date('2025-06-01T00:00:00.000Z');
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([hierarchyRow]);

    const result = await service.resolveAsOf({ type: 'club', id: 60 }, asOf);

    expect(result).toMatchObject({
      division_id: 1,
      club_id: 60,
      source: 'as_of',
      precision: 'unknown',
    });
    expect(result.as_of).toEqual(asOf);
  });

  it('persists and returns a club hierarchy snapshot', async () => {
    const asOf = new Date('2025-06-01T00:00:00.000Z');
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { ...hierarchyRow, as_of: asOf, source: 'as_of' },
      ])
      .mockResolvedValueOnce([{ hierarchy_context_id: 'ctx-1' }]);

    const result = await service.snapshotForClub(60, asOf, 'actor-1');

    expect(result).toMatchObject({
      hierarchy_context_id: 'ctx-1',
      division_id: 1,
      club_id: 60,
      source: 'snapshot',
    });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
