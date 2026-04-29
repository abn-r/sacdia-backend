import { Test } from '@nestjs/testing';
import { SectionAggregationService } from './section-aggregation.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('SectionAggregationService', () => {
  let service: SectionAggregationService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { enrollmentRanking: { findMany: jest.fn() } };
    const m = await Test.createTestingModule({
      providers: [
        SectionAggregationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = m.get(SectionAggregationService);
  });

  it('3 enrollments with composite → AVG correct', async () => {
    prisma.enrollmentRanking.findMany.mockResolvedValue([
      { composite_score_pct: 80 },
      { composite_score_pct: 60 },
      { composite_score_pct: 40 },
    ]);
    expect(await service.aggregate(1, 2)).toEqual({
      composite_score_pct: 60,
      active_enrollment_count: 3,
    });
  });

  it('0 enrollments → composite NULL, count 0', async () => {
    prisma.enrollmentRanking.findMany.mockResolvedValue([]);
    expect(await service.aggregate(1, 2)).toEqual({
      composite_score_pct: null,
      active_enrollment_count: 0,
    });
  });

  it('mixed (NULLs filtered upstream by where) — only non-null in result', async () => {
    prisma.enrollmentRanking.findMany.mockResolvedValue([
      { composite_score_pct: 100 },
      { composite_score_pct: 50 },
    ]);
    expect(await service.aggregate(1, 2)).toEqual({
      composite_score_pct: 75,
      active_enrollment_count: 2,
    });
  });
});
