import { Test, TestingModule } from '@nestjs/testing';
import { FinancesService } from './finances.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { ErrorCode } from '../common/errors/error-codes';
import { FinancePeriodService } from './finance-period.service';

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
    },
    clubs: {
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
  };

  const mockFinancePeriodService = {
    validatePeriodOpen: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FinancePeriodService, useValue: mockFinancePeriodService },
      ],
    }).compile();

    service = module.get<FinancesService>(FinancesService);
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

      expect(result.data).toEqual(mockFinances);
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
      mockPrismaService.finances.create.mockResolvedValue(mockFinance);

      const result = await service.create(createDto, 'user-123', 1);

      expect(result).toEqual(mockFinance);
    });
  });

  describe('findOne', () => {
    it('should return finance by id', async () => {
      const mockFinance = { finance_id: 1, amount: 1000 };
      mockPrismaService.finances.findUnique.mockResolvedValue(mockFinance);

      const result = await service.findOne(1);

      expect(result).toEqual(mockFinance);
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
