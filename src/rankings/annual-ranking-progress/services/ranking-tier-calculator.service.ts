import { Injectable } from '@nestjs/common';

export interface RankingTierInput {
  name: string;
  slug: string;
  bandPercentage: number;
  order: number;
}

export interface DerivedRankingTier {
  name: string;
  slug: string;
  order: number;
  bandPercentage: number;
  fromPoints: number;
  toPoints: number;
}

export interface DeriveRangesParams {
  maxPoints: number;
  tiers: RankingTierInput[];
}

export interface ResolveTierParams extends DeriveRangesParams {
  currentPoints: number;
}

export interface ResolvedRankingTier {
  currentTier: DerivedRankingTier | null;
  nextTier: DerivedRankingTier | null;
  pointsToNextTier: number | null;
  ranges: DerivedRankingTier[];
}

@Injectable()
export class RankingTierCalculatorService {
  deriveRanges({ maxPoints, tiers }: DeriveRangesParams): DerivedRankingTier[] {
    this.assertPositiveInteger(maxPoints, 'maxPoints');

    const orderedTiers = [...tiers].sort((a, b) => a.order - b.order);
    let cumulativePercentage = 0;
    let previousLowerBound = maxPoints + 1;

    return orderedTiers.map((tier) => {
      this.assertPositiveBand(tier.bandPercentage, tier.slug);

      cumulativePercentage += tier.bandPercentage;
      const fromPoints = Math.max(
        0,
        Math.ceil(maxPoints * (1 - cumulativePercentage / 100)),
      );
      const toPoints = previousLowerBound - 1;
      previousLowerBound = fromPoints;

      return {
        name: tier.name,
        slug: tier.slug,
        order: tier.order,
        bandPercentage: tier.bandPercentage,
        fromPoints,
        toPoints,
      };
    });
  }

  resolveTier(params: ResolveTierParams): ResolvedRankingTier {
    const ranges = this.deriveRanges(params);
    const normalizedPoints = Math.max(
      0,
      Math.min(params.currentPoints, params.maxPoints),
    );

    const currentTier =
      ranges.find(
        (range) =>
          normalizedPoints >= range.fromPoints &&
          normalizedPoints <= range.toPoints,
      ) ?? null;

    const nextTier = this.resolveNextTier(normalizedPoints, ranges, currentTier);
    const pointsToNextTier = nextTier
      ? Math.max(0, nextTier.fromPoints - normalizedPoints)
      : null;

    return {
      currentTier,
      nextTier,
      pointsToNextTier,
      ranges,
    };
  }

  private resolveNextTier(
    currentPoints: number,
    ranges: DerivedRankingTier[],
    currentTier: DerivedRankingTier | null,
  ): DerivedRankingTier | null {
    if (currentTier) {
      const currentIndex = ranges.findIndex(
        (range) => range.slug === currentTier.slug,
      );
      return currentIndex > 0 ? ranges[currentIndex - 1] : null;
    }

    return (
      [...ranges]
        .reverse()
        .find((range) => currentPoints < range.fromPoints) ?? null
    );
  }

  private assertPositiveInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive integer`);
    }
  }

  private assertPositiveBand(value: number, slug: string): void {
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      throw new Error(
        `Tier "${slug}" must have a band percentage between 0 and 100`,
      );
    }
  }
}
