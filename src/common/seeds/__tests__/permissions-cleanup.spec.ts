import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findSqlStatementPositions,
  stripSqlComments,
} from './sql-contract-test-utils';

// Static-analysis spec for the Phase 3 permission cleanup
// (`permission-scope-cleanup-phase-3`). Verifies the seed files no longer
// reference the retired legacy permission strings AND contain the idempotent
// cleanup statements required by spec Req-8 (no legacy role grants),
// Req-9 (legacy permission rows soft-deleted), and Req-10 (idempotent re-seed).
//
// We intentionally avoid spinning up an ephemeral DB here — the same checks
// were run end-to-end against the development branch during apply (see
// engram observation `sdd/permission-scope-cleanup-phase-3/apply-progress`).
// This spec guards against future regressions where someone re-introduces a
// legacy string into a role IN-array or removes the cleanup statements.

const LEGACY_PERMISSIONS = [
  'users:update',
  'classes:update',
  'user_honors:update',
] as const;

const LEGACY_CLEANUP_PERMISSIONS = [
  ...LEGACY_PERMISSIONS,
  'classes:validate',
  'qr:issue_self',
  'folders:read',
  'folders:manage',
  'user_folders:read',
  'user_folders:manage',
] as const;

// Resolved relative to repo root (`<rootDir>` = sacdia-backend/src).
const SEED_DIR = join(__dirname, '..', '..', '..', '..', 'prisma', 'seeds');
const PERMISSIONS_SEED_PATH = join(SEED_DIR, 'permissions.seed.sql');
const ROLE_PERMISSIONS_SEED_PATH = join(SEED_DIR, 'role-permissions.seed.sql');
const ACTIVE_SECTION_REGISTRATION_PERMISSION =
  'camporees:register_active_section';

describe('Phase 3 permission cleanup — seed files', () => {
  const permissionsSeed = readFileSync(PERMISSIONS_SEED_PATH, 'utf8');
  const rolePermissionsSeed = readFileSync(ROLE_PERMISSIONS_SEED_PATH, 'utf8');
  const permissionsSeedWithoutComments = stripSqlComments(permissionsSeed);
  const rolePermissionsSeedWithoutComments =
    stripSqlComments(rolePermissionsSeed);

  describe('role-permissions.seed.sql', () => {
    it('does not list any legacy permission inside a role IN-array (Req-8)', () => {
      // Strip SQL comments first so strings inside `--` lines do not trigger
      // a false positive (the cleanup DELETE statement legitimately mentions
      // the legacy strings inside an IN(...) clause that targets the
      // `permissions` table, NOT the role grant lists).
      const cleaned = extractAllRoleGrantBlocks(
        rolePermissionsSeedWithoutComments,
      );
      for (const legacy of LEGACY_PERMISSIONS) {
        expect(cleaned).not.toMatch(
          new RegExp(`^\\s*'${escapeRegex(legacy)}',?\\s*$`, 'm'),
        );
      }
    });

    it('contains the idempotent legacy DELETE block (Req-8 + Req-10)', () => {
      // Single normalized statement form expected:
      //   DELETE FROM role_permissions
      //   USING permissions p
      //   WHERE role_permissions.permission_id = p.permission_id
      //     AND p.permission_name IN (...);
      const normalized = rolePermissionsSeedWithoutComments.replace(
        /\s+/g,
        ' ',
      );
      const cleanupBlock = normalized.match(
        /DELETE FROM role_permissions USING permissions p WHERE role_permissions\.permission_id = p\.permission_id AND p\.permission_name IN \(([^)]*)\);/,
      );
      expect(cleanupBlock).not.toBeNull();
      for (const legacy of LEGACY_CLEANUP_PERMISSIONS) {
        expect(cleanupBlock?.[1]).toContain(`'${legacy}'`);
      }
    });

    it('grants user_honors:submit to the user and member roles', () => {
      // After Phase 3 these roles must retain a write capability on
      // user_honors — Phase 1+2 added submit to higher roles but missed user
      // and member; Phase 3 closes that gap.
      const userBlock = extractRoleBlock(
        rolePermissionsSeedWithoutComments,
        'user',
      );
      const memberBlock = extractRoleBlock(
        rolePermissionsSeedWithoutComments,
        'member',
      );
      expect(userBlock).toContain("'user_honors:submit'");
      expect(memberBlock).toContain("'user_honors:submit'");
    });

    it('grants active-section camporee registration only to the CLUB director', () => {
      expect(rolePermissionsSeedWithoutComments).toContain(
        `'${ACTIVE_SECTION_REGISTRATION_PERMISSION}'`,
      );

      const normalized = rolePermissionsSeedWithoutComments.replace(
        /\s+/g,
        ' ',
      );
      expect(normalized).toContain(
        `p.permission_name = '${ACTIVE_SECTION_REGISTRATION_PERMISSION}' AND NOT ( r.role_name = 'director' AND r.role_category = 'CLUB' )`,
      );

      const directorBlock = extractRoleBlock(
        rolePermissionsSeedWithoutComments,
        'director',
      );
      expect(directorBlock).toContain(
        `'${ACTIVE_SECTION_REGISTRATION_PERMISSION}'`,
      );

      for (const roleName of [
        'deputy-director',
        'secretary',
        'treasurer',
        'secretary-treasurer',
      ]) {
        expect(
          extractRoleBlock(rolePermissionsSeedWithoutComments, roleName),
        ).not.toContain(`'${ACTIVE_SECTION_REGISTRATION_PERMISSION}'`);
      }
    });

    it('removes non-director grants after broad admin grants and before COMMIT', () => {
      const adminBlock = extractRoleInsertBlock(
        rolePermissionsSeedWithoutComments,
        'admin',
      );
      const superAdminBlock = extractRoleInsertBlock(
        rolePermissionsSeedWithoutComments,
        'super-admin',
      );
      expect(adminBlock).toContain('CROSS JOIN permissions p');
      expect(adminBlock).toContain("p.permission_name NOT LIKE '%:delete'");
      expect(superAdminBlock).toContain('CROSS JOIN permissions p');
      expect(superAdminBlock).not.toContain('p.permission_name IN');

      const adminGrantIndex = rolePermissionsSeedWithoutComments.indexOf(
        "WHERE r.role_name = 'admin'",
      );
      const superAdminGrantIndex = rolePermissionsSeedWithoutComments.indexOf(
        "WHERE r.role_name = 'super-admin'",
      );
      const exclusiveCleanupIndex = rolePermissionsSeedWithoutComments.indexOf(
        `DELETE FROM role_permissions rp\nUSING permissions p, roles r\nWHERE rp.permission_id = p.permission_id\n  AND rp.role_id = r.role_id\n  AND p.permission_name = '${ACTIVE_SECTION_REGISTRATION_PERMISSION}'`,
      );
      const beginPositions = findSqlStatementPositions(
        rolePermissionsSeedWithoutComments,
        'BEGIN',
      );
      const commitPositions = findSqlStatementPositions(
        rolePermissionsSeedWithoutComments,
        'COMMIT',
      );
      const commitIndex = commitPositions[0] ?? -1;

      expect(beginPositions).toHaveLength(1);
      expect(commitPositions).toHaveLength(1);
      expect(adminGrantIndex).toBeGreaterThan(-1);
      expect(superAdminGrantIndex).toBeGreaterThan(adminGrantIndex);
      expect(exclusiveCleanupIndex).toBeGreaterThan(superAdminGrantIndex);
      expect(commitIndex).toBeGreaterThan(exclusiveCleanupIndex);
      expect(
        hasProtectedRoleCleanupOrder(rolePermissionsSeedWithoutComments),
      ).toBe(true);
    });

    it('rejects a COMMIT inserted between broad grants and exclusive cleanup', () => {
      const cleanupMarker = 'DELETE FROM role_permissions rp';
      const withIntermediateCommit = rolePermissionsSeedWithoutComments.replace(
        cleanupMarker,
        `COMMIT;\n${cleanupMarker}`,
      );

      expect(hasProtectedRoleCleanupOrder(withIntermediateCommit)).toBe(false);
    });
  });

  describe('permissions.seed.sql', () => {
    it('defines active-section camporee registration canonically', () => {
      expect(permissionsSeedWithoutComments).toContain(
        `('${ACTIVE_SECTION_REGISTRATION_PERMISSION}', 'Register the director active club section in a camporee', true)`,
      );
    });

    it('soft-deletes the three legacy permission rows (Req-9)', () => {
      const normalized = permissionsSeedWithoutComments.replace(/\s+/g, ' ');
      expect(normalized).toMatch(
        /UPDATE permissions SET active = false, modified_at = now\(\) WHERE permission_name IN \('users:update', 'classes:update', 'user_honors:update'\) AND active = true;/,
      );
    });

    it('still defines the legacy rows so audit FKs survive (Req-9)', () => {
      // Row insertion stays so historical audit references resolve. The
      // active flag is what flips — see the soft-delete assertion above.
      expect(permissionsSeedWithoutComments).toContain("('users:update',");
      expect(permissionsSeedWithoutComments).toContain("('classes:update',");
      expect(permissionsSeedWithoutComments).toContain(
        "('user_honors:update',",
      );
    });

    it('keeps the soft-delete UPDATE inside the BEGIN/COMMIT block', () => {
      const beginPositions = findSqlStatementPositions(
        permissionsSeedWithoutComments,
        'BEGIN',
      );
      const commitPositions = findSqlStatementPositions(
        permissionsSeedWithoutComments,
        'COMMIT',
      );
      const idxBegin = beginPositions[0] ?? -1;
      const idxCommit = commitPositions[0] ?? -1;
      const idxSoftDelete =
        permissionsSeedWithoutComments.indexOf('UPDATE permissions');
      expect(beginPositions).toHaveLength(1);
      expect(commitPositions).toHaveLength(1);
      expect(idxBegin).toBeGreaterThan(-1);
      expect(idxCommit).toBeGreaterThan(idxBegin);
      expect(idxSoftDelete).toBeGreaterThan(idxBegin);
      expect(idxSoftDelete).toBeLessThan(idxCommit);
    });
  });
});

describe('SQL comment sanitizer', () => {
  it('removes line comments', () => {
    expect(stripSqlComments('SELECT 1; -- remove me\nSELECT 2;')).toBe(
      'SELECT 1; \nSELECT 2;',
    );
  });

  it('removes block comments including multiline content', () => {
    expect(stripSqlComments('SELECT 1; /* remove\nthis */ SELECT 2;')).toBe(
      'SELECT 1;  \n SELECT 2;',
    );
  });

  it('preserves comment markers inside SQL strings', () => {
    const sql =
      "SELECT '-- keep', '/* keep */', 'it''s -- still data'; -- remove";

    expect(stripSqlComments(sql)).toBe(
      "SELECT '-- keep', '/* keep */', 'it''s -- still data'; ",
    );
  });

  it('does not count transaction keywords inside SQL strings', () => {
    const sql = "BEGIN; SELECT 'COMMIT;', 'BEGIN;'; COMMIT;";

    expect(findSqlStatementPositions(sql, 'BEGIN')).toHaveLength(1);
    expect(findSqlStatementPositions(sql, 'COMMIT')).toHaveLength(1);
  });

  it('treats backslashes as ordinary characters in standard strings', () => {
    const sql = "BEGIN; SELECT 'C:\\'; COMMIT; CREATE TABLE x(id int); COMMIT;";

    expect(findSqlStatementPositions(sql, 'COMMIT')).toHaveLength(2);
  });

  it('honors backslash escapes only in PostgreSQL E strings', () => {
    const sql = "BEGIN; SELECT E'C:\\''; COMMIT;";

    expect(findSqlStatementPositions(sql, 'BEGIN')).toHaveLength(1);
    expect(findSqlStatementPositions(sql, 'COMMIT')).toHaveLength(1);
  });

  it('does not open a dollar quote inside an unquoted identifier', () => {
    const sql = 'BEGIN; SELECT foo$tag$bar; COMMIT;';

    expect(findSqlStatementPositions(sql, 'COMMIT')).toHaveLength(1);
  });

  it('hides transaction keywords inside a valid dollar-quoted string', () => {
    const sql = 'BEGIN; SELECT $tag$COMMIT;$tag$; COMMIT;';

    expect(findSqlStatementPositions(sql, 'COMMIT')).toHaveLength(1);
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractAllRoleGrantBlocks(sql: string): string {
  const blocks = sql.match(
    /WHERE r\.role_name(?:\s+IN\s+\([^)]*\)|\s+=\s+'[^']+')[^]*?ON CONFLICT \(role_id, permission_id\) DO NOTHING;/g,
  );

  if (!blocks?.length) {
    throw new Error('Could not locate any role grant blocks');
  }

  return blocks.join('\n');
}

function extractRoleBlock(sql: string, roleName: string): string {
  const startMarker = `WHERE r.role_name = '${roleName}'`;
  const startIdx = sql.indexOf(startMarker);
  if (startIdx < 0) {
    throw new Error(`Could not locate INSERT block for role '${roleName}'`);
  }
  const endIdx = sql.indexOf(
    'ON CONFLICT (role_id, permission_id) DO NOTHING;',
    startIdx,
  );
  if (endIdx < 0) {
    throw new Error(`Could not locate end of role block for '${roleName}'`);
  }
  return sql.slice(startIdx, endIdx);
}

function extractRoleInsertBlock(sql: string, roleName: string): string {
  const roleWhere = `WHERE r.role_name = '${roleName}'`;
  const whereIndex = sql.indexOf(roleWhere);
  if (whereIndex < 0) {
    throw new Error(`Could not locate INSERT block for role '${roleName}'`);
  }

  const startIndex = sql.lastIndexOf(
    'INSERT INTO role_permissions',
    whereIndex,
  );
  if (startIndex < 0) {
    throw new Error(`Could not locate start of role block for '${roleName}'`);
  }

  const endIndex = sql.indexOf(
    'ON CONFLICT (role_id, permission_id) DO NOTHING;',
    whereIndex,
  );
  if (endIndex < 0) {
    throw new Error(`Could not locate end of role block for '${roleName}'`);
  }

  return sql.slice(startIndex, endIndex);
}

function hasProtectedRoleCleanupOrder(sql: string): boolean {
  const adminGrantIndex = sql.indexOf("WHERE r.role_name = 'admin'");
  const superAdminGrantIndex = sql.indexOf("WHERE r.role_name = 'super-admin'");
  const cleanupIndex = sql.indexOf('DELETE FROM role_permissions rp');
  const beginPositions = findSqlStatementPositions(sql, 'BEGIN');
  const commitPositions = findSqlStatementPositions(sql, 'COMMIT');
  const beginIndex = beginPositions[0] ?? -1;
  const commitIndex = commitPositions[0] ?? -1;

  return (
    beginPositions.length === 1 &&
    commitPositions.length === 1 &&
    adminGrantIndex > beginIndex &&
    superAdminGrantIndex > adminGrantIndex &&
    cleanupIndex > superAdminGrantIndex &&
    commitIndex > cleanupIndex
  );
}
