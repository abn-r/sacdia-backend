import { escapeLikeWildcards } from './escape-like';

describe('escapeLikeWildcards', () => {
  it('escapes %, _ and backslash so they stop acting as wildcards', () => {
    expect(escapeLikeWildcards('100%_ok\\')).toBe('100\\%\\_ok\\\\');
  });

  it('leaves plain text untouched', () => {
    expect(escapeLikeWildcards('Primeros Auxilios')).toBe('Primeros Auxilios');
  });
});
