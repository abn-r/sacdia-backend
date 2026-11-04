import * as fs from 'fs';
import * as path from 'path';
import {
  buildOutputs,
  diffOutputs,
  loadRoles,
} from '../../../scripts/authz/generate-catalog';
import {
  loadCapabilityCatalog,
  loadPermissionCatalog,
} from '../../../scripts/authz/catalog-source';
import { GLOBAL_ROLE_ALIASES } from '../guards/global-role-aliases';

const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const adminRoot = process.env.SACDIA_ADMIN_ROOT;
const appRoot = process.env.SACDIA_APP_ROOT;

// Skips while the sibling repo has not adopted `generated/` yet (adoption is a
// PR in that repo); once the directory exists, any drift fails.
function adopted(root: string | undefined, relDir: string): boolean {
  if (!root) return false;
  const ok = fs.existsSync(path.join(root, relDir));
  if (!ok) console.warn(`authz crossrepo: ${relDir} not adopted in ${root}`);
  return ok;
}
const adminIt = adopted(adminRoot, 'src/lib/auth/generated') ? it : it.skip;
const appIt = adopted(appRoot, 'lib/core/authorization/generated')
  ? it
  : it.skip;

// Files the sibling may not have adopted yet (each adoption is a PR in that
// repo): skipped with a warning while absent, compared like the rest once
// they exist.
const OPTIONAL_UNTIL_ADOPTED = new Set([
  'src/lib/auth/generated/capability-keys.ts',
  'lib/core/authorization/generated/capability_keys.dart',
]);

function stale(repo: 'admin' | 'app', root: string): string[] {
  const files = buildOutputs({
    permissions: loadPermissionCatalog(BACKEND_ROOT),
    roles: loadRoles(BACKEND_ROOT),
    aliases: GLOBAL_ROLE_ALIASES,
    capabilities: loadCapabilityCatalog(),
    repos: { admin: repo === 'admin', app: repo === 'app' },
  })
    .filter((f) => f.repo === repo)
    .map((f) => ({ ...f, abs: path.join(root, f.relPath) }))
    .filter((f) => {
      if (!OPTIONAL_UNTIL_ADOPTED.has(f.relPath) || fs.existsSync(f.abs)) {
        return true;
      }
      console.warn(`authz crossrepo: ${f.relPath} not adopted in ${root}`);
      return false;
    });
  return diffOutputs(files);
}

describe('authz catalog cross-repo parity', () => {
  adminIt('sacdia-admin generated catalog matches the backend', () => {
    expect(stale('admin', adminRoot as string)).toEqual([]);
  });

  appIt('sacdia-app generated catalog matches the backend', () => {
    expect(stale('app', appRoot as string)).toEqual([]);
  });
});
