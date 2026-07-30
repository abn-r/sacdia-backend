import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20260730150000_authorization_temporal_context',
    'migration.sql',
  ),
  'utf8',
);

describe('authorization temporal context migration', () => {
  it('keeps legacy rows while enforcing timezone configuration for future writes', () => {
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)',
    );
    expect(migration).toContain('local_fields_active_timezone_required');
    expect(migration).toContain('NOT VALID');
    expect(migration).toContain('authorization_context_versions');
  });
});
