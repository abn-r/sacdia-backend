import { Test } from '@nestjs/testing';
import { EnrollmentClubResolverService } from './enrollment-club-resolver.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('EnrollmentClubResolverService', () => {
  let service: EnrollmentClubResolverService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      enrollments: { findUnique: jest.fn() },
      club_role_assignments: { findFirst: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        EnrollmentClubResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(EnrollmentClubResolverService);
  });

  it('happy path: resolves club + section', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: { club_section_id: 50, main_club_id: 10 },
    });
    expect(await service.resolve(1, 2)).toEqual({
      clubId: 10,
      clubSectionId: 50,
    });
  });

  it('no enrollment → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue(null);
    expect(await service.resolve(999, 2)).toBeNull();
    expect(prisma.club_role_assignments.findFirst).not.toHaveBeenCalled();
  });

  it('user has no active assignment for year → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.club_role_assignments.findFirst.mockResolvedValue(null);
    expect(await service.resolve(1, 2)).toBeNull();
  });

  it('assignment found but main_club_id is null (orphaned section) → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: { club_section_id: 50, main_club_id: null },
    });
    expect(await service.resolve(1, 2)).toBeNull();
  });

  it('passes correct where clause to club_role_assignments.findFirst', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.club_role_assignments.findFirst.mockResolvedValue({
      club_sections: { club_section_id: 50, main_club_id: 10 },
    });
    await service.resolve(1, 2);
    expect(prisma.club_role_assignments.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: 'u1',
        ecclesiastical_year_id: 2,
        active: true,
        club_section_id: { not: null },
      },
      orderBy: { created_at: 'asc' },
      select: {
        club_sections: {
          select: { club_section_id: true, main_club_id: true },
        },
      },
    });
  });
});
