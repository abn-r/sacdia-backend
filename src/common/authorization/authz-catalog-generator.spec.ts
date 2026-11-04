import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildOutputs,
  dartMemberName,
  diffOutputs,
  generate,
  GENERATED_HEADER,
  loadRoles,
  tsConstName,
  writeOutputs,
  type CatalogInput,
} from '../../../scripts/authz/generate-catalog';
import { loadPermissionCatalog } from '../../../scripts/authz/catalog-source';

const BACKEND_ROOT = path.resolve(__dirname, '../../..');

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'authz-catalog-'));
}

function fixtureRoot(): string {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'prisma/seeds'), { recursive: true });
  fs.mkdirSync(path.join(root, 'prisma/migrations/20260101000000_x'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'prisma/seeds/permissions.seed.sql'),
    `INSERT INTO permissions (permission_name, description, active) VALUES
  ('zeta:read', 'It''s zeta', true),
  ('club_roles:assign', 'Assign', true),
  ('old:thing', 'DEPRECATED', false);`,
  );
  fs.writeFileSync(
    path.join(root, 'prisma/migrations/20260101000000_x/migration.sql'),
    `INSERT INTO permissions (permission_name, description, active)
VALUES ('alpha:write', 'From migration', true);`,
  );
  return root;
}

const roles: CatalogInput['roles'] = [
  { role_name: 'user', role_category: 'GLOBAL' },
  { role_name: 'admin', role_category: 'GLOBAL' },
  { role_name: 'member', role_category: 'CLUB' },
];
const aliases: CatalogInput['aliases'] = {
  user: ['user'],
  admin: ['admin', 'user'],
};

describe('authz catalog source', () => {
  it('parses key, description, active and source from seed + migrations', () => {
    const catalog = loadPermissionCatalog(fixtureRoot());
    expect(catalog).toEqual([
      {
        key: 'alpha:write',
        description: 'From migration',
        active: true,
        source: 'prisma/migrations/20260101000000_x/migration.sql',
      },
      {
        key: 'club_roles:assign',
        description: 'Assign',
        active: true,
        source: 'prisma/seeds/permissions.seed.sql',
      },
      {
        key: 'old:thing',
        description: 'DEPRECATED',
        active: false,
        source: 'prisma/seeds/permissions.seed.sql',
      },
      {
        key: 'zeta:read',
        description: "It's zeta",
        active: true,
        source: 'prisma/seeds/permissions.seed.sql',
      },
    ]);
  });
});

describe('authz catalog generator', () => {
  const input = (): CatalogInput => ({
    permissions: loadPermissionCatalog(fixtureRoot()),
    roles,
    aliases,
    repos: { admin: true, app: true },
  });
  const find = (files: ReturnType<typeof buildOutputs>, rel: string) =>
    files.find((f) => f.relPath.endsWith(rel))!.content;

  it('emits deterministic TypeScript with sorted keys', () => {
    const files = buildOutputs(input());
    expect(find(files, 'permission-keys.ts')).toBe(`${GENERATED_HEADER}

export const PERMISSION_KEYS = [
  'alpha:write',
  'club_roles:assign',
  'zeta:read',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const DEPRECATED_PERMISSION_KEYS = [
  'old:thing',
] as const;

export const Permission = {
  ALPHA_WRITE: 'alpha:write',
  CLUB_ROLES_ASSIGN: 'club_roles:assign',
  ZETA_READ: 'zeta:read',
} as const;
`);
    expect(find(files, 'role-names.ts')).toContain(
      "export const GLOBAL_ROLE_NAMES = [\n  'admin',\n  'user',\n] as const;",
    );
    expect(find(files, 'role-aliases.ts')).toContain(
      "  admin: ['admin', 'user'],\n  user: ['user'],\n};",
    );
    expect(buildOutputs(input())).toEqual(files);
  });

  it('emits deterministic Dart', () => {
    const files = buildOutputs(input());
    expect(find(files, 'permission_keys.dart')).toBe(`${GENERATED_HEADER}

const Set<String> kPermissionKeys = {
  'alpha:write',
  'club_roles:assign',
  'zeta:read',
};

abstract final class Permissions {
  static const String alphaWrite = 'alpha:write';
  static const String clubRolesAssign = 'club_roles:assign';
  static const String zetaRead = 'zeta:read';
}
`);
    expect(find(files, 'role_names.dart')).toContain(
      "const List<String> kClubRoleNames = [\n  'member',\n];",
    );
    expect(find(files, 'role_aliases.dart')).toContain(
      "const Map<String, List<String>> kGlobalRoleAliases = {\n  'admin': ['admin', 'user'],",
    );
  });

  it('emits admin and app files only when requested', () => {
    const backendOnly = buildOutputs({ ...input(), repos: {} });
    expect(new Set(backendOnly.map((f) => f.repo))).toEqual(
      new Set(['backend']),
    );
  });

  it('names permissions without ambiguity', () => {
    expect(tsConstName('club_roles:assign')).toBe('CLUB_ROLES_ASSIGN');
    expect(tsConstName('upload-receipt:x')).toBe('UPLOAD_RECEIPT_X');
    expect(dartMemberName('club_roles:assign')).toBe('clubRolesAssign');
  });

  it('fails on name collisions', () => {
    const base = input();
    const permissions = [
      ...base.permissions,
      { key: 'a_b:c', description: '', active: true, source: 's' },
      { key: 'a:b_c', description: '', active: true, source: 's' },
    ];
    expect(() => buildOutputs({ ...base, permissions })).toThrow(
      /collision.*A_B_C/s,
    );
  });

  it('fails when an alias references an unknown role', () => {
    expect(() =>
      buildOutputs({ ...input(), aliases: { ...aliases, user: ['ghost'] } }),
    ).toThrow(/non-global roles/);
  });

  it('--check detects missing and drifted files', () => {
    const root = tmpRoot();
    const files = buildOutputs(input())
      .filter((f) => f.repo === 'backend')
      .map((f) => ({ ...f, abs: path.join(root, f.relPath) }));
    expect(diffOutputs(files)).toHaveLength(3);
    writeOutputs(files);
    expect(diffOutputs(files)).toEqual([]);
    fs.appendFileSync(files[0].abs, '// drift\n');
    expect(diffOutputs(files)).toEqual([files[0].abs]);
  });
});

describe('committed authz catalog', () => {
  it('backend generated files are up to date', () => {
    const files = generate({ backend: BACKEND_ROOT }).filter(
      (f) => f.repo === 'backend',
    );
    expect(diffOutputs(files)).toEqual([]);
  });
});

describe('prisma/authz/roles.json', () => {
  it('keeps the 22 seeded roles (names + categories)', () => {
    expect(
      loadRoles(BACKEND_ROOT).map((r) => `${r.role_category}:${r.role_name}`),
    ).toEqual([
      'GLOBAL:super-admin',
      'GLOBAL:admin',
      'GLOBAL:assistant-admin',
      'GLOBAL:coordinator',
      'GLOBAL:zone-coordinator',
      'GLOBAL:general-coordinator',
      'GLOBAL:director-lf',
      'GLOBAL:assistant-lf',
      'GLOBAL:director-union',
      'GLOBAL:assistant-union',
      'GLOBAL:director-dia',
      'GLOBAL:assistant-dia',
      'GLOBAL:pastor',
      'GLOBAL:user',
      'CLUB:director',
      'CLUB:deputy-director',
      'CLUB:secretary',
      'CLUB:treasurer',
      'CLUB:secretary-treasurer',
      'CLUB:counselor',
      'CLUB:instructor',
      'CLUB:member',
    ]);
    expect(loadRoles(BACKEND_ROOT).every((r) => r.active === true)).toBe(true);
  });
});
