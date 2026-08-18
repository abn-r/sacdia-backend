import { Test, TestingModule } from '@nestjs/testing';
import { FinancesService } from './finances.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { FinancePeriodService } from './finance-period.service';
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
  };

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
        { provide: TranslationService, useValue: mockTranslationService },
        {
          provide: CatalogCacheService,
          useValue: {
            getEpoch: jest.fn().mockResolvedValue(0),
            getOrSet: jest.fn(
              (_key: string, loader: () => Promise<unknown>) => loader(),
            ),
          },
        },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<FinancesService>(FinancesService);
    mockPrismaService.finance_evidence_files.findMany.mockResolvedValue([]);
    mockFileStorageService.getSignedDownloadUrl.mockImplementation(
      async (_bucket, value) => value,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
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
        mockFinances.map((finance) => ({ ...finance, evidences: [] })),
      );
      expect(result.meta.total).toBe(1);
    });

    it('should throw NotFoundException when club not found', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.findByClub(999)).rejects.toMatchObject({
        code: ErrorCode.FINANCE_CLUB_NOT_FOUND,
      });
    });
  });

  describe('getSummary', () => {
    it('should return financial summary', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 1 }],
      };

      const mockMovements = [
        { amount: 1000, finances_categories: { type: 0 } }, // income
        { amount: 500, finances_categories: { type: 0 } }, // income
        { amount: 300, finances_categories: { type: 1 } }, // expense
      ];

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.finances.findMany.mockResolvedValue(mockMovements);

      const result = await service.getSummary(1);

      expect(result.total_income).toBe(1500);
      expect(result.total_expense).toBe(300);
      expect(result.balance).toBe(1200);
    });

    it('should return carried ecclesiastical-year balance through selected month', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 10 }],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        start_date: new Date('2025-10-01T00:00:00.000Z'),
        end_date: new Date('2026-09-30T00:00:00.000Z'),
      });
      mockPrismaService.financePeriodClosing.findMany.mockResolvedValue([
        {
          year: 2026,
          month: 1,
          total_income: 100,
          total_expense: 0,
          balance: 100,
          movement_count: 1,
          breakdown: {},
        },
        {
          year: 2026,
          month: 2,
          total_income: 0,
          total_expense: 500,
          balance: -500,
          movement_count: 1,
          breakdown: {},
        },
      ]);
      mockPrismaService.finances.findMany.mockResolvedValue([
        { amount: 1000, finances_categories: { type: 0 } },
        { amount: 1000, finances_categories: { type: 0 } },
      ]);

      const result = await service.getSummary(1, 2026, 4);

      expect(result.total_income).toBe(2100);
      expect(result.total_expense).toBe(500);
      expect(result.balance).toBe(1600);
      expect(
        mockPrismaService.financePeriodClosing.findMany,
      ).toHaveBeenCalled();
      expect(mockPrismaService.finances.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { year: 2025, month: 10 },
              { year: 2026, month: 3 },
              { year: 2026, month: 4 },
            ]),
          }),
        }),
      );
    });

    it('should use closed-period section breakdown when summary is section-scoped', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 10 }, { club_section_id: 11 }],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        start_date: new Date('2026-01-01T00:00:00.000Z'),
        end_date: new Date('2026-12-31T00:00:00.000Z'),
      });
      mockPrismaService.financePeriodClosing.findMany.mockResolvedValue([
        {
          year: 2026,
          month: 1,
          total_income: 999,
          total_expense: 999,
          balance: 0,
          movement_count: 10,
          breakdown: {
            by_section: [
              {
                club_section_id: 10,
                income: 300,
                expense: 100,
                balance: 200,
              },
              {
                club_section_id: 11,
                income: 200,
                expense: 50,
                balance: 150,
              },
            ],
          },
        },
      ]);
      mockPrismaService.finances.findMany.mockResolvedValue([]);

      const result = await service.getSummary(1, 2026, 1, 10);

      expect(result.total_income).toBe(300);
      expect(result.total_expense).toBe(100);
      expect(result.balance).toBe(200);
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
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 1,
        active: true,
        type: 0,
      });
      mockPrismaService.finances.create.mockResolvedValue(mockFinance);

      const result = await service.create(createDto, 'user-123', 1);

      expect(result).toEqual({ ...mockFinance, evidences: [] });
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
      const mockFinance = { finance_id: 1, amount: 1000 };
      mockPrismaService.finances.findUnique.mockResolvedValue(mockFinance);

      const result = await service.findOne(1);

      expect(result).toEqual({ ...mockFinance, evidences: [] });
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

    it('should call validatePeriodOpen before creating a movement', async () => {
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 1,
        active: true,
        type: 0,
      });
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
      );
    });

    it('should throw ForbiddenException when period is closed for non-admin', async () => {
      mockFinancePeriodService.validatePeriodOpen.mockRejectedValue(
        new ForbiddenException('El periodo 2/2026 está cerrado'),
      );

      await expect(service.create(createDto, 'user-123', 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrismaService.finances.create).not.toHaveBeenCalled();
    });

    it('should persist post_closing_note when provided', async () => {
      const dtoWithNote = {
        ...createDto,
        post_closing_note: 'Ajuste autorizado',
      };
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances_categories.findUnique.mockResolvedValue({
        finance_category_id: 1,
        active: true,
        type: 0,
      });
      mockPrismaService.finances.create.mockResolvedValue({
        finance_id: 1,
        ...dtoWithNote,
      });

      await service.create(dtoWithNote, 'admin-user', 1);

      expect(mockPrismaService.finances.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            post_closing_note: 'Ajuste autorizado',
          }),
        }),
      );
    });
  });

  describe('update — period validation', () => {
    it('should resolve clubId from movement and validate period before updating', async () => {
      const existingMovement = {
        finance_id: 1,
        year: 2026,
        month: 2,
        amount: 1000,
        club_section_id: 10,
        finances_categories: { name: 'Cuotas', type: 0 },
        club_types: { name: 'Conquistadores' },
        users: null,
      };

      mockPrismaService.finances.findUnique.mockResolvedValue(existingMovement);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        main_club_id: 1,
      });
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances.update.mockResolvedValue({
        finance_id: 1,
        amount: 2000,
      });

      await service.update(1, { amount: 2000 }, 'user-123');

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'user-123',
      );
    });

    it('should skip period validation when movement has no club_section_id', async () => {
      const existingMovement = {
        finance_id: 1,
        year: 2026,
        month: 2,
        amount: 1000,
        club_section_id: null,
        finances_categories: { name: 'Cuotas', type: 0 },
        club_types: { name: 'Conquistadores' },
        users: null,
      };

      mockPrismaService.finances.findUnique.mockResolvedValue(existingMovement);
      mockPrismaService.finances.update.mockResolvedValue({
        finance_id: 1,
        amount: 2000,
      });

      await service.update(1, { amount: 2000 }, 'user-123');

      expect(
        mockFinancePeriodService.validatePeriodOpen,
      ).not.toHaveBeenCalled();
    });

    it('rejects replacing a movement category with an inactive category', async () => {
      const existingMovement = {
        finance_id: 1,
        year: 2026,
        month: 2,
        amount: 1000,
        club_section_id: null,
        finances_categories: { name: 'Cuotas', type: 0 },
        club_types: { name: 'Conquistadores' },
        users: null,
      };

      mockPrismaService.finances.findUnique.mockResolvedValue(existingMovement);
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
  });

  describe('remove — period validation', () => {
    it('should resolve clubId and validate period before soft-deleting', async () => {
      const existingMovement = {
        finance_id: 1,
        year: 2026,
        month: 2,
        amount: 1000,
        club_section_id: 10,
        finances_categories: { name: 'Cuotas', type: 0 },
        club_types: { name: 'Conquistadores' },
        users: null,
      };

      mockPrismaService.finances.findUnique.mockResolvedValue(existingMovement);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        main_club_id: 1,
      });
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances.update.mockResolvedValue({
        finance_id: 1,
        active: false,
      });

      await service.remove(1, 'user-123');

      expect(mockFinancePeriodService.validatePeriodOpen).toHaveBeenCalledWith(
        1,
        2026,
        2,
        'user-123',
      );
    });

    it('should persist reason as post_closing_note before soft-deleting', async () => {
      const existingMovement = {
        finance_id: 1,
        year: 2026,
        month: 2,
        amount: 1000,
        club_section_id: 10,
        finances_categories: { name: 'Cuotas', type: 0 },
        club_types: { name: 'Conquistadores' },
        users: null,
      };

      mockPrismaService.finances.findUnique.mockResolvedValue(existingMovement);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        main_club_id: 1,
      });
      mockFinancePeriodService.validatePeriodOpen.mockResolvedValue(undefined);
      mockPrismaService.finances.update.mockResolvedValue({
        finance_id: 1,
        active: false,
      });

      await service.remove(1, 'user-123', 'Error de duplicado');

      expect(mockPrismaService.finances.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            post_closing_note: 'Error de duplicado',
          }),
        }),
      );
    });
  });
});
