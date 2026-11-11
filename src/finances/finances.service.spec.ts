import { Test, TestingModule } from '@nestjs/testing';
import { FinancesService } from './finances.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FinancePeriodService,
  closedPeriodKey,
} from './finance-period.service';
import { FinanceAggregationService } from './finance-aggregation.service';
import { TranslationService } from '../common/services/translation.service';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

describe('FinancesService', () => {
  let service: FinancesService;

  const mockPrismaService = {
    finances: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    finances_categories: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    clubs: {
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    financePeriodClosing: {
      findMany: jest.fn(),
    },
    finance_evidence_files: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockFinancePeriodService = {
    validatePeriodOpen: jest.fn(),
    validateUnscopedMovement: jest.fn(),
    getClosedPeriodKeys: jest.fn(),
  };

  const mockAggregation = {
    resolveClubScope: jest.fn(),
    aggregate: jest.fn(),
  };

  const openGuard = { closed: false, note: null };

  const mockTranslationService: Partial<TranslationService> = {
    getCurrentLocale: jest.fn().mockReturnValue('es'),
    translateMany: jest.fn().mockImplementation((records) => records),
  };

  const mockFileStorageService = {
    upload: jest.fn(),
    deleteMany: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FinancePeriodService, useValue: mockFinancePeriodService },
        { provide: FinanceAggregationService, useValue: mockAggregation },
        { provide: TranslationService, useValue: mockTranslationService },
        {
          provide: CatalogCacheService,
          useValue: {
            getEpoch: jest.fn().mockResolvedValue(0),
            getOrSet: jest.fn((_key: string, loader: () => Promise<unknown>) =>
              loader(),
            ),
          },
        },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<FinancesService>(FinancesService);
    mockPrismaService.finance_evidence_files.findMany.mockResolvedValue([]);
    mockFinancePeriodService.getClosedPeriodKeys.mockResolvedValue(new Set());
    mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(openGuard);
    mockFileStorageService.getSignedDownloadUrl.mockImplementation(
      async (_bucket, value) => value,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
    mockTranslationService.getCurrentLocale = jest.fn().mockReturnValue('es');
    mockTranslationService.translateMany = jest
      .fn()
      .mockImplementation((records) => records);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCategories', () => {
    it('should return active finance categories', async () => {
      const mockCategories = [
        { finance_category_id: 1, name: 'Cuotas', type: 0 },
        { finance_category_id: 2, name: 'Materiales', type: 1 },
      ];

      mockPrismaService.finances_categories.findMany.mockResolvedValue(
        mockCategories,
      );

      const result = await service.getCategories();

      expect(result).toEqual(mockCategories);
    });

    it('should filter by type', async () => {
      mockPrismaService.finances_categories.findMany.mockResolvedValue([]);

      await service.getCategories(0); // Income only

      expect(
        mockPrismaService.finances_categories.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 0,
          }),
        }),
      );
    });
  });

  describe('findByClub', () => {
    it('should return paginated finances for a club', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 1 }],
      };
      const mockFinances = [
        { finance_id: 1, amount: 1000, description: 'Cuota mensual' },
      ];

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.finances.findMany.mockResolvedValue(mockFinances);
      mockPrismaService.finances.count.mockResolvedValue(1);

      const result = await service.findByClub(1);

      expect(result.data).toEqual(
        mockFinances.map((finance) => ({
          ...finance,
          evidences: [],
          period_closed: false,
        })),
      );
      expect(result.meta.total).toBe(1);
      // Admin path filters through the section relation: no section pre-fetch.
      expect(mockPrismaService.clubs.findUnique).toHaveBeenCalledWith({
        where: { club_id: 1 },
        select: { club_id: true },
      });
      expect(mockPrismaService.finances.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            club_sections: { main_club_id: 1 },
          }),
        }),
      );
    });

    it('scopes a member to their own section', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.finances.findMany.mockResolvedValue([]);
      mockPrismaService.finances.count.mockResolvedValue(0);

      await service.findByClub(1, undefined, undefined, 7);

      const where = mockPrismaService.finances.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ active: true, club_section_id: 7 });
      expect(where).not.toHaveProperty('club_sections');
    });

    it('filters by an exact section of the club', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.finances.findMany.mockResolvedValue([]);
      mockPrismaService.finances.count.mockResolvedValue(0);

      await service.findByClub(1, { clubSectionId: 9 });

      const where = mockPrismaService.finances.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        active: true,
        club_section_id: 9,
        club_sections: { main_club_id: 1 },
      });
    });

    it('lets a section-scoped member ask for their own section', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.finances.findMany.mockResolvedValue([]);
      mockPrismaService.finances.count.mockResolvedValue(0);

      await service.findByClub(1, { clubSectionId: 7 }, undefined, 7);

      const where = mockPrismaService.finances.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ club_section_id: 7 });
    });

    it('rejects a section-scoped member asking for another section', async () => {
      await expect(
        service.findByClub(1, { clubSectionId: 8 }, undefined, 7),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(mockPrismaService.finances.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when club not found', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.findByClub(999)).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLUB_NOT_FOUND,
      });
    });
  });

  describe('getAllTransactions search', () => {
    it('escapes LIKE wildcards in description and category search', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_sections: [{ club_section_id: 7 }],
      });
      mockPrismaService.finances.findMany.mockResolvedValue([]);
      mockPrismaService.finances.count.mockResolvedValue(0);

      await service.getAllTransactions(1, { search: 'cuota%_1' }, null);

      const { where } = mockPrismaService.finances.findMany.mock.calls[0][0];
      const escaped = 'cuota\\%\\_1';
      expect(where.OR).toEqual([
        { description: { contains: escaped, mode: 'insensitive' } },
        {
          finances_categories: {
            name: { contains: escaped, mode: 'insensitive' },
          },
        },
      ]);
    });
  });

  describe('getSummary', () => {
    const scope = (ids: number[]) => ({
      club: { club_id: 1, name: 'ACV' },
      sections: ids.map((id) => ({ club_section_id: id, name: 'Conq' })),
      sectionIds: ids,
    });
    const totals = (over: Partial<Record<string, number>> = {}) => ({
      income: 1500,
      expenses: 300,
      net: 1200,
      movements: 3,
      balance: 5000,
      ...over,
    });

    it('returns the period totals plus the all-time balance (no period)', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope([1]));
      mockAggregation.aggregate.mockResolvedValue(totals({ balance: 1200 }));

      const result = await service.getSummary(1);

      expect(mockAggregation.aggregate).toHaveBeenCalledWith([1], {});
      expect(result).toEqual({
        club_id: 1,
        period: 'all',
        total_income: 1500,
        total_expense: 300,
        net: 1200,
        balance: 1200,
        movement_count: 3,
        year_income: 1500,
        year_expenses: 300,
        period_closed: null,
      });
    });

    it('year + month: period totals of the month, all-time balance, ecclesiastical year to date and period_closed', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope([10]));
      // 1st call: the month. 2nd call: ecclesiastical year to date.
      mockAggregation.aggregate
        .mockResolvedValueOnce(
          totals({
            income: 400,
            expenses: 100,
            net: 300,
            movements: 2,
            balance: 9000,
          }),
        )
        .mockResolvedValueOnce(
          totals({ income: 2100, expenses: 500, net: 1600, movements: 9 }),
        );
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        start_date: new Date('2025-10-01T00:00:00.000Z'),
      });
      mockFinancePeriodService.getClosedPeriodKeys.mockResolvedValue(
        new Set([closedPeriodKey(2026, 4)]),
      );

      const result = await service.getSummary(1, 2026, 4);

      expect(mockAggregation.aggregate).toHaveBeenNthCalledWith(1, [10], {
        from: { year: 2026, month: 4 },
        to: { year: 2026, month: 4 },
      });
      expect(mockAggregation.aggregate).toHaveBeenNthCalledWith(2, [10], {
        from: { year: 2025, month: 10 },
        to: { year: 2026, month: 4 },
      });
      expect(result).toMatchObject({
        period: '2026-04',
        total_income: 400,
        total_expense: 100,
        net: 300,
        balance: 9000,
        movement_count: 2,
        year_income: 2100,
        year_expenses: 500,
        period_closed: true,
      });
    });

    it('year only: whole calendar year range', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope([1, 2]));
      mockAggregation.aggregate.mockResolvedValue(totals());

      const result = await service.getSummary(1, 2026);

      expect(mockAggregation.aggregate).toHaveBeenCalledWith([1, 2], {
        from: { year: 2026, month: 1 },
        to: { year: 2026, month: 12 },
      });
      expect(result.period).toBe('2026');
      expect(result.period_closed).toBeNull();
    });

    it('passes the member section and the requested section to the scope resolver', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope([7]));
      mockAggregation.aggregate.mockResolvedValue(totals());

      await service.getSummary(1, undefined, undefined, 7, 7);

      expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(1, 7, 7);
      expect(mockAggregation.aggregate).toHaveBeenCalledWith([7], {});
    });

    it('never reads the closing snapshots for totals', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope([10]));
      mockAggregation.aggregate.mockResolvedValue(totals());
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);

      await service.getSummary(1, 2026, 1);

      expect(
        mockPrismaService.financePeriodClosing.findMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('uploadEvidence', () => {
    const imageFile = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      mimetype: 'image/jpeg',
      originalname: 'recibo.jpg',
      size: 4,
    } as Express.Multer.File;

    it('uploads an image evidence while the movement has fewer than 3 active evidences', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue({
        finance_id: 100,
      });
      mockPrismaService.finance_evidence_files.count.mockResolvedValue(2);
      mockFileStorageService.upload.mockResolvedValue({
        key: 'finances/100/evidence-1.jpg',
        url: 'finances/100/evidence-1.jpg',
      });
      mockPrismaService.finance_evidence_files.create.mockResolvedValue({
        finance_evidence_file_id: 12,
        finance_id: 100,
        file_url: 'finances/100/evidence-1.jpg',
        file_name: 'recibo.jpg',
        file_type: 'image/jpeg',
        file_size: 4,
        uploaded_by_id: 'user-abc',
        uploaded_at: new Date('2026-06-19T00:00:00.000Z'),
        active: true,
      });

      const result = await service.uploadEvidence(100, 'user-abc', imageFile);

      expect(mockFileStorageService.upload).toHaveBeenCalledWith(
        StorageBucketAlias.EVIDENCE_FILES,
        expect.stringMatching(/^finances\/100\/evidence-/),
        imageFile.buffer,
        { contentType: 'image/jpeg' },
      );
      expect(result).toMatchObject({
        evidence_id: 12,
        finance_id: 100,
        file_name: 'recibo.jpg',
      });
    });

    it('rejects evidence upload when the movement already has 3 active evidences', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue({
        finance_id: 100,
      });
      mockPrismaService.finance_evidence_files.count.mockResolvedValue(3);

      await expect(
        service.uploadEvidence(100, 'user-abc', imageFile),
      ).rejects.toMatchObject({
        code: ErrorCode.FINANCE_EVIDENCE_LIMIT_EXCEEDED,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a finance record', async () => {
      const createDto = {
        year: 2026,
        month: 1,
        amount: 1000,
        club_type_id: 2,
        finance_category_id: 1,
        finance_date: '2026-01-15',
        club_section_id: 1,
      };

      const mockFinance = { finance_id: 1, ...createDto };
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 1,
        active: true,
        type: 0,
      });
      mockPrismaService.finances.create.mockResolvedValue(mockFinance);

      const result = await service.create(createDto, 'user-123', 1);

      expect(result).toEqual({
        ...mockFinance,
        period_closed: false,
        evidences: [],
      });
    });

    it('rejects a finance category that does not exist', async () => {
      const createDto = {
        year: 2026,
        month: 1,
        amount: 1000,
        club_type_id: 2,
        finance_category_id: 999,
        finance_date: '2026-01-15',
        club_section_id: 1,
      };
      mockPrismaService.finances_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.create(createDto, 'user-123', 1),
      ).rejects.toMatchObject({
        code: 'FINANCE_CATEGORY_NOT_FOUND',
      });
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });

    it('rejects an inactive finance category', async () => {
      const createDto = {
        year: 2026,
        month: 1,
        amount: 1000,
        club_type_id: 2,
        finance_category_id: 2,
        finance_date: '2026-01-15',
        club_section_id: 1,
      };
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 2,
        active: false,
        type: 1,
      });

      await expect(
        service.create(createDto, 'user-123', 1),
      ).rejects.toMatchObject({
        code: 'FINANCE_CATEGORY_INACTIVE',
      });
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });

    it('rejects a finance category with an unsupported type', async () => {
      const createDto = {
        year: 2026,
        month: 1,
        amount: 1000,
        club_type_id: 2,
        finance_category_id: 3,
        finance_date: '2026-01-15',
        club_section_id: 1,
      };
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 3,
        active: true,
        type: 2,
      });

      await expect(
        service.create(createDto, 'user-123', 1),
      ).rejects.toMatchObject({
        code: 'FINANCE_CATEGORY_TYPE_INVALID',
      });
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return finance by id', async () => {
      const mockFinance = {
        finance_id: 1,
        amount: 1000,
        year: 2026,
        month: 2,
        club_section_id: 10,
      };
      mockPrismaService.finances.findUnique.mockResolvedValue(mockFinance);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
      });

      const result = await service.findOne(1);

      expect(result).toEqual({
        ...mockFinance,
        period_closed: false,
        evidences: [],
      });
    });

    it('marks period_closed when the movement month is closed', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue({
        finance_id: 1,
        year: 2026,
        month: 2,
        club_section_id: 10,
      });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
      });
      mockFinancePeriodService.getClosedPeriodKeys.mockResolvedValue(
        new Set([closedPeriodKey(2026, 2)]),
      );

      const result = await service.findOne(1);

      expect(result.period_closed).toBe(true);
    });

    it('treats a legacy movement without section as closed (club unknown)', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue({
        finance_id: 1,
        year: 2026,
        month: 2,
        club_section_id: null,
      });

      const result = await service.findOne(1);

      expect(result.period_closed).toBe(true);
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.FINANCE_TRANSACTION_NOT_FOUND,
      });
    });
  });

  describe('create — period validation', () => {
    const createDto = {
      year: 2026,
      month: 2,
      amount: 1000,
      club_type_id: 2,
      finance_category_id: 1,
      finance_date: '2026-02-15',
      club_section_id: 10,
    };

    const okCategory = () =>
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 1,
        active: true,
        type: 0,
      });

    it('calls validatePeriodOpen with the note before creating a movement', async () => {
      okCategory();
      mockPrismaService.finances.create.mockResolvedValue({
        finance_id: 1,
        ...createDto,
      });

      await service.create(createDto, 'user-123', 1);

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'user-123',
        undefined,
      );
    });

    it('throws when the period is closed for a non-admin', async () => {
      mockFinancePeriodService.validatePeriodOpen.mockRejectedValue(
        new ForbiddenException('El periodo 2/2026 está cerrado'),
      );

      await expect(service.create(createDto, 'user-123', 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });

    it('stores the guard note and flags period_closed in a closed month', async () => {
      const dtoWithNote = {
        ...createDto,
        post_closing_note: '  Ajuste autorizado  ',
      };
      okCategory();
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue({
        closed: true,
        note: 'Ajuste autorizado',
      });
      mockPrismaService.finances.create.mockResolvedValue({
        finance_id: 1,
        ...dtoWithNote,
      });

      const result = await service.create(dtoWithNote, 'admin-user', 1);

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'admin-user',
        '  Ajuste autorizado  ',
      );
      expect(mockPrismaService.finances.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            post_closing_note: 'Ajuste autorizado',
          }),
        }),
      );
      expect(result.period_closed).toBe(true);
    });

    it('does not create when the closed-month note is missing', async () => {
      mockFinancePeriodService.validatePeriodOpen.mockRejectedValue({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });

      await expect(
        service.create(createDto, 'admin-user', 1),
      ).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });

    it('keeps an optional note in an open month', async () => {
      okCategory();
      mockPrismaService.finances.create.mockResolvedValue({ finance_id: 1 });

      await service.create(
        { ...createDto, post_closing_note: ' nota libre ' },
        'user-123',
        1,
      );

      expect(mockPrismaService.finances.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ post_closing_note: 'nota libre' }),
        }),
      );
    });
  });

  describe('update / remove — period validation', () => {
    const movement = (over: Record<string, unknown> = {}) => ({
      finance_id: 1,
      year: 2026,
      month: 2,
      amount: 1000,
      club_section_id: 10,
      finances_categories: { name: 'Cuotas', type: 0 },
      club_types: { name: 'Conquistadores' },
      users: null,
      ...over,
    });

    beforeEach(() => {
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        main_club_id: 1,
      });
      mockPrismaService.finances.update.mockResolvedValue({
        finance_id: 1,
        amount: 2000,
      });
    });

    it('update: resolves the club from the section and validates the period with the note', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());

      await service.update(
        1,
        { amount: 2000, post_closing_note: 'x' },
        'user-123',
      );

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'user-123',
        'x',
      );
    });

    it('update: in a closed month stores the validated note', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue({
        closed: true,
        note: 'Corrección de monto',
      });

      await service.update(
        1,
        { amount: 2000, post_closing_note: ' Corrección de monto ' },
        'admin-user',
      );

      expect(mockPrismaService.finances.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 2000,
            post_closing_note: 'Corrección de monto',
          }),
        }),
      );
    });

    it('update: a closed month without note is rejected and nothing is written', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());
      mockFinancePeriodService.validatePeriodOpen.mockRejectedValue({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });

      await expect(
        service.update(1, { amount: 2000 }, 'admin-user'),
      ).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });
      expect(mockPrismaService.finances.update).not.toHaveBeenCalled();
    });

    it('update: a legacy movement without section goes through the admin-only guard', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(
        movement({ club_section_id: null }),
      );
      mockFinancePeriodService.validateUnscopedMovement.mockResolvedValue({
        closed: true,
        note: 'Nota legado',
      });

      await service.update(
        1,
        { amount: 2000, post_closing_note: 'Nota legado' },
        'admin-user',
      );

      expect(
        mockFinancePeriodService.validateUnscopedMovement,
      ).toHaveBeenCalledWith('admin-user', 'Nota legado');
      expect(
        mockFinancePeriodService.validatePeriodOpen,
      ).not.toHaveBeenCalled();
    });

    it('update: a legacy movement is rejected for a non-admin', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(
        movement({ club_section_id: null }),
      );
      mockFinancePeriodService.validateUnscopedMovement.mockRejectedValue(
        new ForbiddenException('closed'),
      );

      await expect(
        service.update(1, { amount: 2000 }, 'user-123'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.finances.update).not.toHaveBeenCalled();
    });

    it('update: rejects replacing a movement category with an inactive category', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 2,
        active: false,
        type: 1,
      });

      await expect(
        service.update(1, { finance_category_id: 2 }, 'user-123'),
      ).rejects.toMatchObject({ code: 'FINANCE_CATEGORY_INACTIVE' });
      expect(mockPrismaService.finances.update).not.toHaveBeenCalled();
    });

    it('remove: validates the period with the reason before soft-deleting', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());

      await service.remove(1, 'user-123', 'Error de duplicado');

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'user-123',
        'Error de duplicado',
      );
    });

    it('remove: persists the reason as post_closing_note', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());

      await service.remove(1, 'user-123', 'Error de duplicado');

      expect(mockPrismaService.finances.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: false,
            post_closing_note: 'Error de duplicado',
          }),
        }),
      );
    });

    it('remove: a closed month without reason is rejected and the movement stays active', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(movement());
      mockFinancePeriodService.validatePeriodOpen.mockRejectedValue({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });

      await expect(service.remove(1, 'admin-user')).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLOSED_PERIOD_NOTE_REQUIRED,
      });
      expect(mockPrismaService.finances.update).not.toHaveBeenCalled();
    });

    it('remove: a legacy movement without section needs the admin guard', async () => {
      mockPrismaService.finances.findUnique.mockResolvedValue(
        movement({ club_section_id: null }),
      );
      mockFinancePeriodService.validateUnscopedMovement.mockResolvedValue({
        closed: true,
        note: 'Duplicado legado',
      });

      await service.remove(1, 'admin-user', 'Duplicado legado');

      expect(
        mockFinancePeriodService.validateUnscopedMovement,
      ).toHaveBeenCalledWith('admin-user', 'Duplicado legado');
      expect(mockPrismaService.finances.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            post_closing_note: 'Duplicado legado',
          }),
        }),
      );
    });
  });
});
