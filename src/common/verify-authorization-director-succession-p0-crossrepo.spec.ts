import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as preflightScript from '../../scripts/verify-authorization-director-succession-p0';
import { createTestConsumerRoots } from './testing/authorization-p0-consumer-roots.fixture';

type Roots = { adminRoot: string; appRoot: string; docsRoot: string };
type Refs = { adminRef: string; appRef: string; docsRef: string };
const root = join(__dirname, '../..');
const crossRepoIt =
  process.env.ALLOW_AUTHORIZATION_P0_CROSS_REPO === '1' ? it : it.skip;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

describe('authorization P0 cross-repository contract', () => {
  it('keeps canonical consumer ids independent from checkout basenames', () => {
    const fixture = createTestConsumerRoots(
      preflightScript.CONSUMER_INVENTORY,
      {
        admin: 'admin-at-sealed-ref',
        app: 'flutter-at-sealed-ref',
      },
    );
    try {
      expect(
        preflightScript.discoverConsumerInventory(
          preflightScript.resolveConsumerRoots(fixture),
        ),
      ).toMatchObject({
        known_internal_consumers: preflightScript.CONSUMER_INVENTORY,
      });
    } finally {
      fixture.dispose();
    }
  });

  it('keeps backend units hermetic and aggregates the required status', () => {
    const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
    for (const text of [
      'name: Backend Unit Tests',
      'name: Redis Contract',
      'name: Cross-repo Contract',
      'https://github.com/abn-r/sacdia.git',
      'git init .contract-sources/sacdia',
      'repository: abn-r/sacdia-admin',
      'repository: abn-r/sacdia-app',
      'persist-credentials: false',
      'SACDIA_ROOT_CONTRACT_REF',
      'SACDIA_ADMIN_CONTRACT_REF',
      'SACDIA_APP_CONTRACT_REF',
      'name: Unit Tests',
      'name: Backend E2E Tests',
      'name: Dependency Audit',
      'needs: [backend_unit_tests, cross_repo_contract, redis_contract, backend_e2e_tests, dependency_audit]',
      'REDIS_RESULT: ${{ needs.redis_contract.result }}',
      'E2E_RESULT: ${{ needs.backend_e2e_tests.result }}',
      'AUDIT_RESULT: ${{ needs.dependency_audit.result }}',
      'if: ${{ always() }}',
      'needs: required_unit_tests',
    ])
      expect(ci).toContain(text);
    expect(ci).not.toMatch(
      /name: Checkout canonical docs\n\s+uses: actions\/checkout/,
    );
    expect(ci).not.toMatch(/SACDIA_CROSS_REPO_READ_TOKEN|secrets\./);
  });

  crossRepoIt('verifies exact roots, canonical docs and ref mismatch', () => {
    const contract = preflightScript as typeof preflightScript & {
      resolveConsumerRoots?: (roots: Roots) => Roots;
      verifyConsumerRootRevisions?: (roots: Roots, refs: Refs) => void;
    };
    expect(contract.resolveConsumerRoots).toBeDefined();
    expect(contract.verifyConsumerRootRevisions).toBeDefined();
    if (!contract.resolveConsumerRoots || !contract.verifyConsumerRootRevisions)
      return;
    const roots = contract.resolveConsumerRoots({
      adminRoot: required('SACDIA_ADMIN_ROOT'),
      appRoot: required('SACDIA_APP_ROOT'),
      docsRoot: required('SACDIA_CANONICAL_DOCS_ROOT'),
    });
    const names = [
      'SACDIA_ADMIN_CONTRACT_REF',
      'SACDIA_APP_CONTRACT_REF',
      'SACDIA_ROOT_CONTRACT_REF',
    ] as const;
    const saved = names.map((name) => [name, required(name)] as const);
    for (const [name] of saved) delete process.env[name];
    try {
      expect(() => preflightScript.inspectConsumerInventory(roots)).toThrow(
        'CONSUMER_INVENTORY_REF_MISMATCH',
      );
    } finally {
      for (const [name, value] of saved) process.env[name] = value;
    }
    const refs = {
      adminRef: required('SACDIA_ADMIN_CONTRACT_REF'),
      appRef: required('SACDIA_APP_CONTRACT_REF'),
      docsRef: required('SACDIA_ROOT_CONTRACT_REF'),
    };
    for (const ref of Object.values(refs))
      expect(ref).toMatch(/^[0-9a-f]{40}$/);
    expect(() =>
      contract.verifyConsumerRootRevisions?.(roots, {
        ...refs,
        appRef: `${refs.appRef[0] === '0' ? '1' : '0'}${refs.appRef.slice(1)}`,
      }),
    ).toThrow('CONSUMER_INVENTORY_REF_MISMATCH');
    expect(() =>
      contract.verifyConsumerRootRevisions?.(roots, refs),
    ).not.toThrow();
    expect(preflightScript.inspectConsumerInventory(roots)).toMatchObject({
      known_internal_consumers: preflightScript.CONSUMER_INVENTORY,
      active_jsx_consumers: [],
      flutter_consumers: [],
    });
    const canonical = readFileSync(
      join(roots.docsRoot, 'docs/features/gestion-clubs.md'),
      'utf8',
    );
    expect(() =>
      preflightScript.verifyCanonicalDocsContract(canonical),
    ).not.toThrow();
    expect(() =>
      preflightScript.verifyCanonicalDocsContract(
        canonical.replace(preflightScript.CANONICAL_CONTRACT_PHRASES[0], ''),
      ),
    ).toThrow('CONSUMER_CONTRACT_DRIFT');
    for (const text of preflightScript.CANONICAL_CONTRACT_PHRASES)
      expect(canonical).toContain(text);
    for (const [directory, expected] of [
      [roots.docsRoot, refs.docsRef],
      [roots.adminRoot, refs.adminRef],
      [roots.appRoot, refs.appRef],
    ])
      expect(
        execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
      ).toBe(expected);
  });
});
