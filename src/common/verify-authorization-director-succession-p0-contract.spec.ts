import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

describe('authorization P0 operational contract', () => {
  it('documents exits, limits, timezone contract and best-effort cleanup', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const text of [
      'REPEATABLE READ READ ONLY',
      'Node 24/ICU',
      '10 000 ms',
      '`0` — `clean`',
      '`1` — `blocked`',
      '`130` — `SIGINT`',
      '`143` — `SIGTERM`',
      'MISSING_DATABASE_URL',
      'America/Argentina/Buenos_Aires',
      'promete un `ROLLBACK` explícito',
    ])
      expect(readme).toContain(text);
  });
});
