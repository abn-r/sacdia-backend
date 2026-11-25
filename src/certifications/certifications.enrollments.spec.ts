import { Test } from '@nestjs/testing';
import { CertificationsService } from './certifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErrorCode } from '../common/errors/error-codes';
import { CertificationEligibilityService } from './eligibility/certification-eligibility.service';

const mockPrisma = {
  certifications: { findUnique: jest.fn() },
  users_certifications: { count: jest.fn(), findMany: jest.fn() },
  certification_module_progress: { findMany: jest.fn() },
  club_role_assignments: { findMany: jest.fn() },
};

const row = (id: number, userId: string, date: string) => ({
  enrollment_id: id,
  user_id: userId,
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
      certification_modules: [{ module_id: 10 }, { module_id: 11 }],
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
    ]);
    mockPrisma.certification_module_progress.findMany.mockResolvedValue([
      { user_id: 'u1', module_id: 10 },
      { user_id: 'u1', module_id: 11 },
      { user_id: 'u2', module_id: 10 },
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
    expect(
      mockPrisma.certification_module_progress.findMany,
    ).toHaveBeenCalledTimes(1);
    expect(mockPrisma.club_role_assignments.findMany).toHaveBeenCalledTimes(1);
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
          progress_percent: 50,
        }),
      ],
      total: 45,
      page: 3,
      limit: 20,
    });
  });

  it('applies status and tokenized case-insensitive search filters', async () => {
    mockPrisma.users_certifications.count.mockResolvedValue(0);
    mockPrisma.users_certifications.findMany.mockResolvedValue([]);

    const result = await service.listCertificationEnrollments(1, {
      search: '  ana pérez ',
      status: 'CERTIFIED',
    });

    const where = mockPrisma.users_certifications.count.mock.calls[0][0].where;
    expect(where.certification_id).toBe(1);
    expect(where.status).toBe('CERTIFIED');
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].users.OR[0]).toEqual({
      name: { contains: 'ana', mode: 'insensitive' },
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(
      mockPrisma.certification_module_progress.findMany,
    ).not.toHaveBeenCalled();
  });
});
