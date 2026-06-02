import { Test } from '@nestjs/testing';
import { CamporeeScoreService } from './camporee-score.service';
import { EnrollmentClubResolverService } from './enrollment-club-resolver.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { InstitutionalHierarchyService } from '../../../common/services/institutional-hierarchy.service';

describe('CamporeeScoreService (per-enrollment)', () => {
  let service: CamporeeScoreService;
  let prisma: any;
  let resolver: jest.Mocked<EnrollmentClubResolverService>;
  let hierarchy: { resolveAsOf: jest.Mock };

  beforeEach(async () => {
    prisma = {
      enrollments: { findUnique: jest.fn() },
      ecclesiastical_years: { findUnique: jest.fn() },
      camporee_members: { count: jest.fn() },
      local_camporees: { findMany: jest.fn() },
      union_camporees: { findMany: jest.fn() },
    };
    resolver = { resolve: jest.fn() } as any;
    hierarchy = { resolveAsOf: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        CamporeeScoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnrollmentClubResolverService, useValue: resolver },
        { provide: InstitutionalHierarchyService, useValue: hierarchy },
      ],
    }).compile();
    service = module.get(CamporeeScoreService);
  });

  it('happy path: 1 of 2 in-scope approved → 50', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.local_camporees.findMany.mockResolvedValue([
      { local_camporee_id: 11 },
    ]);
    prisma.union_camporees.findMany.mockResolvedValue([
      { union_camporee_id: 22 },
    ]);
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
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.local_camporees.findMany.mockResolvedValue([]);
    prisma.union_camporees.findMany.mockResolvedValue([]);
    expect(await service.calculate(1, 2)).toBeNull();
    // count not called when no scope IDs to filter against
    expect(prisma.camporee_members.count).not.toHaveBeenCalled();
  });

  it('club without union_id → only locals in scope, union skipped', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: null,
    });
    prisma.local_camporees.findMany.mockResolvedValue([
      { local_camporee_id: 11 },
    ]);
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
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.local_camporees.findMany.mockResolvedValue([
      { local_camporee_id: 11 },
      { local_camporee_id: 12 },
    ]);
    prisma.union_camporees.findMany.mockResolvedValue([
      { union_camporee_id: 22 },
    ]);
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
    expect(hierarchy.resolveAsOf).not.toHaveBeenCalled();
  });

  it('no historical local field context → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: null,
      union_id: null,
    });

    expect(await service.calculate(1, 2)).toBeNull();
    expect(prisma.local_camporees.findMany).not.toHaveBeenCalled();
  });

  it('historical hierarchy resolution failure → null', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({ user_id: 'u1' });
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockRejectedValue(new Error('history unavailable'));

    expect(await service.calculate(1, 2)).toBeNull();
    expect(prisma.local_camporees.findMany).not.toHaveBeenCalled();
  });
});
