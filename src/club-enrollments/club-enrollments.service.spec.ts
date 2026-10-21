import { Test, TestingModule } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { ClubEnrollmentsService } from './club-enrollments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogsService } from '../catalogs/catalogs.service';
import { ErrorCode } from '../common/errors/error-codes';

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
      ],
    }).compile();

    service = module.get(ClubEnrollmentsService);
    mockCatalogs.getCurrentEcclesiasticalYear.mockResolvedValue(currentYear);
    mockModuleRef.get.mockReturnValue(mockAnnualFolders);
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

  it('lists pending annual club enrollments for Campo Local validation', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([
      {
        club_enrollment_id: 'enrollment-1',
        status: 'pending_validation',
        club_section: {
          clubs: { name: 'ACV' },
          club_types: { name: 'Aventureros' },
        },
      },
    ]);
    mockPrisma.club_enrollments.count.mockResolvedValue(1);

    await expect(
      service.findValidationQueue({
        page: 1,
        limit: 20,
        status: 'pending_validation',
      }),
    ).resolves.toEqual({
      data: [
        expect.objectContaining({
          club_enrollment_id: 'enrollment-1',
          status: 'pending_validation',
        }),
      ],
      meta: expect.objectContaining({ total: 1, page: 1, limit: 20 }),
    });

    expect(mockPrisma.club_enrollments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending_validation',
        }),
      }),
    );
  });

  it('escapes LIKE wildcards and searches case-insensitively in the validation queue', async () => {
    mockPrisma.club_enrollments.findMany.mockResolvedValue([]);
    mockPrisma.club_enrollments.count.mockResolvedValue(0);

    await service.findValidationQueue({ search: ' ac%_v ' });

    const { where } = mockPrisma.club_enrollments.findMany.mock.calls[0][0];
    const escaped = 'ac\\%\\_v';
    expect(where.OR).toEqual([
      {
        club_section: {
          clubs: { name: { contains: escaped, mode: 'insensitive' } },
        },
      },
      {
        club_section: {
          club_types: { name: { contains: escaped, mode: 'insensitive' } },
        },
      },
      { creator: { name: { contains: escaped, mode: 'insensitive' } } },
      {
        creator: {
          paternal_last_name: { contains: escaped, mode: 'insensitive' },
        },
      },
      {
        creator: {
          maternal_last_name: { contains: escaped, mode: 'insensitive' },
        },
      },
      { creator: { email: { contains: escaped, mode: 'insensitive' } } },
    ]);
  });

  it('approves pending annual club enrollment and creates annual folder afterwards', async () => {
    mockPrisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'pending_validation',
    });
    mockPrisma.club_enrollments.update.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'active',
    });

    await expect(
      service.approve('enrollment-1', 'field-reviewer-1'),
    ).resolves.toMatchObject({ status: 'active' });

    expect(mockPrisma.club_enrollments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { club_enrollment_id: 'enrollment-1' },
        data: expect.objectContaining({ status: 'active' }),
      }),
    );
    expect(mockAnnualFolders.createFolderForEnrollment).toHaveBeenCalledWith(
      'enrollment-1',
    );
  });

  it('rejects pending annual club enrollment without activating it', async () => {
    mockPrisma.club_enrollments.findUnique.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'pending_validation',
    });
    mockPrisma.club_enrollments.update.mockResolvedValue({
      club_enrollment_id: 'enrollment-1',
      status: 'rejected',
    });

    await expect(
      service.reject('enrollment-1', 'field-reviewer-1'),
    ).resolves.toMatchObject({ status: 'rejected' });

    expect(mockPrisma.club_enrollments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rejected' }),
      }),
    );
    expect(mockAnnualFolders.createFolderForEnrollment).not.toHaveBeenCalled();
  });

  it('fails approval when annual club enrollment does not exist', async () => {
    mockPrisma.club_enrollments.findUnique.mockResolvedValue(null);

    await expect(
      service.approve('missing', 'reviewer-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.CE_ENROLLMENT_NOT_FOUND,
    });
  });

  describe('update scoped to the section in the route path', () => {
    it('updates an enrollment that belongs to the section in the path', async () => {
      mockPrisma.club_enrollments.findUnique.mockResolvedValue({
        club_enrollment_id: 'enrollment-1',
        club_section_id: 10,
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
