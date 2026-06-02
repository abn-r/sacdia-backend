import { RankingTierCalculatorService } from './ranking-tier-calculator.service';

describe('RankingTierCalculatorService', () => {
  let service: RankingTierCalculatorService;

  const tiers = [
    { name: 'Diamante', slug: 'diamante', bandPercentage: 5, order: 1 },
    { name: 'Oro', slug: 'oro', bandPercentage: 10, order: 2 },
    { name: 'Plata', slug: 'plata', bandPercentage: 15, order: 3 },
  ];

  beforeEach(() => {
    service = new RankingTierCalculatorService();
  });

  it('derives non-overlapping point ranges downward from max points', () => {
    expect(service.deriveRanges({ maxPoints: 10000, tiers })).toEqual([
      {
        name: 'Diamante',
        slug: 'diamante',
        order: 1,
        bandPercentage: 5,
        fromPoints: 9500,
        toPoints: 10000,
      },
      {
        name: 'Oro',
        slug: 'oro',
        order: 2,
        bandPercentage: 10,
        fromPoints: 8500,
        toPoints: 9499,
      },
      {
        name: 'Plata',
        slug: 'plata',
        order: 3,
        bandPercentage: 15,
        fromPoints: 7000,
        toPoints: 8499,
      },
    ]);
  });

  it('maps exact lower boundary of top tier to that tier', () => {
    const result = service.resolveTier({
      currentPoints: 9500,
      maxPoints: 10000,
      tiers,
    });

    expect(result.currentTier?.slug).toBe('diamante');
    expect(result.nextTier).toBeNull();
    expect(result.pointsToNextTier).toBeNull();
  });

  it('maps the point below top tier boundary to the next tier', () => {
    const result = service.resolveTier({
      currentPoints: 9499,
      maxPoints: 10000,
      tiers,
    });

    expect(result.currentTier?.slug).toBe('oro');
    expect(result.nextTier?.slug).toBe('diamante');
    expect(result.pointsToNextTier).toBe(1);
  });

  it('calculates points required to reach the next tier', () => {
    const result = service.resolveTier({
      currentPoints: 8450,
      maxPoints: 10000,
      tiers,
    });

    expect(result.currentTier?.slug).toBe('plata');
    expect(result.nextTier?.slug).toBe('oro');
    expect(result.pointsToNextTier).toBe(50);
  });

  it('returns no current tier when points are below the configured bands', () => {
    const result = service.resolveTier({
      currentPoints: 6000,
      maxPoints: 10000,
      tiers,
    });

    expect(result.currentTier).toBeNull();
    expect(result.nextTier?.slug).toBe('plata');
    expect(result.pointsToNextTier).toBe(1000);
  });
});
