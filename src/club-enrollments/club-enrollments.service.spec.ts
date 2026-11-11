import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { ErrorCode } from '../common/errors/error-codes';
import { SectionBoardSnapshotService } from '../common/authorization/section-board-snapshot.service';
import { CreateClubEnrollmentDto } from './dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('ClubEnrollmentsService', () => {
  let service: ClubEnrollmentsService;

  const currentYear = { ecclesiastical_year_id: 2026 };

  const mockPrisma = {
    $transaction: jest.fn(),
    club_sections: {
      findUnique: jest.fn(),
    },
    club_enrollments: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
  };

  const mockCatalogs = {
    getCurrentEcclesiasticalYear: jest.fn(),
  };

  const mockAnnualFolders = {
    createFolderForEnrollment: jest.fn(),
  };

  const board = {
    director_id: 'dir-1',
    deputy_director_ids: ['dep-1', 'dep-2'],
    secretary_id: 'sec-1',
    treasurer_id: 'tre-1',
    secretary_treasurer_id: null,
  };
  const mockBoard = { snapshot: jest.fn() };

  const mockModuleRef = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubEnrollmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CatalogsService, useValue: mockCatalogs },
        { provide: ModuleRef, useValue: mockModuleRef },
        { provide: SectionBoardSnapshotService, useValue: mockBoard },
      ],
    }).compile();

    service = module.get(ClubEnrollmentsService);
    mockCatalogs.getCurrentEcclesiasticalYear.mockResolvedValue(currentYear);
    mockModuleRef.get.mockReturnValue(mockAnnualFolders);
    mockBoard.snapshot.mockResolvedValue(board);
    mockPrisma.$transaction.mockImplementation(async (callback) =>
      callback(mockPrisma),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('creates annual club enrollments as pending Campo Local validation', async () => {
    mockPrisma.club_sections.findUnique.mockResolvedValue({
      club_section_id: 10,
      main_club_id: 5,
    });
    mockPrisma.club_enrollments.findUnique.mockResolvedValue(null);
    mockPrisma.club_enrollments.create.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'pending_validation',
    });

    const result = await service.create(
      5,
      10,
      { address: 'Templo Central', meeting_days: 'Sábado' },
      'director-1',
    );

    expect(result).toMatchObject({ status: 'pending_validation' });
    expect(mockPrisma.club_enrollments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_validation',
        }),
      }),
    );
    expect(mockAnnualFolders.createFolderForEnrollment).not.toHaveBeenCalled();
  });

  const REVIEW_CLEARED = {
    reviewed_by_id: null,
    reviewer_role: null,
    reviewed_at: null,
    decision_reason: null,
  };

  it.each(['rejected', 'inactive'])(
    'resubmitting a %s enrollment through POST clears the review fields',
    async (status) => {
      mockPrisma.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        main_club_id: 5,
      });
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        status,
      });
      mockPrisma.club_enrollments.update.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        status: 'pending_validation',
      });

      await service.create(5, 10, { address: 'Templo' }, 'director-1');

      expect(mockPrisma.club_enrollments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending_validation',
            ...REVIEW_CLEARED,
          }),
        }),
      );
    },
  );

  it.each(['rejected', 'inactive'])(
    'fixing a %s enrollment through PATCH moves it back to pending and clears the review fields',
    async (status) => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 10,
        ecclesiastical_year_id: 2026,
        status,
      });
      mockPrisma.club_enrollments.update.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
      });

      await service.update('enrollment-1', { address: 'Calle 2' }, 10);

      expect(mockPrisma.club_enrollments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'pending_validation',
            address: 'Calle 2',
            ...REVIEW_CLEARED,
          }),
        }),
      );
    },
  );

  it('editing an approved enrollment keeps it active and keeps its review', async () => {
    mockPrisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      club_section_id: 10,
      ecclesiastical_year_id: 2026,
      status: 'active',
    });
    mockPrisma.club_enrollments.update.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
    });

    await service.update('enrollment-1', { address: 'Calle 3' }, 10);

    const { data } = mockPrisma.club_enrollments.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('reviewed_by_id');
    expect(data).not.toHaveProperty('decision_reason');
  });

  describe('board snapshot and submitted_at', () => {
    const section = { club_section_id: 10, main_club_id: 5 };

    it('snapshots the board from the section roles of the current year on create', async () => {
      mockPrisma.club_sections.findUnique.mockResolvedValue(section);
      mockPrisma.club_enrollments.findUnique.mockResolvedValue(null);
      mockPrisma.club_enrollments.create.mockResolvedValue({});

      await service.create(5, 10, { address: 'Templo' }, 'user-1');

      expect(mockBoard.snapshot).toHaveBeenCalledWith(10, 2026);
      const { data } = mockPrisma.club_enrollments.create.mock.calls[0][0];
      expect(data).toMatchObject(board);
      expect(data.submitted_at).toBeInstanceOf(Date);
    });

    it('stores an empty board when no role has a holder', async () => {
      const empty = {
        director_id: null,
        deputy_director_ids: [],
        secretary_id: null,
        treasurer_id: null,
        secretary_treasurer_id: null,
      };
      mockBoard.snapshot.mockResolvedValue(empty);
      mockPrisma.club_sections.findUnique.mockResolvedValue(section);
      mockPrisma.club_enrollments.findUnique.mockResolvedValue(null);
      mockPrisma.club_enrollments.create.mockResolvedValue({});

      await service.create(5, 10, {}, 'user-1');

      const { data } = mockPrisma.club_enrollments.create.mock.calls[0][0];
      expect(data).toMatchObject(empty);
    });

    it.each(['rejected', 'inactive'])(
      'POST over a %s enrollment re-snapshots the board and resets submitted_at',
      async (status) => {
        mockPrisma.club_sections.findUnique.mockResolvedValue(section);
        mockPrisma.club_enrollments.findUnique.mockResolvedValue({
          club_enrollment_id: 'enrollment-1',
          status,
        });
        mockPrisma.club_enrollments.update.mockResolvedValue({});

        await service.create(5, 10, {}, 'user-1');

        const { data } = mockPrisma.club_enrollments.update.mock.calls[0][0];
        expect(data).toMatchObject(board);
        expect(data.submitted_at).toBeInstanceOf(Date);
      },
    );

    it('PATCH re-snapshots the board of the enrollment year and ignores client board input', async () => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 10,
        ecclesiastical_year_id: 2025,
        status: 'active',
      });
      mockPrisma.club_enrollments.update.mockResolvedValue({});

      await service.update(
        'enrollment-1',
        { address: 'Calle 9', director_id: 'forged' } as never,
        10,
      );

      expect(mockBoard.snapshot).toHaveBeenCalledWith(10, 2025);
      const { data } = mockPrisma.club_enrollments.update.mock.calls[0][0];
      expect(data).toMatchObject(board);
      expect(data.director_id).toBe('dir-1');
    });

    it('PATCH of an approved enrollment leaves submitted_at alone', async () => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 10,
        ecclesiastical_year_id: 2026,
        status: 'active',
      });
      mockPrisma.club_enrollments.update.mockResolvedValue({});

      await service.update('enrollment-1', { address: 'Calle 9' }, 10);

      const { data } = mockPrisma.club_enrollments.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('submitted_at');
    });

    it.each(['rejected', 'inactive'])(
      'PATCH of a %s enrollment sets submitted_at again',
      async (status) => {
        mockPrisma.club_enrollments.findUnique.mockResolvedValue({
          club_enrollment_id: 'enrollment-1',
          club_section_id: 10,
          ecclesiastical_year_id: 2026,
          status,
        });
        mockPrisma.club_enrollments.update.mockResolvedValue({});

        await service.update('enrollment-1', { address: 'Calle 9' }, 10);

        const { data } = mockPrisma.club_enrollments.update.mock.calls[0][0];
        expect(data.submitted_at).toBeInstanceOf(Date);
      },
    );
  });

  describe('CreateClubEnrollmentDto', () => {
    it.each([
      'director_id',
      'deputy_director_ids',
      'secretary_id',
      'treasurer_id',
      'secretary_treasurer_id',
    ])('declares no %s field (the global pipe rejects it)', async (field) => {
      const dto = plainToInstance(CreateClubEnrollmentDto, { [field]: 'x' });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.map((e) => e.property)).toContain(field);
    });
  });

  it('reads the current enrollment with its review fields', async () => {
    mockPrisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'rejected',
      decision_reason: 'Falta la dirección',
      reviewed_at: new Date('2026-11-11T10:00:00Z'),
    });

    await expect(service.findCurrentBySectionId(10)).resolves.toMatchObject({
      status: 'rejected',
      decision_reason: 'Falta la dirección',
    });
  });

  describe('update scoped to the section in the route path', () => {
    it('updates an enrollment that belongs to the section in the path', async () => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 10,
        ecclesiastical_year_id: 2026,
        status: 'active',
      });
      mockPrisma.club_enrollments.update.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
      });

      await service.update('enrollment-1', { address: 'Calle 1' }, 10);

      expect(mockPrisma.club_enrollments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { club_enrollment_id: 'enrollment-1' },
        }),
      );
    });

    it('answers not found, and writes nothing, for an enrollment of another section', async () => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 99,
        status: 'active',
      });

      await expect(
        service.update('enrollment-1', { address: 'Calle 1' }, 10),
      ).rejects.toMatchObject({ code: ErrorCode.CE_ENROLLMENT_NOT_FOUND });
      expect(mockPrisma.club_enrollments.update).not.toHaveBeenCalled();
    });
  });
});
