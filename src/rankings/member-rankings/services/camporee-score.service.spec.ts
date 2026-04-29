import { Test } from '@nestjs/testing';
import { CamporeeScoreService } from './camporee-score.service';
import { EnrollmentClubResolverService } from './enrollment-club-resolver.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CamporeeScoreService (per-enrollment)', () => {
  let service: CamporeeScoreService;
  let prisma: any;
  let resolver: jest.Mocked<EnrollmentClubResolverService>;

  beforeEach(async () => {
    prisma = {
      enrollments: { findUnique: jest.fn() },
      clubs: { findUnique: jest.fn() },
      camporee_members: { count: jest.fn() },
      local_camporees: { findMany: jest.fn() },
      union_camporees: { findMany: jest.fn() },
    };
    resolver = { resolve: jest.fn() } as any;
    const module = await Test.createTestingModule({
      providers: [
        CamporeeScoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnrollmentClubResolverService, useValue: resolver },
      ],
    }).compile();
    service = module.get(CamporeeScoreService);
  });

  it('happy path: 1 of 2 in-scope approved → 50', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    prisma.clubs.findUnique.mockResolvedValue({
      local_field_id: 100,
      local_fields: { union_id: 5 },
    });
    prisma.local_camporees.findMany.mockResolvedValue([{ local_camporee_id: 11 }]);
    prisma.union_camporees.findMany.mockResolvedValue([{ union_camporee_id: 22 }]);
    prisma.camporee_members.count.mockResolvedValue(1);
    expect(await service.calculate(1, 2)).toBe(50);
    // verify count was scoped to in-range IDs
    expect(prisma.camporee_members.count).toHaveBeenCalledWith({
      where: {
        user_id: 'u1',
        status: 'approved',
        OR: [
          { camporee_id: { in: [11] } },
          { union_camporee_id: { in: [22] } },
        ],
      },
    });
  });

  it('total scope camporees = 0 → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    prisma.clubs.findUnique.mockResolvedValue({
      local_field_id: 100,
      local_fields: { union_id: 5 },
    });
    prisma.local_camporees.findMany.mockResolvedValue([]);
    prisma.union_camporees.findMany.mockResolvedValue([]);
    expect(await service.calculate(1, 2)).toBeNull();
    // count not called when no scope IDs to filter against
    expect(prisma.camporee_members.count).not.toHaveBeenCalled();
  });

  it('club without union_id → only locals in scope, union skipped', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    prisma.clubs.findUnique.mockResolvedValue({
      local_field_id: 100,
      local_fields: null,
    });
    prisma.local_camporees.findMany.mockResolvedValue([{ local_camporee_id: 11 }]);
    prisma.camporee_members.count.mockResolvedValue(1);
    expect(await service.calculate(1, 2)).toBe(100);
    expect(prisma.union_camporees.findMany).not.toHaveBeenCalled();
    expect(prisma.camporee_members.count).toHaveBeenCalledWith({
      where: {
        user_id: 'u1',
        status: 'approved',
        OR: [{ camporee_id: { in: [11] } }],
      },
    });
  });

  it('all approved (3/3) → 100', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    prisma.clubs.findUnique.mockResolvedValue({
      local_field_id: 100,
      local_fields: { union_id: 5 },
    });
    prisma.local_camporees.findMany.mockResolvedValue([
      { local_camporee_id: 11 },
      { local_camporee_id: 12 },
    ]);
    prisma.union_camporees.findMany.mockResolvedValue([{ union_camporee_id: 22 }]);
    prisma.camporee_members.count.mockResolvedValue(3);
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('no enrollment → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('resolver returns null (no active assignment) → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    resolver.resolve.mockResolvedValue(null);
    expect(await service.calculate(1, 2)).toBeNull();
    expect(prisma.clubs.findUnique).not.toHaveBeenCalled();
  });
});
