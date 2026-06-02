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
});
