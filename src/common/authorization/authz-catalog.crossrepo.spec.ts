import * as fs from 'fs';
import * as path from 'path';
import {
  buildOutputs,
  diffOutputs,
  loadRoles,
} from '../../../scripts/authz/generate-catalog';
import { loadPermissionCatalog } from '../../../scripts/authz/catalog-source';
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

function stale(repo: 'admin' | 'app', root: string): string[] {
  const files = buildOutputs({
    permissions: loadPermissionCatalog(BACKEND_ROOT),
    roles: loadRoles(BACKEND_ROOT),
    aliases: GLOBAL_ROLE_ALIASES,
    repos: { admin: repo === 'admin', app: repo === 'app' },
  })
    .filter((f) => f.repo === repo)
    .map((f) => ({ ...f, abs: path.join(root, f.relPath) }));
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
