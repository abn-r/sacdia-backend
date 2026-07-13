import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const permissionsSeedWithoutComments = stripSqlLineComments(permissionsSeed);
  const rolePermissionsSeedWithoutComments =
    stripSqlLineComments(rolePermissionsSeed);

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
      const commitIndex =
        rolePermissionsSeedWithoutComments.lastIndexOf('COMMIT;');

      expect(adminGrantIndex).toBeGreaterThan(-1);
      expect(superAdminGrantIndex).toBeGreaterThan(adminGrantIndex);
      expect(exclusiveCleanupIndex).toBeGreaterThan(superAdminGrantIndex);
      expect(commitIndex).toBeGreaterThan(exclusiveCleanupIndex);
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
      const idxBegin = permissionsSeedWithoutComments.indexOf('BEGIN;');
      const idxCommit = permissionsSeedWithoutComments.lastIndexOf('COMMIT;');
      const idxSoftDelete =
        permissionsSeedWithoutComments.indexOf('UPDATE permissions');
      expect(idxBegin).toBeGreaterThan(-1);
      expect(idxCommit).toBeGreaterThan(idxBegin);
      expect(idxSoftDelete).toBeGreaterThan(idxBegin);
      expect(idxSoftDelete).toBeLessThan(idxCommit);
    });
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Drop SQL line comments (-- ...) so legacy mentions inside comments do not
// poison the IN-array assertion.
function stripSqlLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
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
