import {
  accentInsensitiveMatchSql,
  escapeLike,
  foldAccents,
  foldedColumnSql,
  searchTokens,
} from './accent-insensitive';

describe('accent-insensitive search', () => {
  it('folds accents in the search term', () => {
    expect(foldAccents('Pérez Núñez Çağla São')).toBe('Perez Nunez Cagla Sao');
  });

  it('splits and folds tokens, ignoring extra spaces', () => {
    expect(searchTokens('  José   MARÍA ')).toEqual(['Jose', 'MARIA']);
    expect(searchTokens(undefined)).toEqual([]);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });

  it('translates every accented letter to one plain letter', () => {
    const sql = foldedColumnSql('u.name');
    const [accented, plain] = sql.values as string[];
    expect([...accented]).toHaveLength([...plain].length);
    for (const char of plain) expect(char).toMatch(/^[A-Za-z]$/);
    for (const char of accented) {
      expect(foldAccents(char)).toMatch(/^[A-Za-z]$/);
    }
  });

  it('rejects unsafe column names', () => {
    expect(() => foldedColumnSql('u.name; DROP TABLE users')).toThrow(
      'Unsafe SQL column',
    );
  });

  it('builds AND across tokens and OR across columns', () => {
    const sql = accentInsensitiveMatchSql(['u.name', 'u.last'], ['ana', 'pe']);
    expect(sql.sql.match(/ILIKE/g)).toHaveLength(4);
    expect(sql.sql).toContain(' AND ');
    expect(sql.values).toEqual(expect.arrayContaining(['%ana%', '%pe%']));
  });

  it('returns TRUE without tokens', () => {
    expect(accentInsensitiveMatchSql(['u.name'], []).sql).toBe('TRUE');
  });
});
