import { Test, TestingModule } from '@nestjs/testing';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ErrorCode } from '../common/errors/error-codes';

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
    club_types: {
      findMany: jest.fn().mockResolvedValue([
        { club_type_id: 1 },
        { club_type_id: 2 },
      ]),
    },
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
        { provide: AchievementsService, useValue: { emitEvent: jest.fn().mockResolvedValue({ eventLogId: 1, queued: true }) } },
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
          evidence_files: [],
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
        include: {
          evidence_files: {
            where: { active: true },
            select: {
              evidence_file_id: true,
              file_url: true,
              file_name: true,
              file_type: true,
              uploaded_at: true,
              uploaded_by: {
                select: {
                  name: true,
                  paternal_last_name: true,
                  maternal_last_name: true,
                },
              },
            },
            orderBy: { uploaded_at: 'asc' },
          },
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

      await expect(service.getUserProgress('user-1', 7)).rejects.toMatchObject({ code: ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND });
    });

    it('throws conflict when class-scoped resolution is ambiguous', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1 },
        { enrollment_id: 2 },
      ]);

      await expect(service.getUserProgress('user-1', 7)).rejects.toMatchObject({ code: ErrorCode.CLASS_ENROLLMENT_AMBIGUOUS });
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

      const sectionCreateMock = transactionMock.class_section_progress.create;
      const moduleCreateMock = transactionMock.class_module_progress.create;
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
    //
    // enrollments.findFirst is called up to 3 times in enrollUser:
    //   1. GM investiture pre-condition check (step 2, only if requires_invested_gm)
    //   2. Highest INVESTIDO class for display-order validation (step 3)
    //   3. Base enrollment for display-order validation (step 3, only if no INVESTIDO)
    //
    // club_types.findMany is called only for Aventureros/Conquistadores pool check (step 4).
    // For GM classes the pool check uses club_type_id directly — no findMany call.
    //
    // targetClass MUST include club_types: { name } so the service can classify the pool
    // without relying on hardcoded exact-match strings.
    const setupTransactionMock = (mocks: {
      clubTypes?: any[];
      targetClass?: any;
      findFirstResults?: any[];
      activeCount?: number;
      existingEnrollment?: any;
      createResult?: any;
      updateResult?: any;
      ecclesiasticalYear?: any;
    }) => {
      // Build a findFirst that returns successive values from the array
      const findFirstResults = mocks.findFirstResults ?? [null];
      let findFirstCallIndex = 0;
      const findFirstFn = jest.fn().mockImplementation(() => {
        const result = findFirstResults[findFirstCallIndex] ?? null;
        findFirstCallIndex++;
        return Promise.resolve(result);
      });

      const txMock = {
        club_types: {
          findMany: jest.fn().mockResolvedValue(
            mocks.clubTypes ?? [
              { club_type_id: 1 },
              { club_type_id: 2 },
            ],
          ),
        },
        classes: {
          findUnique: jest.fn().mockResolvedValue(mocks.targetClass ?? null),
        },
        enrollments: {
          findFirst: findFirstFn,
          count: jest.fn().mockResolvedValue(mocks.activeCount ?? 0),
          findUnique: jest
            .fn()
            .mockResolvedValue(mocks.existingEnrollment ?? null),
          create: jest
            .fn()
            .mockResolvedValue(mocks.createResult ?? { enrollment_id: 1 }),
          update: jest
            .fn()
            .mockResolvedValue(mocks.updateResult ?? { enrollment_id: 1 }),
        },
        ecclesiastical_years: {
          findUnique: jest
            .fn()
            .mockResolvedValue(
              mocks.ecclesiasticalYear ?? { end_date: new Date('2099-12-31') },
            ),
        },
      };

      // Note: mockPrismaService.$transaction is already defined in the module setup (jest.fn())
      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: any) => Promise<any>) => callback(txMock),
      );

      return txMock;
    };

    const userId = 'test-user-uuid';
    const classId = 10;
    const yearId = 1;

    it('should allow first enrollment in Aventureros when no active enrollments exist', async () => {
      // findFirst calls: highestInvested (null), baseEnrollment (null = first-ever)
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Aventureros' },
        },
        findFirstResults: [null, null],
        activeCount: 0,
        createResult: { enrollment_id: 1, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 1, class_id: 10 });
    });

    it('should block Conquistadores enrollment when 1 active Aventureros enrollment exists', async () => {
      // findFirst calls: highestInvested (null), baseEnrollment (null = first-ever)
      // But enrollment limit check (step 4) fires first with activeCount: 1
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 2,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Conquistadores' },
        },
        findFirstResults: [null, null],
        activeCount: 1,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE });
    });

    it('should block Aventureros enrollment when 1 active Conquistadores enrollment exists', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Aventureros' },
        },
        findFirstResults: [null, null],
        activeCount: 1,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE });
    });

    it('should block GM class with requires_invested_gm when no prior investiture', async () => {
      // findFirst call 1: GM investiture check → null → throws ForbiddenException
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 3,
          requires_invested_gm: true,
          display_order: 1,
          club_types: { name: 'Guías Mayores' },
        },
        findFirstResults: [null],
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_GM_INVESTITURE_REQUIRED });
    });

    it('should allow GM class with requires_invested_gm when INVESTIDO exists', async () => {
      // findFirst calls:
      //   1. GM investiture check → found (INVESTIDO in GM)
      //   2. highestInvested for display-order → same INVESTIDO enrollment with display_order 1
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 3,
          requires_invested_gm: true,
          display_order: 2,
          club_types: { name: 'Guías Mayores' },
        },
        findFirstResults: [
          { enrollment_id: 99, investiture_status: 'INVESTIDO' },
          {
            enrollment_id: 99,
            investiture_status: 'INVESTIDO',
            classes: { display_order: 1 },
          },
        ],
        activeCount: 0,
        createResult: { enrollment_id: 2, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 2, class_id: 10 });
    });

    it('should allow GM class without requires_invested_gm (no investiture needed)', async () => {
      // findFirst calls: highestInvested (null), baseEnrollment (null = first-ever)
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 3,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Guías Mayores' },
        },
        findFirstResults: [null, null],
        activeCount: 0,
        createResult: { enrollment_id: 3, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 3, class_id: 10 });
    });

    it('should block GM enrollment when 2 active GM enrollments exist', async () => {
      // findFirst calls: highestInvested (null), baseEnrollment (null = first-ever)
      // But enrollment limit check (step 4) fires with activeCount: 2
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 3,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Guías Mayores' },
        },
        findFirstResults: [null, null],
        activeCount: 2,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_MAX_GM_ACTIVE });
    });

    it('should block reactivation when enrollment limit is reached', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Aventureros' },
        },
        findFirstResults: [null, null],
        activeCount: 1,
        existingEnrollment: { enrollment_id: 5, active: false },
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE });
    });

    it('should allow reactivation when under enrollment limit', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Aventureros' },
        },
        findFirstResults: [null, null],
        activeCount: 0,
        existingEnrollment: { enrollment_id: 5, active: false },
        updateResult: { enrollment_id: 5, active: true },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 5, active: true });
    });

    it('should classify club type using partial name match (unaccented DB variant)', async () => {
      // Simulates a DB that stores "Guias Mayores" without the accent on the i.
      // The service uses contains('guia') so it still resolves to the GM pool.
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 3,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Guias Mayores' },
        },
        findFirstResults: [null, null],
        activeCount: 0,
        createResult: { enrollment_id: 3, class_id: 10 },
      });

      const result = await service.enrollUser(userId, classId, yearId);
      expect(result).toMatchObject({ enrollment_id: 3, class_id: 10 });
    });

    it('should throw NotFoundException when target class does not exist', async () => {
      setupTransactionMock({
        targetClass: null,
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_NOT_FOUND });
    });

    it('should throw ConflictException when enrollment already exists and is active (regression)', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
        },
        findFirstResults: [null, null],
        activeCount: 0,
        existingEnrollment: { enrollment_id: 7, active: true },
      });

      await expect(service.enrollUser(userId, classId, yearId)).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
    });

    // ========================================
    // DISPLAY-ORDER PROGRESSION TESTS
    // ========================================

    describe('display-order progression restriction', () => {
      it('should block enrollment when target display_order exceeds highest INVESTIDO + 1', async () => {
        // User has INVESTIDO at display_order 2, tries to enroll in display_order 4
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 4,
            club_types: { name: 'Aventureros' },
          },
          findFirstResults: [
            // highestInvested: INVESTIDO at display_order 2
            {
              enrollment_id: 50,
              investiture_status: 'INVESTIDO',
              classes: { display_order: 2 },
            },
          ],
          activeCount: 0,
        });

        await expect(
          service.enrollUser(userId, classId, yearId),
        ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
      });

      it('should allow enrollment when target display_order equals highest INVESTIDO + 1', async () => {
        // User has INVESTIDO at display_order 2, enrolls in display_order 3
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 3,
            club_types: { name: 'Aventureros' },
          },
          findFirstResults: [
            // highestInvested: INVESTIDO at display_order 2
            {
              enrollment_id: 50,
              investiture_status: 'INVESTIDO',
              classes: { display_order: 2 },
            },
          ],
          activeCount: 0,
          createResult: { enrollment_id: 10, class_id: 10 },
        });

        const result = await service.enrollUser(userId, classId, yearId);
        expect(result).toMatchObject({ enrollment_id: 10, class_id: 10 });
      });

      it('should allow re-enrollment in INVESTIDO class (display_order <= max)', async () => {
        // User has INVESTIDO at display_order 3, enrolls in display_order 2
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 2,
            club_types: { name: 'Aventureros' },
          },
          findFirstResults: [
            {
              enrollment_id: 50,
              investiture_status: 'INVESTIDO',
              classes: { display_order: 3 },
            },
          ],
          activeCount: 0,
          createResult: { enrollment_id: 11, class_id: 10 },
        });

        const result = await service.enrollUser(userId, classId, yearId);
        expect(result).toMatchObject({ enrollment_id: 11 });
      });

      it('should block enrollment above base class when no INVESTIDO exists', async () => {
        // No INVESTIDO, base class at display_order 1, tries display_order 2
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 2,
          },
          findFirstResults: [
            // highestInvested: null
            null,
            // baseEnrollment: earliest enrollment at display_order 1
            { enrollment_id: 60, classes: { display_order: 1 } },
          ],
          activeCount: 0,
        });

        await expect(
          service.enrollUser(userId, classId, yearId),
        ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
      });

      it('should allow enrollment at base class level when no INVESTIDO exists', async () => {
        // No INVESTIDO, base class at display_order 2, enrolls in display_order 2
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 2,
          },
          findFirstResults: [
            null,
            { enrollment_id: 60, classes: { display_order: 2 } },
          ],
          activeCount: 0,
          createResult: { enrollment_id: 12, class_id: 10 },
        });

        const result = await service.enrollUser(userId, classId, yearId);
        expect(result).toMatchObject({ enrollment_id: 12 });
      });

      it('should allow next class when ecclesiastical year has ended', async () => {
        // No INVESTIDO, base class at display_order 1, tries display_order 2
        // But the year has ended → allowed
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 2,
          },
          findFirstResults: [
            null,
            { enrollment_id: 60, classes: { display_order: 1 } },
          ],
          activeCount: 0,
          createResult: { enrollment_id: 13, class_id: 10 },
          ecclesiasticalYear: { end_date: new Date('2020-01-01') },
        });

        const result = await service.enrollUser(userId, classId, yearId);
        expect(result).toMatchObject({ enrollment_id: 13 });
      });

      it('should still block skipping classes even when year has ended', async () => {
        // No INVESTIDO, base class at display_order 1, tries display_order 3
        // Year ended gives +1, so maxAllowed = 1 + 1 = 2, but target is 3
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 3,
          },
          findFirstResults: [
            null,
            { enrollment_id: 60, classes: { display_order: 1 } },
          ],
          activeCount: 0,
          ecclesiasticalYear: { end_date: new Date('2020-01-01') },
        });

        await expect(
          service.enrollUser(userId, classId, yearId),
        ).rejects.toMatchObject({ code: ErrorCode.CLASS_LEVEL_TOO_HIGH });
      });

      it('should allow first-ever enrollment regardless of display_order (post-registration)', async () => {
        // No INVESTIDO, no base enrollment → first-ever enrollment, skip restriction
        setupTransactionMock({
          targetClass: {
            class_id: 10,
            club_type_id: 1,
            requires_invested_gm: false,
            display_order: 5,
          },
          findFirstResults: [null, null],
          activeCount: 0,
          createResult: { enrollment_id: 14, class_id: 10 },
        });

        const result = await service.enrollUser(userId, classId, yearId);
        expect(result).toMatchObject({ enrollment_id: 14 });
      });
    });
  });
});
