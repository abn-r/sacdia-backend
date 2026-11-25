import { Test } from '@nestjs/testing';
import { CertificationsService } from './certifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';

const mockPrisma = {
  certifications: { findUnique: jest.fn() },
  users_certifications: { count: jest.fn(), findMany: jest.fn() },
  certification_modules: { findMany: jest.fn() },
  certification_section_progress: { findMany: jest.fn() },
  club_role_assignments: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
};

const row = (id: number, userId: string, date: string, version = 3) => ({
  enrollment_id: id,
  user_id: userId,
  certification_version_id: version,
  status: 'IN_PROGRESS',
  enrollment_date: new Date(date),
  users: { name: 'Ana', paternal_last_name: 'Pérez', maternal_last_name: null },
});

describe('CertificationsService.listCertificationEnrollments', () => {
  let service: CertificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CertificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CertificationEligibilityService, useValue: {} },
      ],
    }).compile();
    service = module.get(CertificationsService);

    mockPrisma.certifications.findUnique.mockResolvedValue({
      certification_id: 1,
    });
  });

  it('throws CERT_NOT_FOUND when the certification does not exist', async () => {
    mockPrisma.certifications.findUnique.mockResolvedValue(null);
    await expect(
      service.listCertificationEnrollments(99, {}),
    ).rejects.toMatchObject({ code: ErrorCode.CERT_NOT_FOUND });
    expect(mockPrisma.users_certifications.findMany).not.toHaveBeenCalled();
  });

  it('paginates, orders by date desc then id desc and maps the contract', async () => {
    mockPrisma.users_certifications.count.mockResolvedValue(45);
    mockPrisma.users_certifications.findMany.mockResolvedValue([
      row(7, 'u1', '2026-03-02T00:00:00.000Z'),
      row(5, 'u2', '2026-03-01T00:00:00.000Z'),
      row(4, 'u3', '2026-02-01T00:00:00.000Z', 2),
    ]);
    // Version 3 requires sections 100, 101, 102 and 103; version 2 requires 200.
    mockPrisma.certification_modules.findMany.mockResolvedValue([
      {
        certification_version_id: 3,
        certification_sections: [{ section_id: 100 }, { section_id: 101 }],
      },
      {
        certification_version_id: 3,
        certification_sections: [{ section_id: 102 }, { section_id: 103 }],
      },
      { certification_version_id: 2, certification_sections: [] },
    ]);
    // An approved optional section (999) does not count.
    mockPrisma.certification_section_progress.findMany.mockResolvedValue([
      { enrollment_id: 7, section_id: 100 },
      { enrollment_id: 7, section_id: 101 },
      { enrollment_id: 7, section_id: 102 },
      { enrollment_id: 7, section_id: 103 },
      { enrollment_id: 5, section_id: 100 },
      { enrollment_id: 5, section_id: 999 },
    ]);
    mockPrisma.club_role_assignments.findMany.mockResolvedValue([
      {
        user_id: 'u1',
        club_sections: {
          clubs: { name: 'Orión' },
          club_types: { name: 'Conquistadores' },
        },
      },
      {
        user_id: 'u1',
        club_sections: {
          clubs: { name: 'Otro' },
          club_types: { name: 'Aventureros' },
        },
      },
    ]);

    const result = await service.listCertificationEnrollments(1, {
      page: 3,
      limit: 20,
    });

    expect(mockPrisma.users_certifications.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        orderBy: [{ enrollment_date: 'desc' }, { enrollment_id: 'desc' }],
      }),
    );
    expect(mockPrisma.certification_modules.findMany).toHaveBeenCalledWith({
      where: { certification_version_id: { in: [3, 2] }, active: true },
      select: {
        certification_version_id: true,
        certification_sections: {
          where: { active: true, required: true },
          select: { section_id: true },
        },
      },
    });
    expect(
      mockPrisma.certification_section_progress.findMany,
    ).toHaveBeenCalledWith({
      where: { enrollment_id: { in: [7, 5, 4] }, status: 'APPROVED' },
      select: { enrollment_id: true, section_id: true },
    });
    expect(mockPrisma.club_role_assignments.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [
        {
          enrollment_id: 7,
          user_id: 'u1',
          name: 'Ana',
          paternal_last_name: 'Pérez',
          maternal_last_name: null,
          club_name: 'Orión',
          section_name: 'Conquistadores',
          status: 'IN_PROGRESS',
          progress_percent: 100,
          enrollment_date: '2026-03-02T00:00:00.000Z',
        },
        expect.objectContaining({
          enrollment_id: 5,
          club_name: null,
          section_name: null,
          progress_percent: 25,
        }),
        expect.objectContaining({ enrollment_id: 4, progress_percent: 0 }),
      ],
      total: 45,
      page: 3,
      limit: 20,
    });
  });

  it('applies the status filter and an accent-insensitive name search', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { enrollment_id: 8 },
      { enrollment_id: 9 },
    ]);
    mockPrisma.users_certifications.count.mockResolvedValue(0);
    mockPrisma.users_certifications.findMany.mockResolvedValue([]);

    const result = await service.listCertificationEnrollments(1, {
      search: '  ana pérez ',
      status: 'CERTIFIED',
    });

    const sql = mockPrisma.$queryRaw.mock.calls[0][0];
    // Folded tokens, each wrapped as a literal LIKE pattern.
    expect(sql.values).toEqual(expect.arrayContaining([1, '%ana%', '%perez%']));
    expect(sql.sql).toContain('translate(coalesce(u.name');
    expect(sql.sql).toContain('ILIKE');

    const where = mockPrisma.users_certifications.count.mock.calls[0][0].where;
    expect(where).toEqual({
      certification_id: 1,
      active: true,
      status: 'CERTIFIED',
      enrollment_id: { in: [8, 9] },
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(mockPrisma.certification_modules.findMany).not.toHaveBeenCalled();
  });
});
