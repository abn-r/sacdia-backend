import { YearEndService } from './year-end.service';

describe('YearEndService', () => {
  const createPrismaMock = () => {
    const tx = {
      ecclesiastical_years: {
        update: jest.fn().mockResolvedValue({}),
      },
      club_enrollments: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      annual_folders: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      investiture_authorization_people: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      investiture_authorization_requests: {
        create: jest.fn(),
      },
    };

    return {
      tx,
      prisma: {
        ecclesiastical_years: {
          findUnique: jest.fn().mockResolvedValue({
            year_id: 2026,
            active: true,
            start_date: new Date('2026-01-01T00:00:00.000Z'),
            end_date: new Date('2026-12-31T23:59:59.999Z'),
          }),
        },
        club_enrollments: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ club_enrollment_id: 'enrollment-1' }]),
        },
        annual_folders: {
          findMany: jest.fn().mockResolvedValue([
            {
              annual_folder_id: 'folder-1',
              hierarchy_context_id: null,
              club_enrollment: {
                club_section: {
                  clubs: {
                    club_id: 10,
                  },
                },
              },
            },
          ]),
        },
        monthly_reports: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn((callback: (txArg: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
  };

  it('stores year-end hierarchy snapshot without system UUID actor and without overwriting concurrent context', async () => {
    const { prisma, tx } = createPrismaMock();
    const monthlyReportsService = {
      generate: jest.fn(),
    };
    const hierarchy = {
      snapshotForClub: jest.fn().mockResolvedValue({
        hierarchy_context_id: 'ctx-year-end-1',
      }),
    };
    const service = new YearEndService(
      prisma as never,
      monthlyReportsService as never,
      hierarchy as never,
    );

    await service.closeYear(2026);

    expect(hierarchy.snapshotForClub).toHaveBeenCalledWith(
      10,
      expect.any(Date),
    );
    expect(hierarchy.snapshotForClub.mock.calls[0]).toHaveLength(2);
    expect(tx.annual_folders.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          annual_folder_id: 'folder-1',
          status: { not: 'closed' },
        },
        data: expect.not.objectContaining({
          hierarchy_context_id: expect.anything(),
        }),
      }),
    );
    expect(tx.investiture_authorization_requests.create).not.toHaveBeenCalled();
    expect(tx.annual_folders.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        annual_folder_id: 'folder-1',
        hierarchy_context_id: null,
      },
      data: {
        hierarchy_context_id: 'ctx-year-end-1',
      },
    });
  });

  it('closes pending investiture people once and leaves an invested person unchanged', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.investiture_authorization_people.findMany
      .mockResolvedValueOnce([
        {
          person_id: 'pending-person',
          user_id: 'user-pending',
          enrollment_id: 4,
          request: { club_section_id: 7, ecclesiastical_year_id: 2026 },
        },
      ])
      .mockResolvedValueOnce([]);
    tx.investiture_authorization_people.updateMany.mockResolvedValue({
      count: 1,
    });
    const service = new YearEndService(
      prisma as never,
      { generate: jest.fn() } as never,
    );

    const first = await service.closeYear(2026);
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      year_id: 2026,
      active: false,
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    await expect(service.closeYear(2026)).rejects.toThrow();

    expect(first.investiturePendingClosed).toBe(1);
    expect(
      tx.investiture_authorization_people.updateMany,
    ).toHaveBeenCalledTimes(1);
    expect(tx.investiture_authorization_people.updateMany).toHaveBeenCalledWith(
      {
        where: {
          person_id: { in: ['pending-person'] },
          status: 'PENDING',
        },
        data: {
          status: 'CLOSED_YEAR',
          resolution_code: 'CLOSED_YEAR',
        },
      },
    );
    expect(tx.investiture_authorization_requests.create).not.toHaveBeenCalled();
    const stored = JSON.stringify(
      tx.investiture_authorization_people.updateMany.mock.calls,
    );
    expect(stored).not.toContain('Falta de requisitos para investidura');
  });
});
