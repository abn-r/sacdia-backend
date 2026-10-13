import {
  buildHonorSearchQuery,
  buildHonorSearchTokens,
  foldAccents,
  pickHonorSearchMatches,
  stemHonorSearchToken,
} from './honor-search-tokens';

describe('honor search tokens', () => {
  it('folds accents and case the same way the SQL translate does', () => {
    expect(foldAccents('NATACIÓN Ñandú Güemes')).toBe('natacion nandu guemes');
  });

  it('keeps tokens of 3+ letters and drops short and stop words', () => {
    expect(buildHonorSearchTokens('Nudos y amarras de la selva')).toEqual([
      'nudos',
      'amarras',
      'selva',
    ]);
    expect(buildHonorSearchTokens('Primeros Auxilios, básico.')).toEqual([
      'primeros',
      'auxilios',
      'basico',
    ]);
  });

  it('searches the whole text when no token survives', () => {
    expect(buildHonorSearchTokens('de la')).toEqual(['de la']);
    expect(buildHonorSearchTokens('ab')).toEqual(['ab']);
  });

  it('deduplicates tokens', () => {
    expect(buildHonorSearchTokens('nudos NUDOS')).toEqual(['nudos']);
  });

  it('stems singular/plural endings', () => {
    expect(stemHonorSearchToken('amarras')).toBe('amarr');
    expect(stemHonorSearchToken('natacion')).toBe('nataci');
    expect(stemHonorSearchToken('nudos')).toBe('nudo');
    expect(stemHonorSearchToken('red')).toBe('red');
  });

  it('builds a parametrized query with no user text inside the SQL', () => {
    const query = buildHonorSearchQuery(['natacion', 'a_bc']);

    expect(query.sql).not.toMatch(/natac|nudo/);
    expect(query.sql).toContain('h.active = true');
    expect(query.values).toEqual(
      expect.arrayContaining(['%nataci%', '%a\\_bc%']),
    );
  });

  describe('pickHonorSearchMatches', () => {
    const rows = [
      { honor_id: 1, score: 1 },
      { honor_id: 2, score: 2 },
      { honor_id: 3, score: 2 },
    ];

    it('keeps only the rows that match every token', () => {
      expect(pickHonorSearchMatches(rows, 2).map((r) => r.honorId)).toEqual([
        2, 3,
      ]);
    });

    it('falls back to any token, most matches first', () => {
      expect(pickHonorSearchMatches(rows, 3).map((r) => r.honorId)).toEqual([
        2, 3, 1,
      ]);
    });
  });
});
