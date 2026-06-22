import { AnnualFoldersService } from '../annual-folders.service';
import { ErrorCode } from '../../common/errors/error-codes';

const FOLDER_ID = 'folder-uuid-0000-0000-000000000001';
const USER_ID = 'user-uuid-0000-0000-000000000002';
const SECTION_ONE_ID = 'section-uuid-0000-0000-000000000003';
const SECTION_TWO_ID = 'section-uuid-0000-0000-000000000004';

const requiredSections = [
  { section_id: SECTION_ONE_ID, name: 'Administración' },
  { section_id: SECTION_TWO_ID, name: 'Evangelismo' },
];

const mockFolderClubChain = {
  club_enrollment: {
    club_section: {
      clubs: { club_id: 10 },
    },
  },
};

function makeFolder(overrides: Record<string, unknown> = {}) {
  return {
    annual_folder_id: FOLDER_ID,
    status: 'open',
    folder_template: {
      closing_date: null,
      sections: requiredSections,
    },
    section_submissions: [
      { section_id: SECTION_ONE_ID },
      { section_id: SECTION_TWO_ID },
    ],
    ...overrides,
  };
}

const mockTx = {
  annual_folders: {
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  },
  annual_folder_evidences: {
    groupBy: jest.fn(),
  },
};

const mockPrismaService = {
  annual_folders: {
    findUnique: jest.fn(),
  },
  users_roles: {
    findFirst: jest.fn(),
  },
  club_role_assignments: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) =>
    cb(mockTx),
  ),
};

describe('AnnualFoldersService — submitFolder', () => {
  let service: AnnualFoldersService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AnnualFoldersService(mockPrismaService as any, {} as any);

    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    );
    mockPrismaService.annual_folders.findUnique.mockResolvedValue(
      mockFolderClubChain,
    );
    mockPrismaService.users_roles.findFirst.mockResolvedValue({
      user_role_id: 'super-admin-role-id',
    });
    mockTx.annual_folders.updateMany.mockResolvedValue({ count: 1 });
    mockTx.annual_folder_evidences.groupBy.mockResolvedValue([
      { section_id: SECTION_ONE_ID, _count: { _all: 1 } },
      { section_id: SECTION_TWO_ID, _count: { _all: 1 } },
    ]);
  });

  function setTransactionFolder(folder = makeFolder()) {
    mockTx.annual_folders.findUnique
      .mockResolvedValueOnce(folder)
      .mockResolvedValueOnce({
        annual_folder_id: FOLDER_ID,
        status: 'submitted',
      });
  }

  it('submits the folder when all required sections are submitted and have evidence', async () => {
    setTransactionFolder();

    const result = await service.submitFolder(FOLDER_ID, USER_ID);

    expect(mockTx.annual_folder_evidences.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          annual_folder_id: FOLDER_ID,
          section_id: { in: [SECTION_ONE_ID, SECTION_TWO_ID] },
        },
      }),
    );
    expect(mockTx.annual_folders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { annual_folder_id: FOLDER_ID, status: 'open' },
        data: expect.objectContaining({ status: 'submitted' }),
      }),
    );
    expect(result).toMatchObject({
      annual_folder_id: FOLDER_ID,
      status: 'submitted',
    });
  });

  it('allows submission when the caller has annual_folders:submit in the folder club', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
      assignment_id: 'club-submit-grant',
    });
    setTransactionFolder();

    await service.submitFolder(FOLDER_ID, USER_ID);

    expect(
      mockPrismaService.club_role_assignments.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER_ID,
          active: true,
          status: 'active',
          club_sections: { clubs: { club_id: 10 } },
          roles: expect.objectContaining({
            role_permissions: {
              some: expect.objectContaining({
                permissions: expect.objectContaining({
                  permission_name: 'annual_folders:submit',
                }),
              }),
            },
          }),
        }),
      }),
    );
    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects submission when the same-club assignment lacks annual_folders:submit', async () => {
    mockPrismaService.users_roles.findFirst.mockResolvedValue(null);
    mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

    await expect(
      service.submitFolder(FOLDER_ID, USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_FOLDER_ACCESS_DENIED,
    });

    expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
  });

  it('blocks folder submission when a required section was not submitted', async () => {
    setTransactionFolder(
      makeFolder({
        section_submissions: [{ section_id: SECTION_ONE_ID }],
      }),
    );

    await expect(
      service.submitFolder(FOLDER_ID, USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_REQUIRED_SECTIONS_PENDING,
    });

    expect(mockTx.annual_folder_evidences.groupBy).not.toHaveBeenCalled();
    expect(mockTx.annual_folders.updateMany).not.toHaveBeenCalled();
  });

  it('blocks folder submission when a required submitted section has no current evidence', async () => {
    setTransactionFolder();
    mockTx.annual_folder_evidences.groupBy.mockResolvedValue([
      { section_id: SECTION_ONE_ID, _count: { _all: 1 } },
    ]);

    await expect(
      service.submitFolder(FOLDER_ID, USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_SECTION_NO_EVIDENCE,
    });

    expect(mockTx.annual_folders.updateMany).not.toHaveBeenCalled();
  });

  it('blocks folder submission when the template submission window is closed', async () => {
    setTransactionFolder(
      makeFolder({
        folder_template: {
          closing_date: new Date('2020-01-01T00:00:00Z'),
          sections: requiredSections,
        },
      }),
    );

    await expect(
      service.submitFolder(FOLDER_ID, USER_ID),
    ).rejects.toMatchObject({
      code: ErrorCode.ANNUAL_FOLDER_SUBMISSION_CLOSED,
    });

    expect(mockTx.annual_folder_evidences.groupBy).not.toHaveBeenCalled();
    expect(mockTx.annual_folders.updateMany).not.toHaveBeenCalled();
  });
});
