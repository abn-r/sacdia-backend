import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('investiture authorization does not depend on the legacy pipeline', () => {
  it('no file under src/investiture-requests imports src/investiture', () => {
    const dir = join(process.cwd(), 'src', 'investiture-requests');
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) =>
        /from '\.\.\/investiture\//.test(readFileSync(join(dir, name), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
