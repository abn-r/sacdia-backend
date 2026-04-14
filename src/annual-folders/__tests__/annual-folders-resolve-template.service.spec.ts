import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnnualFoldersService } from '../annual-folders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';

/**
 * Unit tests for AnnualFoldersService.resolveTemplateForClub (private method
 * exercised via createFolderForEnrollment to avoid exposing private surface).
 *
 * Covers (R-C5-2 precedence — ADR-5):
 *  1. Union-owned template exists → returns union-owned template
 *  2. Union template missing, LF template exists → returns LF-owned template
 *  3. Neither exists → throws NotFoundException
 *  4. Both exist for same (type, year, club) → returns union (union wins per R-C5-2)
 *  5. Enrollment not found → throws NotFoundException
 */

const ENROLLMENT_ID = 'enrollment-uuid-0000-0000-000000000001';
const FOLDER_TEMPLATE_ID_UNION = 'template-uuid-0000-0000-0000-union00000001';
const FOLDER_TEMPLATE_ID_LF = 'template-uuid-0000-0000-0000-lffield000001';

const mockEnrollment = {
  club_enrollment_id: ENROLLMENT_ID,
  club_section_id: 10,
  ecclesiastical_year_id: 1,
  status: 'active',
  created_by: 'creator-uuid-0000-0000-000000000001',
  created_at: new Date('2026-01-01T00:00:00Z'),
  modified_at: new Date('2026-01-01T00:00:00Z'),
  club_section: {
    club_type_id: 2,
    main_club_id: 5,
    clubs: {
      club_id: 5,
      local_field_id: 3,
      local_fields: {
        local_field_id: 3,
        union_id: 7,
      },
    },
  },
};

const mockUnionTemplate = {
  folder_template_id: FOLDER_TEMPLATE_ID_UNION,
  name: 'Conquistadores 2026 — Unión',
  club_type_id: 2,
  ecclesiastical_year_id: 1,
  owner_union_id: 7,
  owner_local_field_id: null,
  active: true,
  minimum_points: 0,
  closing_date: null,
  created_at: new Date(),
  modified_at: new Date(),
};

const mockLFTemplate = {
  folder_template_id: FOLDER_TEMPLATE_ID_LF,
  name: 'Conquistadores 2026 — Campo Local',
  club_type_id: 2,
  ecclesiastical_year_id: 1,
  owner_union_id: null,
  owner_local_field_id: 3,
  active: true,
  minimum_points: 0,
  closing_date: null,
  created_at: new Date(),
  modified_at: new Date(),
};

describe('AnnualFoldersService — resolveTemplateForClub (via createFolderForEnrollment)', () => {
  let service: AnnualFoldersService;

  // tx mirror — same shape as the outer prisma mock, used inside $transaction callbacks.
  const mockTx = {
    annual_folders: {
      create: jest.fn(),
    },
    folder_template_sections: {
      findMany: jest.fn(),
    },
    annual_folder_section_evaluations: {
      createMany: jest.fn(),
    },
  };

  const mockPrismaService = {
    annual_folders: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
    },
    folder_templates: {
      findFirst: jest.fn(),
    },
    // Simulate $transaction by immediately executing the callback with mockTx.
    $transaction: jest.fn((cb: (tx: typeof mockTx) => Promise<unknown>) =>
      cb(mockTx),
    ),
  };

  const mockFileStorageService = { upload: jest.fn() };

  beforeEach(async () => {
    // resetAllMocks clears both call history AND mockResolvedValueOnce queues.
    // clearAllMocks only clears call history — leftover Once queues bleed between tests.
    jest.resetAllMocks();

    // Restore $transaction implementation after resetAllMocks wipes it.
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);

    // Default: no existing folder
    mockPrismaService.annual_folders.findUnique.mockResolvedValue(null);
    // Default: enrollment exists
    mockPrismaService.club_enrollments.findUnique.mockResolvedValue(mockEnrollment);
    // Default: tx.annual_folders.create succeeds
    mockTx.annual_folders.create.mockResolvedValue({
      annual_folder_id: 'folder-uuid',
      club_enrollment_id: ENROLLMENT_ID,
      folder_template_id: FOLDER_TEMPLATE_ID_UNION,
      status: 'open',
      folder_template: { sections: [], club_type: { name: 'Conquistadores' } },
    });
    // Default: no template sections (overridden per test)
    mockTx.folder_template_sections.findMany.mockResolvedValue([]);
    // Default: createMany succeeds
    mockTx.annual_folder_section_evaluations.createMany.mockResolvedValue({ count: 0 });
  });

  // ---------------------------------------------------------------
  // 1. Union template exists → uses union-owned template
  // ---------------------------------------------------------------
  it('uses union-owned template when union template exists', async () => {
    mockPrismaService.folder_templates.findFirst
      .mockResolvedValueOnce(mockUnionTemplate) // union query → found
      .mockResolvedValueOnce(null);             // LF query (should not be reached)

    await service.createFolderForEnrollment(ENROLLMENT_ID);

    // create called with the union template ID
    const createArg = mockTx.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.folder_template_id).toBe(FOLDER_TEMPLATE_ID_UNION);

    // Only one findFirst call (union) since it was found first
    expect(mockPrismaService.folder_templates.findFirst).toHaveBeenCalledTimes(1);
    const firstCall = mockPrismaService.folder_templates.findFirst.mock.calls[0][0];
    expect(firstCall.where.owner_union_id).toBe(7);
  });

  // ---------------------------------------------------------------
  // 2. Union missing, LF template exists → fallback to LF
  // ---------------------------------------------------------------
  it('falls back to local_field-owned template when union template is missing', async () => {
    mockPrismaService.folder_templates.findFirst
      .mockResolvedValueOnce(null)              // union query → not found
      .mockResolvedValueOnce(mockLFTemplate);   // LF query → found

    await service.createFolderForEnrollment(ENROLLMENT_ID);

    const createArg = mockTx.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.folder_template_id).toBe(FOLDER_TEMPLATE_ID_LF);

    expect(mockPrismaService.folder_templates.findFirst).toHaveBeenCalledTimes(2);
    const lfCall = mockPrismaService.folder_templates.findFirst.mock.calls[1][0];
    expect(lfCall.where.owner_local_field_id).toBe(3);
  });

  // ---------------------------------------------------------------
  // 3. Neither exists → NotFoundException
  // ---------------------------------------------------------------
  it('throws NotFoundException when neither union nor LF template exists', async () => {
    mockPrismaService.folder_templates.findFirst.mockResolvedValue(null);

    await expect(
      service.createFolderForEnrollment(ENROLLMENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------------------------------------------------------------
  // 4. Both exist → union wins (R-C5-2)
  // ---------------------------------------------------------------
  it('prefers union template when both union and LF templates exist', async () => {
    mockPrismaService.folder_templates.findFirst
      .mockResolvedValueOnce(mockUnionTemplate) // union query → found, short-circuits
      .mockResolvedValueOnce(mockLFTemplate);   // LF query — never called

    await service.createFolderForEnrollment(ENROLLMENT_ID);

    // Union wins — only 1 findFirst call
    expect(mockPrismaService.folder_templates.findFirst).toHaveBeenCalledTimes(1);
    const createArg = mockTx.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.folder_template_id).toBe(FOLDER_TEMPLATE_ID_UNION);
  });

  // ---------------------------------------------------------------
  // 5. Enrollment not found → NotFoundException
  // ---------------------------------------------------------------
  it('throws NotFoundException when enrollment does not exist', async () => {
    mockPrismaService.club_enrollments.findUnique.mockResolvedValue(null);

    await expect(
      service.createFolderForEnrollment(ENROLLMENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------------------------------------------------------------
  // 6. T-B2-1: Eager evaluation rows — N sections → N createMany rows
  // ---------------------------------------------------------------
  it('creates one evaluation row per template section inside the transaction (T-B2-1)', async () => {
    const mockSections = [
      { section_id: 'sec-uuid-0001', folder_template_id: FOLDER_TEMPLATE_ID_UNION, max_points: 10, order: 1, name: 'S1', description: null },
      { section_id: 'sec-uuid-0002', folder_template_id: FOLDER_TEMPLATE_ID_UNION, max_points: 20, order: 2, name: 'S2', description: null },
      { section_id: 'sec-uuid-0003', folder_template_id: FOLDER_TEMPLATE_ID_UNION, max_points: 15, order: 3, name: 'S3', description: null },
    ];

    mockPrismaService.folder_templates.findFirst.mockResolvedValueOnce(mockUnionTemplate);
    mockTx.folder_template_sections.findMany.mockResolvedValue(mockSections);
    mockTx.annual_folder_section_evaluations.createMany.mockResolvedValue({ count: 3 });

    await service.createFolderForEnrollment(ENROLLMENT_ID);

    // $transaction was called
    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);

    // createMany called once with exactly 3 rows
    expect(mockTx.annual_folder_section_evaluations.createMany).toHaveBeenCalledTimes(1);
    const createManyArg = mockTx.annual_folder_section_evaluations.createMany.mock.calls[0][0];
    expect(createManyArg.data).toHaveLength(3);

    // Each row maps correctly
    expect(createManyArg.data[0]).toMatchObject({
      annual_folder_id: 'folder-uuid',
      section_id: 'sec-uuid-0001',
      earned_points: 0,
      max_points: 10,
      status: 'PENDING',
    });
    expect(createManyArg.data[1].max_points).toBe(20);
    expect(createManyArg.data[2].max_points).toBe(15);
  });
});
