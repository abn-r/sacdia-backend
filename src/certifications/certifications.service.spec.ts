import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CertificationsService } from './certifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { EnrollCertificationDto } from './dto/enroll-certification.dto';
import { UpdateCertificationProgressDto } from './dto/update-progress.dto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh transaction mock with every table method needed by updateProgress */
const createTxMock = () => ({
  users_certifications: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  certification_sections: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  certification_section_progress: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  certification_module_progress: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  certification_modules: {
    findMany: jest.fn(),
  },
});

type TxMock = ReturnType<typeof createTxMock>;

// ---------------------------------------------------------------------------
// Prisma mock (outer — non-transactional calls)
// ---------------------------------------------------------------------------

const mockPrisma = {
  $transaction: jest.fn(),
  certifications: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  users_certifications: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  enrollments: {
    findFirst: jest.fn(),
  },
  certification_module_progress: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  certification_section_progress: {
    findMany: jest.fn(),
  },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CERT_ID = 1;
const MODULE_ID = 10;
const SECTION_ID = 100;
const USER_ID = 'user-uuid-001';
const ENROLLMENT_ID = 42;

const baseCertification = {
  certification_id: CERT_ID,
  name: 'Guía Mayor Pro',
  description: 'Certificación avanzada',
  active: true,
  _count: { certification_modules: 3 },
};

const baseCertificationWithModules = {
  certification_id: CERT_ID,
  name: 'Guía Mayor Pro',
  description: 'Certificación avanzada',
  active: true,
  certification_modules: [
    {
      module_id: MODULE_ID,
      name: 'Módulo 1',
      description: 'Desc módulo 1',
      certification_sections: [
        { section_id: SECTION_ID, name: 'Sección 1', description: 'Desc S1' },
      ],
    },
  ],
};

const baseEnrollment = {
  enrollment_id: ENROLLMENT_ID,
  user_id: USER_ID,
  certification_id: CERT_ID,
  enrollment_date: new Date('2026-01-01'),
  completion_status: false,
  completion_date: null,
  active: true,
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CertificationsService', () => {
  let service: CertificationsService;
  let txMock: TxMock;

  beforeEach(async () => {
    jest.clearAllMocks();

    txMock = createTxMock();

    // Default: $transaction forwards callback with txMock; array-form uses Promise.all
    mockPrisma.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: TxMock) => Promise<unknown>)(txMock);
      }
      return Promise.all(arg as Array<Promise<unknown>>);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CertificationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<CertificationsService>(CertificationsService);
  });

  // ==========================================================================
  // findAll — paginated list
  // ==========================================================================

  describe('findAll', () => {
    it('TC01 - returns paginated list with modules_count', async () => {
      mockPrisma.certifications.findMany.mockResolvedValue([baseCertification]);
      mockPrisma.certifications.count.mockResolvedValue(1);

      const pagination = new PaginationDto();
      const result = await service.findAll(pagination);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        certification_id: CERT_ID,
        name: 'Guía Mayor Pro',
        description: 'Certificación avanzada',
        active: true,
        modules_count: 3,
      });
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('TC02 - uses pagination skip/take from dto', async () => {
      mockPrisma.certifications.findMany.mockResolvedValue([]);
      mockPrisma.certifications.count.mockResolvedValue(0);

      const pagination = new PaginationDto();
      pagination.page = 2;
      pagination.limit = 5;

      await service.findAll(pagination);

      expect(mockPrisma.certifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    it('TC03 - works with no pagination argument (defaults applied)', async () => {
      mockPrisma.certifications.findMany.mockResolvedValue([]);
      mockPrisma.certifications.count.mockResolvedValue(0);

      const result = await service.findAll();

      expect(result.meta.page).toBe(1);
      expect(result.data).toEqual([]);
    });

    it('TC04 - only queries active certifications', async () => {
      mockPrisma.certifications.findMany.mockResolvedValue([]);
      mockPrisma.certifications.count.mockResolvedValue(0);

      await service.findAll(new PaginationDto());

      expect(mockPrisma.certifications.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
      expect(mockPrisma.certifications.count).toHaveBeenCalledWith({
        where: { active: true },
      });
    });
  });

  // ==========================================================================
  // findOne — detail with modules/sections tree
  // ==========================================================================

  describe('findOne', () => {
    it('TC05 - happy path: returns certification with modules and sections', async () => {
      mockPrisma.certifications.findUnique.mockResolvedValue(
        baseCertificationWithModules,
      );

      const result = await service.findOne(CERT_ID);

      expect(result.certification_id).toBe(CERT_ID);
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].module_id).toBe(MODULE_ID);
      expect(result.modules[0].sections).toHaveLength(1);
      expect(result.modules[0].sections[0].section_id).toBe(SECTION_ID);
    });

    it('TC06 - not found → NotFoundException', async () => {
      mockPrisma.certifications.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });

    it('TC07 - includes modules nested under certification', async () => {
      mockPrisma.certifications.findUnique.mockResolvedValue(
        baseCertificationWithModules,
      );

      const result = await service.findOne(CERT_ID);

      expect(result).toMatchObject({
        certification_id: CERT_ID,
        name: 'Guía Mayor Pro',
        modules: expect.arrayContaining([
          expect.objectContaining({
            module_id: MODULE_ID,
            sections: expect.arrayContaining([
              expect.objectContaining({ section_id: SECTION_ID }),
            ]),
          }),
        ]),
      });
    });
  });

  // ==========================================================================
  // enrollUser
  // ==========================================================================

  describe('enrollUser', () => {
    const dto: EnrollCertificationDto = { certification_id: CERT_ID };

    const eligibleEnrollment = {
      enrollment_id: 1,
      user_id: USER_ID,
      investiture_status: 'INVESTIDO',
      classes: { name: 'Guía Mayor' },
    };

    const createdEnrollment = {
      ...baseEnrollment,
      certifications: { name: 'Guía Mayor Pro' },
    };

    it('TC08 - happy path: eligible user enrolled successfully', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(eligibleEnrollment);
      mockPrisma.certifications.findUnique.mockResolvedValue({
        certification_id: CERT_ID,
        active: true,
      });
      mockPrisma.users_certifications.findFirst.mockResolvedValue(null);
      mockPrisma.users_certifications.create.mockResolvedValue(
        createdEnrollment,
      );

      const result = await service.enrollUser(USER_ID, dto);

      expect(result.enrollment_id).toBe(ENROLLMENT_ID);
      expect(result.certification_id).toBe(CERT_ID);
      expect(result.certification.name).toBe('Guía Mayor Pro');
      expect(result.active).toBe(true);
    });

    it('TC09 - already enrolled → ConflictException', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(eligibleEnrollment);
      mockPrisma.certifications.findUnique.mockResolvedValue({
        certification_id: CERT_ID,
        active: true,
      });
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );

      await expect(service.enrollUser(USER_ID, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('TC10 - not eligible (no INVESTIDO enrollment) → ForbiddenException', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(null);

      await expect(service.enrollUser(USER_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('TC11 - certification not found → NotFoundException', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(eligibleEnrollment);
      mockPrisma.certifications.findUnique.mockResolvedValue(null);

      await expect(service.enrollUser(USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('TC12 - certification inactive → NotFoundException', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(eligibleEnrollment);
      mockPrisma.certifications.findUnique.mockResolvedValue({
        certification_id: CERT_ID,
        active: false,
      });

      await expect(service.enrollUser(USER_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('TC13 - validateEligibility queries enrollments with correct filters', async () => {
      mockPrisma.enrollments.findFirst.mockResolvedValue(null);

      await expect(service.enrollUser(USER_ID, dto)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrisma.enrollments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: USER_ID,
            investiture_status: 'INVESTIDO',
          }),
        }),
      );
    });
  });

  // ==========================================================================
  // getUserCertifications
  // ==========================================================================

  describe('getUserCertifications', () => {
    const userEnrollments = [
      {
        enrollment_id: ENROLLMENT_ID,
        certification_id: CERT_ID,
        enrollment_date: new Date('2026-01-01'),
        completion_status: false,
        active: true,
        certifications: {
          name: 'Guía Mayor Pro',
          certification_modules: [
            { module_id: MODULE_ID },
            { module_id: MODULE_ID + 1 },
          ],
        },
      },
    ];

    it('TC14 - returns list with progress percentage', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue(
        userEnrollments,
      );
      mockPrisma.certification_module_progress.count.mockResolvedValue(1);

      const result = await service.getUserCertifications(USER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].enrollment_id).toBe(ENROLLMENT_ID);
      expect(result[0].modules_total).toBe(2);
      expect(result[0].modules_completed).toBe(1);
      expect(result[0].progress_percentage).toBe(50);
    });

    it('TC15 - 0% progress when no modules completed', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue(
        userEnrollments,
      );
      mockPrisma.certification_module_progress.count.mockResolvedValue(0);

      const result = await service.getUserCertifications(USER_ID);

      expect(result[0].progress_percentage).toBe(0);
      expect(result[0].modules_completed).toBe(0);
    });

    it('TC16 - 100% progress when all modules completed', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue(
        userEnrollments,
      );
      // 2 modules total, 2 completed
      mockPrisma.certification_module_progress.count.mockResolvedValue(2);

      const result = await service.getUserCertifications(USER_ID);

      expect(result[0].progress_percentage).toBe(100);
    });

    it('TC17 - empty list when user has no active enrollments', async () => {
      mockPrisma.users_certifications.findMany.mockResolvedValue([]);

      const result = await service.getUserCertifications(USER_ID);

      expect(result).toEqual([]);
    });

    it('TC18 - progress_percentage is 0 when certification has no modules', async () => {
      const enrollmentNoModules = [
        {
          ...userEnrollments[0],
          certifications: {
            name: 'Empty Cert',
            certification_modules: [],
          },
        },
      ];
      mockPrisma.users_certifications.findMany.mockResolvedValue(
        enrollmentNoModules,
      );
      mockPrisma.certification_module_progress.count.mockResolvedValue(0);

      const result = await service.getUserCertifications(USER_ID);

      expect(result[0].progress_percentage).toBe(0);
    });
  });

  // ==========================================================================
  // getCertificationProgress — detailed view
  // ==========================================================================

  describe('getCertificationProgress', () => {
    const enrollmentWithDetails = {
      ...baseEnrollment,
      certifications: {
        name: 'Guía Mayor Pro',
        certification_modules: [
          {
            module_id: MODULE_ID,
            name: 'Módulo 1',
            certification_sections: [
              { section_id: SECTION_ID, name: 'Sección 1' },
              { section_id: SECTION_ID + 1, name: 'Sección 2' },
            ],
          },
        ],
      },
    };

    const moduleProgressData = [
      {
        module_id: MODULE_ID,
        completed: false,
        completion_date: null,
      },
    ];

    const sectionProgressData = [
      {
        section_id: SECTION_ID,
        completed: true,
        completion_date: new Date('2026-02-01'),
      },
    ];

    it('TC19 - returns detailed progress with modules and sections', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        enrollmentWithDetails,
      );
      mockPrisma.certification_module_progress.findMany.mockResolvedValue(
        moduleProgressData,
      );
      mockPrisma.certification_section_progress.findMany.mockResolvedValue(
        sectionProgressData,
      );

      const result = await service.getCertificationProgress(USER_ID, CERT_ID);

      expect(result.enrollment_id).toBe(ENROLLMENT_ID);
      expect(result.certification_id).toBe(CERT_ID);
      expect(result.certification_name).toBe('Guía Mayor Pro');
      expect(result.modules).toHaveLength(1);
      expect(result.modules[0].module_id).toBe(MODULE_ID);
      expect(result.modules[0].sections).toHaveLength(2);
    });

    it('TC20 - section completed flag comes from sectionProgress data', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        enrollmentWithDetails,
      );
      mockPrisma.certification_module_progress.findMany.mockResolvedValue([]);
      mockPrisma.certification_section_progress.findMany.mockResolvedValue(
        sectionProgressData,
      );

      const result = await service.getCertificationProgress(USER_ID, CERT_ID);

      const section1 = result.modules[0].sections.find(
        (s: { section_id: number }) => s.section_id === SECTION_ID,
      );
      const section2 = result.modules[0].sections.find(
        (s: { section_id: number }) => s.section_id === SECTION_ID + 1,
      );

      expect(section1.completed).toBe(true);
      expect(section2.completed).toBe(false);
    });

    it('TC21 - not enrolled → NotFoundException', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.getCertificationProgress(USER_ID, CERT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('TC22 - progress_percentage = 0 when no modules completed', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        enrollmentWithDetails,
      );
      mockPrisma.certification_module_progress.findMany.mockResolvedValue([]);
      mockPrisma.certification_section_progress.findMany.mockResolvedValue([]);

      const result = await service.getCertificationProgress(USER_ID, CERT_ID);

      expect(result.progress_percentage).toBe(0);
    });
  });

  // ==========================================================================
  // updateProgress — section progress with cascade
  // ==========================================================================

  describe('updateProgress', () => {
    const dto: UpdateCertificationProgressDto = {
      module_id: MODULE_ID,
      section_id: SECTION_ID,
      completed: true,
    };

    const section = { section_id: SECTION_ID, module_id: MODULE_ID };

    const allSectionsInModule = [
      { section_id: SECTION_ID },
      { section_id: SECTION_ID + 1 },
    ];

    const allModules = [{ module_id: MODULE_ID }];

    const sectionProgressCreated = {
      progress_id: 1,
      user_id: USER_ID,
      section_id: SECTION_ID,
      module_id: MODULE_ID,
      certification_id: CERT_ID,
      completed: true,
      completion_date: new Date(),
    };

    const moduleProgressCreated = {
      progress_id: 2,
      module_id: MODULE_ID,
      completed: false,
      completion_date: null,
    };

    /** Wire the tx mock for the standard happy-path flow */
    const wireHappyPath = (opts: {
      existingSectionProgress?: object | null;
      completedSectionsCount?: number;
      existingModuleProgress?: object | null;
      completedModulesCount?: number;
    }) => {
      const {
        existingSectionProgress = null,
        completedSectionsCount = 1,
        existingModuleProgress = null,
        completedModulesCount = 0,
      } = opts;

      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(section);
      txMock.certification_section_progress.findFirst.mockResolvedValue(
        existingSectionProgress,
      );
      txMock.certification_section_progress.create.mockResolvedValue(
        sectionProgressCreated,
      );
      txMock.certification_section_progress.update.mockResolvedValue(
        sectionProgressCreated,
      );
      txMock.certification_sections.findMany.mockResolvedValue(
        allSectionsInModule,
      );
      txMock.certification_section_progress.count.mockResolvedValue(
        completedSectionsCount,
      );
      txMock.certification_module_progress.findFirst.mockResolvedValue(
        existingModuleProgress,
      );
      txMock.certification_module_progress.create.mockResolvedValue(
        moduleProgressCreated,
      );
      txMock.certification_module_progress.update.mockResolvedValue(
        moduleProgressCreated,
      );
      txMock.certification_modules.findMany.mockResolvedValue(allModules);
      txMock.certification_module_progress.count.mockResolvedValue(
        completedModulesCount,
      );
    };

    it('TC23 - happy path: marks section complete, creates new progress records', async () => {
      wireHappyPath({ completedSectionsCount: 1 });

      const result = await service.updateProgress(USER_ID, CERT_ID, dto);

      expect(result.section_id).toBe(SECTION_ID);
      expect(result.module_id).toBe(MODULE_ID);
      expect(result.completed).toBe(true);
      expect(txMock.certification_section_progress.create).toHaveBeenCalledTimes(1);
    });

    it('TC24 - updates existing section progress record instead of creating', async () => {
      wireHappyPath({
        existingSectionProgress: { progress_id: 99, section_id: SECTION_ID },
        completedSectionsCount: 1,
      });

      const result = await service.updateProgress(USER_ID, CERT_ID, dto);

      expect(txMock.certification_section_progress.update).toHaveBeenCalledTimes(1);
      expect(txMock.certification_section_progress.create).not.toHaveBeenCalled();
      expect(result.completed).toBe(true);
    });

    it('TC25 - module auto-completes when all sections are done', async () => {
      // 2 sections in module, both completed
      wireHappyPath({ completedSectionsCount: 2 });

      const result = await service.updateProgress(USER_ID, CERT_ID, dto);

      expect(result.module_progress.completed).toBe(false); // mock returns false, but count == length was wired
      // The important assertion: module progress create/update was called with completed=true
      const createCall =
        txMock.certification_module_progress.create.mock.calls[0]?.[0] as {
          data: { completed: boolean };
        };
      expect(createCall?.data.completed).toBe(true);
    });

    it('TC26 - uncomplete section: sets completed=false, null completion_date', async () => {
      const uncompleteDto: UpdateCertificationProgressDto = {
        module_id: MODULE_ID,
        section_id: SECTION_ID,
        completed: false,
      };

      wireHappyPath({ completedSectionsCount: 0 });

      await service.updateProgress(USER_ID, CERT_ID, uncompleteDto);

      const createCall =
        txMock.certification_section_progress.create.mock.calls[0]?.[0] as {
          data: { completed: boolean; completion_date: Date | null };
        };
      expect(createCall?.data.completed).toBe(false);
      expect(createCall?.data.completion_date).toBeNull();
    });

    it('TC27 - certification marked complete when all modules done', async () => {
      wireHappyPath({
        completedSectionsCount: 2,
        completedModulesCount: 1, // 1 module total, 1 completed
      });

      const result = await service.updateProgress(USER_ID, CERT_ID, dto);

      expect(result.certification_progress.completion_status).toBe(true);
      expect(txMock.users_certifications.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { enrollment_id: ENROLLMENT_ID },
          data: expect.objectContaining({ completion_status: true }),
        }),
      );
    });

    it('TC28 - not enrolled → NotFoundException', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProgress(USER_ID, CERT_ID, dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('TC29 - section does not belong to module/certification → BadRequestException', async () => {
      txMock.users_certifications.findFirst.mockResolvedValue(baseEnrollment);
      txMock.certification_sections.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProgress(USER_ID, CERT_ID, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC30 - progress_percentage calculation included in response', async () => {
      wireHappyPath({ completedModulesCount: 0 });

      const result = await service.updateProgress(USER_ID, CERT_ID, dto);

      expect(typeof result.certification_progress.progress_percentage).toBe(
        'number',
      );
    });
  });

  // ==========================================================================
  // deleteCertification — soft delete (unenroll)
  // ==========================================================================

  describe('deleteCertification', () => {
    it('TC31 - happy path: sets active=false and returns success message', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );
      mockPrisma.users_certifications.update.mockResolvedValue({
        ...baseEnrollment,
        active: false,
      });

      const result = await service.deleteCertification(USER_ID, CERT_ID);

      expect(result.message).toBe(
        'Certification enrollment deleted successfully',
      );
      expect(mockPrisma.users_certifications.update).toHaveBeenCalledWith({
        where: { enrollment_id: ENROLLMENT_ID },
        data: { active: false },
      });
    });

    it('TC32 - not enrolled → NotFoundException', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCertification(USER_ID, CERT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('TC33 - only queries active enrollments', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteCertification(USER_ID, CERT_ID),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.users_certifications.findFirst).toHaveBeenCalledWith({
        where: {
          user_id: USER_ID,
          certification_id: CERT_ID,
          active: true,
        },
      });
    });

    it('TC34 - does not hard-delete; only sets active=false', async () => {
      mockPrisma.users_certifications.findFirst.mockResolvedValue(
        baseEnrollment,
      );
      mockPrisma.users_certifications.update.mockResolvedValue({
        ...baseEnrollment,
        active: false,
      });

      await service.deleteCertification(USER_ID, CERT_ID);

      // delete should never be called
      expect(
        (mockPrisma.users_certifications as Record<string, jest.Mock>).delete,
      ).toBeUndefined();
      expect(mockPrisma.users_certifications.update).toHaveBeenCalled();
    });
  });
});
