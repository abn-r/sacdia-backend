import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';

describe('ClassesService', () => {
  let service: ClassesService;

  const createTransactionMock = () => ({
    class_section_progress: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ section_progress_id: 1 }),
      update: jest.fn().mockResolvedValue({ section_progress_id: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    class_module_progress: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ module_progress_id: 1 }),
      update: jest.fn().mockResolvedValue({ module_progress_id: 1 }),
    },
  });

  let transactionMock: ReturnType<typeof createTransactionMock>;

  const mockPrismaService = {
    $transaction: jest.fn(),
    classes: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    ecclesiastical_years: { findFirst: jest.fn() },
    enrollments: { findMany: jest.fn(), findUnique: jest.fn() },
    class_section_progress: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    transactionMock = createTransactionMock();

    mockPrismaService.$transaction.mockImplementation(
      (
        callback: (
          tx: ReturnType<typeof createTransactionMock>,
        ) => Promise<unknown>,
      ) => callback(transactionMock),
    );

    mockPrismaService.classes.findUnique.mockResolvedValue({
      class_id: 7,
      name: 'Amigo',
      class_modules: [
        {
          module_id: 11,
          name: 'Modulo 1',
          class_sections: [
            { section_id: 101, name: 'Seccion 1' },
            { section_id: 102, name: 'Seccion 2' },
          ],
        },
      ],
    });

    const mockFileStorageService = {
      upload: jest.fn(),
      deleteMany: jest.fn(),
      extractKeyFromPublicUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
  });

  describe('getUserProgress', () => {
    it('resolves a single active-year enrollment automatically', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          enrollment_id: 501,
          user_id: 'user-1',
          class_id: 7,
          ecclesiastical_year_id: 2026,
        },
      ]);
      mockPrismaService.class_section_progress.findMany.mockResolvedValue([
        {
          enrollment_id: 501,
          module_id: 11,
          section_id: 101,
          score: 90,
          evidences: null,
        },
      ]);

      const result = await service.getUserProgress('user-1', 7);

      expect(result.enrollment_id).toBe(501);
      expect(
        mockPrismaService.class_section_progress.findMany,
      ).toHaveBeenCalledWith({
        where: {
          enrollment_id: 501,
          active: true,
        },
      });
    });

    it('accepts an explicit enrollment override when ownership matches', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 777,
        user_id: 'user-1',
        class_id: 7,
        ecclesiastical_year_id: 2025,
      });
      mockPrismaService.class_section_progress.findMany.mockResolvedValue([]);

      const result = await service.getUserProgress('user-1', 7, 777);

      expect(result.enrollment_id).toBe(777);
      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.enrollments.findMany).not.toHaveBeenCalled();
    });

    it('throws not found when no active-year enrollment exists', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([]);

      await expect(service.getUserProgress('user-1', 7)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws conflict when class-scoped resolution is ambiguous', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1 },
        { enrollment_id: 2 },
      ]);

      await expect(service.getUserProgress('user-1', 7)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('updateSectionProgress', () => {
    it('writes section and module progress using enrollment ownership', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 901,
        user_id: 'user-1',
        class_id: 7,
        ecclesiastical_year_id: 2026,
      });
      transactionMock.class_section_progress.findMany.mockResolvedValue([
        {
          score: 80,
        },
      ]);

      await service.updateSectionProgress(
        'user-1',
        7,
        11,
        101,
        80,
        { urls: ['https://example.com/evidence'] },
        901,
      );

      const sectionCreateMock = transactionMock.class_section_progress
        .create as jest.Mock;
      const moduleCreateMock = transactionMock.class_module_progress
        .create as jest.Mock;
      const sectionCreateCall = sectionCreateMock.mock.calls[0]?.[0] as {
        data: {
          user_id: string;
          class_id: number;
          module_id: number;
          section_id: number;
          enrollment_id: number;
        };
      };
      const moduleCreateCall = moduleCreateMock.mock.calls[0]?.[0] as {
        data: {
          user_id: string;
          class_id: number;
          module_id: number;
          enrollment_id: number;
          score: number;
        };
      };

      expect(sectionCreateCall.data).toMatchObject({
        user_id: 'user-1',
        class_id: 7,
        module_id: 11,
        section_id: 101,
        enrollment_id: 901,
      });
      expect(moduleCreateCall.data).toMatchObject({
        user_id: 'user-1',
        class_id: 7,
        module_id: 11,
        enrollment_id: 901,
        score: 80,
      });
    });
  });

  describe('enrollUser', () => {
    // Reusable mock for prisma.$transaction
    const setupTransactionMock = (mocks: {
      clubTypes?: any[];
      targetClass?: any;
      investitureCheck?: any;
      activeCount?: number;
      existingEnrollment?: any;
      createResult?: any;
      updateResult?: any;
    }) => {
      const txMock = {
        club_types: {
          findMany: jest.fn().mockResolvedValue(
            mocks.clubTypes ?? [
              { club_type_id: 1, name: 'Aventureros' },
              { club_type_id: 2, name: 'Conquistadores' },
              { club_type_id: 3, name: 'Guías Mayores' },
            ],
          ),
        },
        classes: {
          findUnique: jest.fn().mockResolvedValue(mocks.targetClass ?? null),
        },
        enrollments: {
          findFirst: jest.fn().mockResolvedValue(mocks.investitureCheck ?? null),
          count: jest.fn().mockResolvedValue(mocks.activeCount ?? 0),
          findUnique: jest.fn().mockResolvedValue(mocks.existingEnrollment ?? null),
          create: jest.fn().mockResolvedValue(mocks.createResult ?? { enrollment_id: 1 }),
          update: jest.fn().mockResolvedValue(mocks.updateResult ?? { enrollment_id: 1 }),
        },
      };

      // Note: mockPrismaService.$transaction is already defined in the module setup (jest.fn())
      (mockPrismaService.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: any) => Promise<any>) => callback(txMock),
      );

      return txMock;
    };

    const userId = 'test-user-uuid';
    const classId = 10;
    const yearId = 1;

    it('should allow first enrollment in Aventureros when no active enrollments exist', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
        activeCount: 0,
        createResult: { enrollment_id: 1, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 1, class_id: 10 });
    });

    it('should block Conquistadores enrollment when 1 active Aventureros enrollment exists', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 2, requires_invested_gm: false },
        activeCount: 1,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should block Aventureros enrollment when 1 active Conquistadores enrollment exists', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
        activeCount: 1,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should block GM class with requires_invested_gm when no prior investiture', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 3, requires_invested_gm: true },
        investitureCheck: null,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow GM class with requires_invested_gm when INVESTIDO exists', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 3, requires_invested_gm: true },
        investitureCheck: { enrollment_id: 99, investiture_status: 'INVESTIDO' },
        activeCount: 0,
        createResult: { enrollment_id: 2, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 2, class_id: 10 });
    });

    it('should allow GM class without requires_invested_gm (no investiture needed)', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 3, requires_invested_gm: false },
        activeCount: 0,
        createResult: { enrollment_id: 3, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 3, class_id: 10 });
    });

    it('should block GM enrollment when 2 active GM enrollments exist', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 3, requires_invested_gm: false },
        activeCount: 2,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should block reactivation when enrollment limit is reached', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
        activeCount: 1,
        existingEnrollment: { enrollment_id: 5, active: false },
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should allow reactivation when under enrollment limit', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
        activeCount: 0,
        existingEnrollment: { enrollment_id: 5, active: false },
        updateResult: { enrollment_id: 5, active: true },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 5, active: true });
    });

    it('should throw InternalServerErrorException when club types not fully resolved', async () => {
      setupTransactionMock({
        clubTypes: [{ club_type_id: 1, name: 'Aventureros' }],
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw NotFoundException when target class does not exist', async () => {
      setupTransactionMock({
        targetClass: null,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when enrollment already exists and is active (regression)', async () => {
      setupTransactionMock({
        targetClass: { class_id: 10, club_type_id: 1, requires_invested_gm: false },
        activeCount: 0,
        existingEnrollment: { enrollment_id: 7, active: true },
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
