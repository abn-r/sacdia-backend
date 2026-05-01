import { CompositeScoreService } from './composite-score';

describe('CompositeScoreService.compose', () => {
  const svc = new CompositeScoreService();

  it('weights default 60/15/15/10 over scores', () => {
    const result = svc.compose(
      { folder: 78.5, finance: 91.66, camporee: 50, evidence: 88 },
      {
        folder: 60,
        finance: 15,
        camporee: 15,
        evidence: 10,
        source: 'default',
      },
    );
    // (78.5*60 + 91.66*15 + 50*15 + 88*10) / 100
    expect(result).toBeCloseTo(77.15, 2);
  });

  it('weights override yields correct composite', () => {
    const result = svc.compose(
      { folder: 100, finance: 0, camporee: 0, evidence: 0 },
      {
        folder: 50,
        finance: 20,
        camporee: 20,
        evidence: 10,
        source: 'club_type_override',
      },
    );
    expect(result).toBe(50);
  });

  it('returns 100 when all scores are 100', () => {
    const result = svc.compose(
      { folder: 100, finance: 100, camporee: 100, evidence: 100 },
      {
        folder: 60,
        finance: 15,
        camporee: 15,
        evidence: 10,
        source: 'default',
      },
    );
    expect(result).toBe(100);
  });

  it('returns 0 when all scores are 0', () => {
    const result = svc.compose(
      { folder: 0, finance: 0, camporee: 0, evidence: 0 },
      {
        folder: 60,
        finance: 15,
        camporee: 15,
        evidence: 10,
        source: 'default',
      },
    );
    expect(result).toBe(0);
  });
});
