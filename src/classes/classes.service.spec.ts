import { Test, TestingModule } from '@nestjs/testing';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { AchievementsService } from '../achievements/achievements.service';
import { TranslationService } from '../common/services/translation.service';
import { ErrorCode } from '../common/errors/error-codes';
import { EVIDENCE_URL_LIMITER } from './classes.service';
import { PaginationDto } from '../common/dto/pagination.dto';

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
    ecclesiastical_years: { findFirst: jest.fn(), findUnique: jest.fn() },
    enrollments: { findMany: jest.fn(), findUnique: jest.fn() },
    class_sections: { findFirst: jest.fn() },
    class_section_progress: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    evidence_files: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    club_types: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ club_type_id: 1 }, { club_type_id: 2 }]),
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
    mockPrismaService.class_sections.findFirst.mockResolvedValue({
      section_id: 101,
      module_id: 11,
    });
    mockPrismaService.class_section_progress.findFirst.mockResolvedValue(null);
    mockPrismaService.class_section_progress.create.mockResolvedValue({
      section_progress_id: 123,
      enrollment_id: 901,
      section_id: 101,
      status: 'PENDING',
    });
    mockPrismaService.class_section_progress.update.mockResolvedValue({
      section_progress_id: 123,
      section_id: 101,
      status: 'SUBMITTED',
      submitted_at: new Date('2026-05-10T00:00:00.000Z'),
    });
    mockPrismaService.evidence_files.create.mockResolvedValue({
      evidence_file_id: 55,
      file_url: 'https://r2.example/class/123.pdf',
      file_name: 'evidence.pdf',
      file_type: 'document',
      uploaded_at: new Date('2026-05-10T00:00:00.000Z'),
      uploaded_by: null,
    });

    const mockFileStorageService = {
      upload: jest.fn(),
      deleteMany: jest.fn(),
      extractKeyFromPublicUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };

    const mockTranslationService: Partial<TranslationService> = {
      getCurrentLocale: jest.fn().mockReturnValue('es'),
      translateMany: jest.fn().mockImplementation((records) => records),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AchievementsService,
          useValue: {
            emitEvent: jest
              .fn()
              .mockResolvedValue({ eventLogId: 1, queued: true }),
          },
        },
        { provide: TranslationService, useValue: mockTranslationService },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
  });

  describe('class availability windows', () => {
    it('resolves the current ecclesiastical year by date range before falling back to active flag', async () => {
      const currentYearStart = new Date('2026-01-01T00:00:00.000Z');
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValueOnce({
        year_id: 2026,
        start_date: currentYearStart,
      });
      mockPrismaService.classes.findMany.mockResolvedValue([]);
      mockPrismaService.classes.count.mockResolvedValue(0);

      await service.findAll(undefined, new PaginationDto());

      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: {
            start_date: { lte: expect.any(Date) },
            end_date: { gte: expect.any(Date) },
          },
        }),
      );
    });

    it('lists only classes startable in the current active ecclesiastical year', async () => {
      const activeYearStart = new Date('2026-01-01T00:00:00.000Z');
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: activeYearStart,
      });
      mockPrismaService.classes.findMany.mockResolvedValue([
        {
          class_id: 1,
          name: 'Actual',
          available_until_year_id: null,
          translations: [],
        },
      ]);
      mockPrismaService.classes.count.mockResolvedValue(1);

      const result = await service.findAll(undefined, new PaginationDto());

      expect(result.data).toHaveLength(1);
      expect(mockPrismaService.classes.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { available_until_year_id: null },
                  {
                    available_until_year: {
                      start_date: { gte: activeYearStart },
                    },
                  },
                ]),
              }),
            ]),
          }),
        }),
      );
    });
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

      await expect(service.getUserProgress('user-1', 7)).rejects.toMatchObject({
        code: ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND,
      });
    });

    it('throws conflict when class-scoped resolution is ambiguous', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        { enrollment_id: 1 },
        { enrollment_id: 2 },
      ]);

      await expect(service.getUserProgress('user-1', 7)).rejects.toMatchObject({
        code: ErrorCode.CLASS_ENROLLMENT_AMBIGUOUS,
      });
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

  describe('class evidence files', () => {
    it('uploads evidence against an explicit enrollment-owned section progress', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 901,
        user_id: 'user-1',
        class_id: 7,
        ecclesiastical_year_id: 2026,
      });
      const fileStorage = (service as any).fileStorage;
      fileStorage.upload.mockResolvedValue({
        url: 'https://r2.example/class/123.pdf',
      });
      fileStorage.getSignedDownloadUrl.mockResolvedValue(
        'https://signed.example/class/123.pdf',
      );

      await (service as any).uploadSectionFile(
        'user-1',
        7,
        101,
        {
          buffer: Buffer.from('pdf'),
          mimetype: 'application/pdf',
          originalname: 'evidence.pdf',
        },
        901,
      );

      expect(
        mockPrismaService.class_section_progress.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enrollment_id: 901,
            section_id: 101,
            active: true,
          }),
        }),
      );
    });

    it('submits evidence using explicit enrollment ownership', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 901,
        user_id: 'user-1',
        class_id: 7,
        ecclesiastical_year_id: 2026,
      });
      mockPrismaService.class_section_progress.findFirst.mockResolvedValue({
        section_progress_id: 123,
        section_id: 101,
        status: 'PENDING',
        evidence_files: [{ evidence_file_id: 55 }],
      });

      await (service as any).submitSection('user-1', 7, 101, 901);

      expect(
        mockPrismaService.class_section_progress.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enrollment_id: 901,
            section_id: 101,
            active: true,
          }),
        }),
      );
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
          findMany: jest
            .fn()
            .mockResolvedValue(
              mocks.clubTypes ?? [{ club_type_id: 1 }, { club_type_id: 2 }],
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

    it('should block enrollment when the class is not available for the target ecclesiastical year', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          available_from_year: null,
          available_until_year: { start_date: new Date('2025-01-01') },
          club_types: { name: 'Aventureros' },
        },
        ecclesiasticalYear: {
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-12-31'),
        },
      });

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_NOT_AVAILABLE_FOR_YEAR });
    });

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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({
        code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE,
      });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({
        code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE,
      });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({
        code: ErrorCode.CLASS_GM_INVESTITURE_REQUIRED,
      });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_MAX_GM_ACTIVE });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({
        code: ErrorCode.CLASS_MAX_AVENTU_CONQUIS_ACTIVE,
      });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_NOT_FOUND });
    });

    it('should throw NotFoundException when target class is inactive', async () => {
      setupTransactionMock({
        targetClass: {
          class_id: 10,
          active: false,
          club_type_id: 1,
          requires_invested_gm: false,
          display_order: 1,
          club_types: { name: 'Aventureros' },
        },
      });

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_NOT_FOUND });
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

      await expect(
        service.enrollUser(userId, classId, yearId),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });
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

  describe('getUserProgress — evidence URL presign concurrency cap', () => {
    // Helper: build a classes.findUnique mock with N sections in one module,
    // and matching sectionProgress rows each with F evidence files.
    const buildEvidenceFixture = (
      sectionCount: number,
      filesPerSection: number,
    ) => {
      const makeEvidenceFile = (id: number) => ({
        evidence_file_id: id,
        file_url: `evidence/file-${id}.pdf`,
        file_name: `file-${id}.pdf`,
        file_type: 'application/pdf',
        uploaded_at: new Date('2026-01-01'),
        uploaded_by: {
          name: 'Test',
          paternal_last_name: 'User',
          maternal_last_name: null,
        },
      });

      const classSections = Array.from({ length: sectionCount }, (_, si) => ({
        section_id: 200 + si,
        name: `Section ${si + 1}`,
      }));

      const sectionProgress = classSections.map((sec, si) => ({
        enrollment_id: 501,
        module_id: 11,
        section_id: sec.section_id,
        score: 90,
        evidences: null,
        active: true,
        status: 'PENDING',
        submitted_at: null,
        validated_at: null,
        rejection_reason: null,
        evidence_files: Array.from({ length: filesPerSection }, (__, fi) =>
          makeEvidenceFile(si * filesPerSection + fi + 1),
        ),
      }));

      const classData = {
        class_id: 7,
        name: 'Amigo',
        class_modules: [
          {
            module_id: 11,
            name: 'Module 1',
            class_sections: classSections,
          },
        ],
      };

      return {
        classData,
        sectionProgress,
        totalFiles: sectionCount * filesPerSection,
      };
    };

    it('signs all evidence files correctly when there are 100+ files (output completeness)', async () => {
      // 5 sections × 20 files = 100 total. Exceeds the cap of 20, so the limiter
      // batches execution — but the output must still contain all 100 signed URLs.
      const { classData, sectionProgress, totalFiles } = buildEvidenceFixture(
        5,
        20,
      );

      mockPrismaService.classes.findUnique.mockResolvedValue(classData);
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
      mockPrismaService.class_section_progress.findMany.mockResolvedValue(
        sectionProgress,
      );

      const fileStorage = service['fileStorage'] as unknown as {
        getSignedDownloadUrl: jest.Mock;
      };
      fileStorage.getSignedDownloadUrl.mockImplementation(
        (_bucket: unknown, key: string) => Promise.resolve(`signed://${key}`),
      );

      const result = await service.getUserProgress('user-1', 7);

      const allEvidenceFiles = (result as any).modules
        .flatMap((m: any) => m.sections)
        .flatMap((s: any) => s.evidence_files ?? []);

      expect(allEvidenceFiles).toHaveLength(totalFiles);
      for (const ef of allEvidenceFiles) {
        expect(ef.file_url).toMatch(/^signed:\/\//);
      }
      expect(fileStorage.getSignedDownloadUrl).toHaveBeenCalledTimes(
        totalFiles,
      );
    });

    it('never exceeds 20 concurrent active presign calls under heavy load', async () => {
      // 10 sections × 20 files = 200 evidence entries — the documented worst case.
      // The mock samples EVIDENCE_URL_LIMITER.activeCount on each call to verify
      // the cap held across the entire batch.
      const { classData, sectionProgress, totalFiles } = buildEvidenceFixture(
        10,
        20,
      );

      mockPrismaService.classes.findUnique.mockResolvedValue(classData);
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
      mockPrismaService.class_section_progress.findMany.mockResolvedValue(
        sectionProgress,
      );

      const fileStorage = service['fileStorage'] as unknown as {
        getSignedDownloadUrl: jest.Mock;
      };

      let peakActive = 0;
      fileStorage.getSignedDownloadUrl.mockImplementation(
        (_bucket: unknown, key: string) => {
          // activeCount is sampled synchronously at call entry — the limiter
          // has already incremented it for the current slot.
          const current = EVIDENCE_URL_LIMITER.activeCount;
          if (current > peakActive) peakActive = current;
          return Promise.resolve(`signed://${key}`);
        },
      );

      await service.getUserProgress('user-1', 7);

      expect(fileStorage.getSignedDownloadUrl).toHaveBeenCalledTimes(
        totalFiles,
      );
      // The limiter must have held concurrent calls to at most 20.
      expect(peakActive).toBeLessThanOrEqual(20);
      // Sanity: the limiter ran at least one call (not trivially zero).
      expect(peakActive).toBeGreaterThan(0);
    });
  });
});
