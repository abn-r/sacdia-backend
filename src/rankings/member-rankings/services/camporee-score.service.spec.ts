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
      ecclesiastical_years: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
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

  it('inherits the active club section score from official results', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.$queryRaw.mockResolvedValue([
      { awarded_points: '150.00', max_points: '200.00' },
    ]);

    expect(await service.calculate(1, 2)).toBe(75);
    const sql = String(prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toContain('camporee_event_section_results');
    expect(sql).not.toContain('camporee_members');
  });

  it('missing result contributes zero but scoring events remain denominator', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.$queryRaw.mockResolvedValue([
      { awarded_points: '0.00', max_points: '200.00' },
    ]);

    expect(await service.calculate(1, 2)).toBe(0);
  });

  it('total scoring events = 0 → null', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: 5,
    });
    prisma.$queryRaw.mockResolvedValue([
      { awarded_points: '0.00', max_points: '0.00' },
    ]);

    expect(await service.calculate(1, 2)).toBeNull();
  });

  it('club without union_id still scores local camporee events', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockResolvedValue({
      local_field_id: 100,
      union_id: null,
    });
    prisma.$queryRaw.mockResolvedValue([
      { awarded_points: '100.00', max_points: '100.00' },
    ]);

    expect(await service.calculate(1, 2)).toBe(100);
  });

  it('resolver returns null (no active assignment) → null', async () => {
    resolver.resolve.mockResolvedValue(null);
    expect(await service.calculate(1, 2)).toBeNull();
    expect(hierarchy.resolveAsOf).not.toHaveBeenCalled();
  });

  it('no historical local field context → null', async () => {
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
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('historical hierarchy resolution failure → null', async () => {
    prisma.ecclesiastical_years.findUnique.mockResolvedValue({
      start_date: new Date('2026-01-01T00:00:00.000Z'),
      end_date: new Date('2026-12-31T23:59:59.999Z'),
    });
    resolver.resolve.mockResolvedValue({ clubId: 10, clubSectionId: 50 });
    hierarchy.resolveAsOf.mockRejectedValue(new Error('history unavailable'));

    expect(await service.calculate(1, 2)).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
