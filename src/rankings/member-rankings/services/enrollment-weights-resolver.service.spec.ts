import { Test } from '@nestjs/testing';
import { EnrollmentWeightsResolverService } from './enrollment-weights-resolver.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('EnrollmentWeightsResolverService', () => {
  let service: EnrollmentWeightsResolverService;
  let prisma: any;

  beforeEach(async () => {
    prisma = { enrollmentRankingWeight: { findFirst: jest.fn() } };
    const m = await Test.createTestingModule({
      providers: [
        EnrollmentWeightsResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = m.get(EnrollmentWeightsResolverService);
  });

  it('override (clubType+year) wins', async () => {
    prisma.enrollmentRankingWeight.findFirst.mockResolvedValueOnce({
      class_pct: 40,
      investiture_pct: 40,
      camporee_pct: 20,
    });
    const r = await service.resolve({ clubTypeId: 1, ecclesiasticalYearId: 2 });
    expect(r).toEqual({
      class_pct: 40,
      investiture_pct: 40,
      camporee_pct: 20,
      source: 'override:club_type_1+year_2',
    });
  });

  it('override (clubType only) wins when year override absent', async () => {
    prisma.enrollmentRankingWeight.findFirst
      .mockResolvedValueOnce(null) // year+type miss
      .mockResolvedValueOnce({ class_pct: 60, investiture_pct: 25, camporee_pct: 15 });
    const r = await service.resolve({ clubTypeId: 1, ecclesiasticalYearId: 2 });
    expect(r).toEqual({
      class_pct: 60,
      investiture_pct: 25,
      camporee_pct: 15,
      source: 'override:club_type_1',
    });
  });

  it('falls back to default global', async () => {
    prisma.enrollmentRankingWeight.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        class_pct: 50,
        investiture_pct: 30,
        camporee_pct: 20,
        is_default: true,
      });
    const r = await service.resolve({ clubTypeId: 1, ecclesiasticalYearId: 2 });
    expect(r.class_pct).toBe(50);
    expect(r.investiture_pct).toBe(30);
    expect(r.camporee_pct).toBe(20);
    expect(r.source).toBe('default');
  });

  it('null clubTypeId skips override branches and uses default', async () => {
    prisma.enrollmentRankingWeight.findFirst.mockResolvedValueOnce({
      class_pct: 50,
      investiture_pct: 30,
      camporee_pct: 20,
      is_default: true,
    });
    const r = await service.resolve({ clubTypeId: null, ecclesiasticalYearId: 2 });
    expect(r.source).toBe('default');
    // verify only ONE findFirst call (the default branch)
    expect(prisma.enrollmentRankingWeight.findFirst).toHaveBeenCalledTimes(1);
  });

  it('throws when no default row exists', async () => {
    prisma.enrollmentRankingWeight.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    await expect(
      service.resolve({ clubTypeId: 1, ecclesiasticalYearId: 2 }),
    ).rejects.toThrow('No default enrollment_ranking_weights row found');
  });
});
