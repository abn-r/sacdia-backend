import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPermissionCatalog } from '../../scripts/authz/catalog-source';

const ROOT = join(__dirname, '../..');
const SQL = readFileSync(
  join(
    ROOT,
    'prisma/migrations/20261113130000_family_guardianship_permission_rename/migration.sql',
  ),
  'utf8',
);
const code = SQL.split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('Phase 4 migration 20261113130000 (guardianship permission rename)', () => {
  it('declares both renames for the catalog reader', () => {
    expect(SQL).toMatch(
      /^-- authz:rename legal_representative:read -> guardianship:read$/m,
    );
    expect(SQL).toMatch(
      /^-- authz:rename legal_representative:update -> guardianship:update$/m,
    );
  });

  it('is one idempotent DO block over both pairs', () => {
    expect(code).toMatch(/DO \$\$[\s\S]*END\s*\$\$;/);
    expect(code).toContain("'legal_representative:read',");
    expect(code).toContain("'guardianship:read',");
    expect(code).toContain("'legal_representative:update',");
    expect(code).toContain("'guardianship:update',");
  });

  it('old only: renames in place so permission_id (and every grant) is preserved', () => {
    expect(code).toMatch(
      /IF old_id IS NOT NULL AND new_id IS NULL THEN\s+UPDATE permissions\s+SET permission_name = pair\.new_name,[\s\S]*?WHERE permission_id = old_id;/,
    );
  });

  it('both: merges role and user grants with ON CONFLICT DO NOTHING, then deletes the old rows', () => {
    const both = code.slice(code.indexOf('ELSIF old_id IS NOT NULL'));
    expect(both).toMatch(
      /INSERT INTO role_permissions[\s\S]*?ON CONFLICT \(role_id, permission_id\) DO NOTHING/,
    );
    expect(both).toMatch(
      /INSERT INTO users_permissions[\s\S]*?ON CONFLICT \(user_id, permission_id\) DO NOTHING/,
    );
    const merge = both.indexOf('INSERT INTO users_permissions');
    expect(both.indexOf('DELETE FROM role_permissions')).toBeGreaterThan(merge);
    expect(both).toContain(
      'DELETE FROM permissions WHERE permission_id = old_id',
    );
  });

  it('neither: inserts the new permission', () => {
    expect(code).toMatch(
      /ELSIF old_id IS NULL AND new_id IS NULL THEN\s+INSERT INTO permissions/,
    );
  });

  it('does not touch the users:* legacy fallback permissions', () => {
    expect(code).not.toMatch(/users:(read_detail|update_profile)/);
  });

  it('leaves the generated catalog with the new keys only', () => {
    const keys = loadPermissionCatalog(ROOT).map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(['guardianship:read', 'guardianship:update']),
    );
    expect(keys).not.toContain('legal_representative:read');
    expect(keys).not.toContain('legal_representative:update');
  });
});
