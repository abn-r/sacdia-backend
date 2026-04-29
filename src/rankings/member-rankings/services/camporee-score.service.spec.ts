import { Test } from '@nestjs/testing';
import { CamporeeScoreService } from './camporee-score.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('CamporeeScoreService (per-enrollment)', () => {
  let service: CamporeeScoreService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      enrollments: { findUnique: jest.fn() },
      camporee_members: { count: jest.fn() },
      clubs: { findUnique: jest.fn() },
      local_camporees: { findMany: jest.fn() },
      union_camporees: { findMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        CamporeeScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CamporeeScoreService);
  });

  it('happy path: 1/2 approved → 50', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1, user_id: 'u1', club_id: 10, ecclesiastical_year_id: 2,
    });
    prisma.camporee_members.count.mockResolvedValue(1);
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 100, local_fields: { union_id: 5 } });
    prisma.local_camporees.findMany.mockResolvedValue([{ local_camporee_id: 1 }]);
    prisma.union_camporees.findMany.mockResolvedValue([{ union_camporee_id: 1 }]);
    expect(await service.calculate(1, 2)).toBe(50);
  });

  it('total_camporees = 0 → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1, user_id: 'u1', club_id: 10, ecclesiastical_year_id: 2,
    });
    prisma.camporee_members.count.mockResolvedValue(0);
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 100, local_fields: { union_id: 5 } });
    prisma.local_camporees.findMany.mockResolvedValue([]);
    prisma.union_camporees.findMany.mockResolvedValue([]);
    expect(await service.calculate(1, 2)).toBeNull();
  });

  it('club without union_id → only nationals (union_id NULL) in denom', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1, user_id: 'u1', club_id: 10, ecclesiastical_year_id: 2,
    });
    prisma.camporee_members.count.mockResolvedValue(1);
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 100, local_fields: null });
    prisma.local_camporees.findMany.mockResolvedValue([{ local_camporee_id: 1 }]);
    // union_camporees.findMany NOT called when resolvedUnionId === null
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('all approved (3/3) → 100', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 1, user_id: 'u1', club_id: 10, ecclesiastical_year_id: 2,
    });
    prisma.camporee_members.count.mockResolvedValue(3);
    prisma.clubs.findUnique.mockResolvedValue({ local_field_id: 100, local_fields: { union_id: 5 } });
    prisma.local_camporees.findMany.mockResolvedValue([{ local_camporee_id: 1 }, { local_camporee_id: 2 }]);
    prisma.union_camporees.findMany.mockResolvedValue([{ union_camporee_id: 1 }]);
    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('no enrollment → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue(null);
    expect(await service.calculate(999, 2)).toBeNull();
  });
});
