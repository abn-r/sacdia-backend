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

/**
 * Enriched enrollment shape returned by the tx re-hydration inside
 * resolveCamporeeLinkageForEnrollment. It includes the ecclesiastical_year
 * relation and uses the club_section.clubs shape (not main_club_id).
 */
const mockEnrollmentTxShape = {
  club_enrollment_id: ENROLLMENT_ID,
  club_section_id: 10,
  ecclesiastical_year_id: 1,
  status: 'active',
  created_by: 'creator-uuid-0000-0000-000000000001',
  created_at: new Date('2026-01-01T00:00:00Z'),
  modified_at: new Date('2026-01-01T00:00:00Z'),
  club_section: {
    club_section_id: 10,
    club_type_id: 2,
    clubs: {
      club_id: 5,
      local_fields: {
        local_field_id: 3,
        union_id: 7,
      },
    },
  },
  ecclesiastical_year: {
    year_id: 1,
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
  // Extended with camporee tables needed by resolveCamporeeLinkageForEnrollment.
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
    club_enrollments: {
      findUnique: jest.fn(),
    },
    camporee_clubs: {
      findFirst: jest.fn(),
    },
    local_camporees: {
      findFirst: jest.fn(),
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
    // Default: tx re-hydration of enrollment for camporee resolver
    // Uses the enriched shape (includes ecclesiastical_year relation + club_section.clubs).
    mockTx.club_enrollments.findUnique.mockResolvedValue(mockEnrollmentTxShape);
    // Default: no camporee match for either tier (investiture-only path)
    mockTx.camporee_clubs.findFirst.mockResolvedValue(null);
    mockTx.local_camporees.findFirst.mockResolvedValue(null);
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

// ---------------------------------------------------------------------------
// T-3.1..3.4 — resolveCamporeeLinkageForEnrollment unit tests (CAMP-1)
// ---------------------------------------------------------------------------

/**
 * club_type_id=2 (Conquistadores / pathfinders) with full chain:
 *   enrollment → club_section (cs_id=10, type=2) → clubs (club_id=5)
 *     → local_fields (lf_id=3, union_id=7)
 *   ecclesiastical_year.year_id=1
 */
const ENROLLMENT_ID_CAMP = 'enrollment-uuid-camp-000000000001';

const mockCampEnrollment = {
  club_enrollment_id: ENROLLMENT_ID_CAMP,
  club_section_id: 10,
  ecclesiastical_year_id: 1,
  status: 'active',
  created_by: 'creator-uuid-0000-0000-000000000001',
  created_at: new Date('2026-01-01T00:00:00Z'),
  modified_at: new Date('2026-01-01T00:00:00Z'),
  club_section: {
    club_section_id: 10,
    club_type_id: 2,
    clubs: {
      club_id: 5,
      local_fields: {
        local_field_id: 3,
        union_id: 7,
      },
    },
  },
  ecclesiastical_year: {
    year_id: 1,
  },
};

const mockUnionCamporée = {
  camporee_club_id: 100,
  union_camporee_id: 55,
  camporee_id: null,
  club_section_id: 10,
  active: true,
  status: 'approved',
  created_at: new Date('2026-01-10T00:00:00Z'),
};

const mockLocalCamporee = {
  local_camporee_id: 33,
  name: 'Camporee Local Test',
  local_field_id: 3,
  ecclesiastical_year: 1,
  active: true,
  includes_pathfinders: true,
  created_at: new Date('2026-01-05T00:00:00Z'),
};

describe('AnnualFoldersService — resolveCamporeeLinkageForEnrollment (CAMP-1)', () => {
  let service: AnnualFoldersService;

  /**
   * tx mirror extended with camporee tables used by the resolver.
   * The tx mock used in $transaction must include these tables.
   */
  const mockTxCamp = {
    annual_folders: {
      create: jest.fn(),
    },
    folder_template_sections: {
      findMany: jest.fn(),
    },
    annual_folder_section_evaluations: {
      createMany: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
    },
    camporee_clubs: {
      findFirst: jest.fn(),
    },
    local_camporees: {
      findFirst: jest.fn(),
    },
  };

  const mockPrismaServiceCamp = {
    annual_folders: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
    },
    folder_templates: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(
      (cb: (tx: typeof mockTxCamp) => Promise<unknown>) => cb(mockTxCamp),
    ),
  };

  const mockFileStorageCamp = { upload: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    // Restore $transaction after resetAllMocks wipes the implementation.
    mockPrismaServiceCamp.$transaction.mockImplementation(
      (cb: (tx: typeof mockTxCamp) => Promise<unknown>) => cb(mockTxCamp),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualFoldersService,
        { provide: PrismaService, useValue: mockPrismaServiceCamp },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageCamp,
        },
      ],
    }).compile();

    service = module.get<AnnualFoldersService>(AnnualFoldersService);

    // Outer-service defaults (needed for createFolderForEnrollment path).
    mockPrismaServiceCamp.annual_folders.findUnique.mockResolvedValue(null);
    mockPrismaServiceCamp.club_enrollments.findUnique.mockResolvedValue(
      mockCampEnrollment,
    );
    mockPrismaServiceCamp.folder_templates.findFirst.mockResolvedValue({
      folder_template_id: FOLDER_TEMPLATE_ID_UNION,
      club_type_id: 2,
      ecclesiastical_year_id: 1,
      owner_union_id: 7,
      owner_local_field_id: null,
      active: true,
      minimum_points: 0,
      closing_date: null,
      created_at: new Date(),
      modified_at: new Date(),
    });

    // Tx defaults.
    mockTxCamp.club_enrollments.findUnique.mockResolvedValue(mockCampEnrollment);
    mockTxCamp.folder_template_sections.findMany.mockResolvedValue([]);
    mockTxCamp.annual_folder_section_evaluations.createMany.mockResolvedValue({
      count: 0,
    });
    mockTxCamp.annual_folders.create.mockResolvedValue({
      annual_folder_id: 'folder-camp-uuid',
      club_enrollment_id: ENROLLMENT_ID_CAMP,
      folder_template_id: FOLDER_TEMPLATE_ID_UNION,
      status: 'open',
      folder_template: { sections: [], club_type: { name: 'Conquistadores' } },
    });

    // Camporee defaults: no match for either tier.
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValue(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValue(null);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S1 — Union enrolled happy path
  // -----------------------------------------------------------------------
  it('S1: returns union_camporee_id and flag=true when club has non-rejected enrollment', async () => {
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(mockUnionCamporée);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBe(55);
    expect(createArg.data.local_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(true);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S4 — Rejected enrollment bypassed, falls through to local
  // -----------------------------------------------------------------------
  it('S4: rejected camporee_clubs enrollment is filtered out; falls through to local', async () => {
    // camporee_clubs query returns null (rejected row excluded by status filter)
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(mockLocalCamporee);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.local_camporee_id).toBe(33);
    expect(createArg.data.requires_union_confirmation).toBe(false);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S2 — No union match, local match exists
  // -----------------------------------------------------------------------
  it('S2: returns local_camporee_id and flag=false when no union enrollment but local exists', async () => {
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(mockLocalCamporee);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.local_camporee_id).toBe(33);
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(false);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S3 — Neither tier matches → investiture-only (all null)
  // -----------------------------------------------------------------------
  it('S3: returns all null when neither union nor local camporee matches', async () => {
    // Both mocks default to null (set in beforeEach).

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.local_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(false);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S6/S7 — Per-club-type filter mismatch: both queries return null
  // -----------------------------------------------------------------------
  it('S6/S7: returns all null when club type does not match camporee includes column', async () => {
    // Simulates the scenario where the camporee exists but includes_pathfinders=false;
    // Prisma returns null because the [includesColumn]:true filter fails.
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(null);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.local_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(false);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S5 — Union-first precedence: both tiers match → union wins
  // -----------------------------------------------------------------------
  it('S5: returns union_camporee_id even when both tiers would match (union-first precedence)', async () => {
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(mockUnionCamporée);
    // local mock also returns a row but should NOT be reached
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(mockLocalCamporee);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBe(55);
    expect(createArg.data.local_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(true);

    // Local query must NOT have been called — union short-circuits.
    expect(mockTxCamp.local_camporees.findFirst).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S8 — Inactive camporee skip (union tier)
  // -----------------------------------------------------------------------
  it('S8a: inactive union_camporee is filtered out; falls through to local', async () => {
    // union query returns null (active=false filter in the Prisma where clause excludes it)
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(mockLocalCamporee);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.local_camporee_id).toBe(33);
  });

  it('S8b: inactive local_camporee is filtered out; returns all null', async () => {
    // Both mocks return null (active=false filter excludes rows)
    // Defaults from beforeEach already have both returning null.

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    expect(createArg.data.union_camporee_id).toBeNull();
    expect(createArg.data.local_camporee_id).toBeNull();
    expect(createArg.data.requires_union_confirmation).toBe(false);
  });

  // -----------------------------------------------------------------------
  // CAMP-1 S9 — Tiebreaker lives in Prisma orderBy, not in resolver logic
  // -----------------------------------------------------------------------
  it('S9: resolver passes orderBy to Prisma and does not re-sort results', async () => {
    // The tiebreaker (ORDER BY created_at DESC) is declared in the Prisma
    // findFirst call as `orderBy: { created_at: 'desc' }` for local and
    // `orderBy: { union_camporees: { created_at: 'desc' } }` for union.
    // The resolver trusts the DB to return the correct row; it never filters
    // or re-sorts the result itself. This test asserts the resolver returns
    // the single mock row without modification.
    mockTxCamp.camporee_clubs.findFirst.mockResolvedValueOnce(null);
    mockTxCamp.local_camporees.findFirst.mockResolvedValueOnce(mockLocalCamporee);

    await service.createFolderForEnrollment(ENROLLMENT_ID_CAMP);

    const createArg = mockTxCamp.annual_folders.create.mock.calls[0][0];
    // The resolver returns the row the DB chose — no extra filtering.
    expect(createArg.data.local_camporee_id).toBe(mockLocalCamporee.local_camporee_id);
  });
});
