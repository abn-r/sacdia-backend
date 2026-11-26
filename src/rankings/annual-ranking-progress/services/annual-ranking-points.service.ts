import { Injectable } from '@nestjs/common';
import {
  AnnualRankingScoreRegistryService,
  type AnnualRankingScoreContext,
  type AnnualRankingScoreResult,
} from './annual-ranking-score-registry.service';
import { normalizeRankingComponentKey } from '../ranking-component-catalog';
import type {
  AnnualRankingProgressAxisDto,
  AnnualRankingProgressComponentDto,
} from '../dto/annual-ranking-progress-response.dto';

export interface ConfiguredRankingComponent {
  component_key: string;
  label: string;
  max_points: number;
}

export interface ConfiguredRankingAxis {
  axis_key: string;
  label: string;
  max_points: number;
  components: ConfiguredRankingComponent[];
}

export interface AnnualRankingPointsConfig {
  axes?: ConfiguredRankingAxis[] | null;
  components?: ConfiguredRankingComponent[] | null;
}

export interface AnnualRankingPointsResult {
  axes: AnnualRankingProgressAxisDto[];
  components: AnnualRankingProgressComponentDto[];
  currentPoints: number;
}

type ComponentScoreMap = Record<string, AnnualRankingScoreResult>;

/**
 * Single source of the annual-progress point math shared by the section
 * progress endpoint, the leaderboard and the nightly progress snapshot:
 * config components -> registry scores -> axes/components -> current points.
 */
@Injectable()
export class AnnualRankingPointsService {
  constructor(
    private readonly scoreRegistry: AnnualRankingScoreRegistryService,
  ) {}

  /**
   * Scores every configured component for `context` and aggregates the result.
   * A null context (section without enrollment for the year) scores nothing:
   * every component reports 0 points.
   */
  async computePoints(
    config: AnnualRankingPointsConfig,
    context: AnnualRankingScoreContext | null,
  ): Promise<AnnualRankingPointsResult> {
    const scoreMap: ComponentScoreMap = context
      ? await this.scoreConfiguredComponents(
          this.getConfiguredComponents(config),
          context,
        )
      : {};

    const axes = this.buildAxisProgress(config.axes ?? [], scoreMap);
    const components =
      axes.length > 0
        ? axes.flatMap((axis) => axis.components)
        : this.buildComponentProgress(config.components ?? [], scoreMap);
    const currentPoints =
      axes.length > 0
        ? axes.reduce((sum, axis) => sum + axis.earned_points, 0)
        : components.reduce(
            (sum, component) => sum + component.earned_points,
            0,
          );

    return { axes, components, currentPoints };
  }

  percentage(value: number, max: number): number {
    if (max <= 0) return 0;
    return Math.round((value / max) * 10000) / 100;
  }

  calendarYearFromStartDate(
    startDate: Date | string | null | undefined,
  ): number {
    if (startDate == null) return new Date().getUTCFullYear();
    return new Date(startDate).getUTCFullYear();
  }

  private buildAxisProgress(
    axes: ConfiguredRankingAxis[],
    scoreMap: ComponentScoreMap,
  ): AnnualRankingProgressAxisDto[] {
    return axes.map((axis) => {
      const components = this.buildComponentProgress(axis.components, scoreMap);
      const earnedPoints = components.reduce(
        (sum, component) => sum + component.earned_points,
        0,
      );

      return {
        key: axis.axis_key,
        label: axis.label,
        earned_points: earnedPoints,
        max_points: axis.max_points,
        progress_percentage: this.percentage(earnedPoints, axis.max_points),
        components,
      };
    });
  }

  private buildComponentProgress(
    components: ConfiguredRankingComponent[],
    scoreMap: ComponentScoreMap,
  ): AnnualRankingProgressComponentDto[] {
    return components.map((component) => {
      const componentKey = this.canonicalComponentKey(component.component_key);
      const score = this.scoreFor(componentKey, scoreMap);
      const scorePct = this.scorePctFor(score);
      const maxPoints =
        score.max_points && score.max_points > 0
          ? score.max_points
          : component.max_points;
      const earnedPoints =
        score.earned_points ?? Math.round((scorePct / 100) * maxPoints);

      return {
        key: componentKey,
        label: component.label,
        earned_points: earnedPoints,
        max_points: maxPoints,
        progress_percentage: this.percentage(earnedPoints, maxPoints),
      };
    });
  }

  private scoreFor(
    key: string,
    scoreMap: ComponentScoreMap,
  ): AnnualRankingScoreResult {
    return (
      scoreMap[key] ?? {
        score_pct: 0,
        source_status: 'not_available',
        source: 'unsupported',
      }
    );
  }

  private scorePctFor(score: AnnualRankingScoreResult): number {
    return Math.max(0, Math.min(100, Number(score.score_pct ?? 0)));
  }

  private getConfiguredComponents(
    config: AnnualRankingPointsConfig,
  ): ConfiguredRankingComponent[] {
    const axes = config.axes ?? [];
    if (axes.length > 0) {
      return axes.flatMap((axis) => axis.components);
    }

    return config.components ?? [];
  }

  private async scoreConfiguredComponents(
    components: ConfiguredRankingComponent[],
    context: AnnualRankingScoreContext,
  ): Promise<ComponentScoreMap> {
    const entries = await Promise.all(
      components.map(async (component) => {
        const componentKey = this.canonicalComponentKey(
          component.component_key,
        );
        const result = await this.scoreRegistry.scoreComponent(
          { component_key: component.component_key, active: true },
          context,
        );

        return [componentKey, result] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private canonicalComponentKey(componentKey: string): string {
    try {
      return normalizeRankingComponentKey(componentKey);
    } catch {
      return componentKey;
    }
  }
}
