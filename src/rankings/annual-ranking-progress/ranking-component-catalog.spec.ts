import {
  RANKING_COMPONENTS,
  getRankingComponentAxis,
  normalizeRankingComponentKey,
} from './ranking-component-catalog';

describe('ranking component catalog', () => {
  it('normalizes legacy component keys to canonical keys', () => {
    expect(normalizeRankingComponentKey('annual_folder')).toBe(
      'annual_evidence_folder',
    );
    expect(normalizeRankingComponentKey('finance')).toBe('finance_compliance');
    expect(normalizeRankingComponentKey('camporee')).toBe('camporee_events');
  });

  it('rejects unknown component keys', () => {
    expect(() => normalizeRankingComponentKey('evidence')).toThrow(
      'Unknown annual ranking component key: evidence',
    );
  });

  it('maps component keys to exactly one axis', () => {
    const componentKeys = Object.keys(RANKING_COMPONENTS);

    expect(new Set(componentKeys).size).toBe(componentKeys.length);
    for (const componentKey of componentKeys) {
      expect(['administrative', 'operational']).toContain(
        getRankingComponentAxis(componentKey),
      );
    }

    expect(getRankingComponentAxis('annual_evidence_folder')).toBe(
      'administrative',
    );
    expect(getRankingComponentAxis('camporee_events')).toBe('operational');
  });
});
