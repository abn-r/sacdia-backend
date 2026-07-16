import { OperationsDashboardRepository } from './operations-dashboard.repository';
import type {
  EcclesiasticalYearRecord,
  ResolvedOperationsDashboardScope,
} from './operations-dashboard.types';

describe('OperationsDashboardRepository', () => {
  const prisma = {
    ecclesiastical_years: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const year: EcclesiasticalYearRecord = {
    year_id: 7,
    start_date: new Date('2026-01-01T00:00:00.000Z'),
    end_date: new Date('2026-12-31T00:00:00.000Z'),
    active: true,
  };

  const unionScope: ResolvedOperationsDashboardScope = {
    level: 'union',
    id: 10,
    name: 'Unión 10',
    path: [
      { level: 'division', id: 1, name: 'División 1' },
      { level: 'union', id: 10, name: 'Unión 10' },
    ],
  };

  let repository: OperationsDashboardRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new OperationsDashboardRepository(prisma as any);
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it('resolves the newest active ecclesiastical year', async () => {
    prisma.ecclesiastical_years.findFirst.mockResolvedValue(year);

    await expect(repository.findActiveEcclesiasticalYear()).resolves.toBe(year);
    expect(prisma.ecclesiastical_years.findFirst).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { start_date: 'desc' },
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
  });

  it('resolves an ecclesiastical year by positive id', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue(year);

    await expect(repository.findEcclesiasticalYearById(7)).resolves.toBe(year);
    expect(prisma.ecclesiastical_years.findUnique).toHaveBeenCalledWith({
      where: { year_id: 7 },
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
  });

  it('loads all aggregate families with parameterized Prisma SQL', async () => {
    const result = await repository.loadSnapshot({
      scope: unionScope,
      ecclesiasticalYear: year,
      reportingMonth: { year: 2026, month: 6 },
      includeHonors: true,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(9);
    expect(result).toEqual({
      children: [],
      administrative: [],
      operations: [],
      people: [],
      classes: [],
      monthlyReports: [],
      honors: [],
      activities: [],
      queues: [],
    });

    for (const [query] of prisma.$queryRaw.mock.calls) {
      expect(query).toEqual(
        expect.objectContaining({
          strings: expect.any(Array),
          values: expect.any(Array),
        }),
      );
    }
    expect(JSON.stringify(prisma.$queryRaw.mock.calls)).not.toContain(
      '$queryRawUnsafe',
    );

    const queueQuery = prisma.$queryRaw.mock.calls
      .map(([query]) => (query.strings as string[]).join('?'))
      .find((sql) => sql.includes('WITH queue_items'));
    const operationQuery = prisma.$queryRaw.mock.calls
      .map(([query]) => (query.strings as string[]).join('?'))
      .find((sql) => sql.includes('AS operational_clubs'));
    const monthlyReportsQuery = prisma.$queryRaw.mock.calls
      .map(([query]) => (query.strings as string[]).join('?'))
      .find((sql) => sql.includes('AS expected_sections'));
    const activitiesQuery = prisma.$queryRaw.mock.calls
      .map(([query]) => (query.strings as string[]).join('?'))
      .find((sql) => sql.includes('AS joint_registered'));

    expect(operationQuery).toContain("ce.status = 'active'");
    expect(monthlyReportsQuery).toContain("ce.status = 'active'");
    expect(activitiesQuery).toContain("ce.status = 'active'");
    expect(queueQuery).toContain("csp.status = 'SUBMITTED'");
    expect(queueQuery).not.toContain("csp.status = 'PENDING'");
    expect(queueQuery).toContain("ce.status = 'active'");
  });

  it('scopes class validation queues to the selected enrollment year and club type', async () => {
    await repository.loadSnapshot({
      scope: unionScope,
      ecclesiasticalYear: year,
      reportingMonth: { year: 2026, month: 6 },
      includeHonors: true,
    });

    const queueQuery = prisma.$queryRaw.mock.calls
      .map(([query]) => (query.strings as string[]).join('?'))
      .find((sql) => sql.includes('WITH queue_items'));

    expect(queueQuery).toMatch(
      /INNER JOIN enrollments e\s+ON e\.enrollment_id = csp\.enrollment_id/,
    );
    expect(queueQuery).toContain('AND e.user_id = csp.user_id');
    expect(queueQuery).toContain('AND e.class_id = csp.class_id');
    expect(queueQuery).toContain('AND e.ecclesiastical_year_id = ?');
    expect(queueQuery).toContain('AND e.active = true');
    expect(queueQuery).toContain(
      'INNER JOIN classes cl ON cl.class_id = e.class_id',
    );
    expect(queueQuery).toContain('ON cra.user_id = e.user_id');
    expect(queueQuery).toContain('AND cra.ecclesiastical_year_id = ?');
    expect(queueQuery).toContain('AND cra.active = true');
    expect(queueQuery).toContain("AND cra.status = 'active'");
    expect(queueQuery).toContain('AND cs.club_type_id = cl.club_type_id');
    expect(queueQuery).toContain("csp.status = 'SUBMITTED'");
    expect(queueQuery).toContain('csp.submitted_at IS NOT NULL');
  });

  it('does not query current-affiliation honors for a historical year', async () => {
    await repository.loadSnapshot({
      scope: unionScope,
      ecclesiasticalYear: { ...year, active: false },
      reportingMonth: { year: 2025, month: 12 },
      includeHonors: false,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(8);

    const sqlQueries = prisma.$queryRaw.mock.calls.map(([query]) =>
      (query.strings as string[]).join('?'),
    );
    const operationQuery = sqlQueries.find((sql) =>
      sql.includes('AS operational_clubs'),
    );
    const monthlyReportsQuery = sqlQueries.find((sql) =>
      sql.includes('AS expected_sections'),
    );
    const activitiesQuery = sqlQueries.find((sql) =>
      sql.includes('AS joint_registered'),
    );
    const queueQuery = sqlQueries.find((sql) =>
      sql.includes('WITH queue_items'),
    );

    expect(queueQuery).not.toContain('FROM users_honors uh');
    expect(operationQuery).toContain("ce.status IN ('active', 'closed')");
    expect(monthlyReportsQuery).toContain("ce.status IN ('active', 'closed')");
    expect(activitiesQuery).toContain("ce.status IN ('active', 'closed')");
  });

  it('omits the monthly reports query when no closed reporting month exists', async () => {
    const result = await repository.loadSnapshot({
      scope: unionScope,
      ecclesiasticalYear: year,
      reportingMonth: null,
      includeHonors: true,
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(8);
    expect(result.monthlyReports).toEqual([]);
    expect(
      prisma.$queryRaw.mock.calls.some(([query]) =>
        (query.strings as string[]).join('?').includes('AS expected_sections'),
      ),
    ).toBe(false);
  });
});
