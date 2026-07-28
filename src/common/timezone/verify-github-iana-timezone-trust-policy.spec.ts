import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const verifier = join(
  root,
  'scripts/verify-github-iana-timezone-trust-policy.ts',
);
const requiredStatus = 'Lint & Type Check';
const completeCodeowners = `
/.github/CODEOWNERS @security-reviewers
/.github/actions/** @security-reviewers
/.github/workflows/** @security-reviewers
/.githooks/** @security-reviewers
/.husky/** @security-reviewers
/.npmrc @security-reviewers
/.pnpmfile.cjs @security-reviewers
/.prettierrc* @security-reviewers
/docs/runbooks/iana-timezone-trust-bootstrap.md @security-reviewers
/eslint.config.* @security-reviewers
/eslint.config.mjs @security-reviewers
/nest-cli.json @security-reviewers
/package.json @security-reviewers
/patches/** @security-reviewers
/pnpm-lock.yaml @security-reviewers
/pnpm-workspace.yaml @security-reviewers
/prettier-plugins/** @security-reviewers
/prettier.config.* @security-reviewers
/scripts/** @security-reviewers
/src/common/timezone/** @security-reviewers
/tsconfig*.json @security-reviewers
/tsconfig.build.json @security-reviewers
/tsconfig.json @security-reviewers
`;
const limitedCodeowners = `
/.github/CODEOWNERS @security-reviewers
/.github/workflows/ci.yml @security-reviewers
/package.json @security-reviewers
/nest-cli.json @security-reviewers
/scripts/generate-geographic-iana-timezone-sources.ts @security-reviewers
/scripts/verify-github-iana-timezone-trust-policy.ts @security-reviewers
/scripts/verify-iana-timezone-release.sh @security-reviewers
/src/common/timezone/** @security-reviewers
/docs/runbooks/iana-timezone-trust-bootstrap.md @security-reviewers
`;
type Exclusion =
  | 'exact'
  | 'wildcard'
  | 'single'
  | 'recursive'
  | 'class'
  | 'range'
  | 'negated'
  | 'malformed';
const exclusionPatterns: Record<Exclusion, string> = {
  exact: 'refs/heads/development',
  wildcard: 'refs/heads/develop*',
  single: 'refs/heads/developmen?',
  recursive: 'refs/**/development',
  class: 'refs/heads/developmen[t]',
  range: 'refs/heads/developmen[s-u]',
  negated: 'refs/heads/developmen[!x]',
  malformed: 'refs/heads/developmen[',
};
type Overrides = {
  bypassActors?: 'empty' | 'hidden' | 'present';
  codeowners?: 'full' | 'limited' | 'missing';
  dismissStale?: boolean;
  excludeDevelopment?: Exclusion;
  explicitCodeownersRef?: boolean;
  lastPush?: boolean;
  requiredCheck?: boolean;
};

function runVerifier(
  apiUrl: string,
  explicitCodeownersRef = false,
  cwd = root,
) {
  return new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [verifier], {
      cwd,
      env: {
        ...process.env,
        GITHUB_BASE_REF: 'codeowners-bootstrap',
        GITHUB_API_URL: apiUrl,
        GITHUB_REPOSITORY: 'sacdia/backend',
        ...(explicitCodeownersRef && {
          IANA_TZDB_TRUST_CODEOWNERS_REF: 'explicit-bootstrap',
        }),
        IANA_TZDB_TRUST_POLICY_READ_TOKEN: 'read-only-fixture',
        IANA_TZDB_TRUST_PROTECTED_BRANCH: 'development',
        IANA_TZDB_TRUST_REQUIRED_STATUS: requiredStatus,
      },
    });
    child.on('exit', resolve);
  });
}

async function withPolicy(
  overrides: Overrides,
  assertion: (url: string) => Promise<void>,
): Promise<void> {
  const enabled = (value: boolean | undefined) => value !== false;
  const server = createServer((request, response) => {
    let body: unknown;
    if (request.url?.includes('/environments/')) {
      body = {
        protection_rules: [
          {
            prevent_self_review: true,
            reviewers: [{ type: 'User' }],
            type: 'required_reviewers',
          },
        ],
      };
    } else if (request.url?.includes('/branches/')) {
      body = {
        enforce_admins: { enabled: true },
        required_pull_request_reviews: {
          bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
          dismiss_stale_reviews: enabled(overrides.dismissStale),
          require_code_owner_reviews: true,
          require_last_push_approval: enabled(overrides.lastPush),
          required_approving_review_count: 1,
        },
        required_status_checks: {
          contexts: enabled(overrides.requiredCheck) ? [requiredStatus] : [],
          strict: true,
        },
      };
    } else if (request.url?.includes('/contents/')) {
      const ref = new URL(request.url, 'http://fixture').searchParams.get(
        'ref',
      );
      const expectedRef = overrides.explicitCodeownersRef
        ? 'explicit-bootstrap'
        : 'codeowners-bootstrap';
      if (ref !== expectedRef) {
        response.writeHead(404).end();
        return;
      }
      body = {
        content: Buffer.from(
          overrides.codeowners === 'limited'
            ? limitedCodeowners
            : overrides.codeowners === 'missing'
              ? 'docs/** @docs'
              : completeCodeowners,
        ).toString('base64'),
        encoding: 'base64',
      };
    } else if (request.url?.match(/\/rulesets\/1/) !== null) {
      body = {
        ...(overrides.bypassActors !== 'hidden' && {
          bypass_actors:
            overrides.bypassActors === 'present'
              ? [{ actor_type: 'Role' }]
              : [],
        }),
        conditions: {
          ref_name: {
            exclude: overrides.excludeDevelopment
              ? [exclusionPatterns[overrides.excludeDevelopment]]
              : [],
            include: ['refs/heads/development'],
          },
        },
        rules: [
          {
            parameters: {
              dismiss_stale_reviews_on_push: enabled(overrides.dismissStale),
              require_code_owner_review: true,
              require_last_push_approval: enabled(overrides.lastPush),
              required_approving_review_count: 1,
            },
            type: 'pull_request',
          },
          {
            parameters: {
              required_status_checks: enabled(overrides.requiredCheck)
                ? [{ context: requiredStatus }]
                : [],
              strict_required_status_checks_policy: true,
            },
            type: 'required_status_checks',
          },
        ],
      };
    } else {
      body = [{ enforcement: 'active', id: 1, target: 'branch' }];
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('policy fixture did not bind');
  try {
    await assertion(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('GitHub IANA trust-policy attestation', () => {
  it('runs direct Node attestation before package-controlled execution', () => {
    const workflow = readFileSync(
      join(root, '.github/workflows/ci.yml'),
      'utf8',
    );
    const lintJob = workflow.slice(
      workflow.indexOf('\n  lint:'),
      workflow.indexOf('\n  test:'),
    );
    const checkout = lintJob.indexOf('- name: Checkout code');
    const setupNode = lintJob.indexOf('- name: Setup Node.js');
    const attestation = lintJob.indexOf(
      '- name: Attest external timezone trust policy',
    );
    const setupPnpm = lintJob.indexOf('- name: Setup pnpm');
    const install = lintJob.indexOf('- name: Install dependencies');
    const lint = lintJob.indexOf('- name: Run ESLint');
    expect([
      checkout,
      setupNode,
      attestation,
      setupPnpm,
      install,
      lint,
    ]).toEqual(
      [...[checkout, setupNode, attestation, setupPnpm, install, lint]].sort(
        (left, right) => left - right,
      ),
    );
    expect(lintJob.slice(checkout, attestation)).not.toMatch(
      /\bpnpm\b|eslint|prettier/i,
    );
    expect(lintJob).toContain(
      'run: node scripts/verify-github-iana-timezone-trust-policy.ts',
    );
  });

  it('rejects an arbitrary local Prettier plugin without executing it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'be01-prettier-'));
    const marker = join(directory, 'executed');
    writeFileSync(
      join(directory, 'evil.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed');`,
    );
    writeFileSync(
      join(directory, '.prettierrc'),
      JSON.stringify({ plugins: ['./evil.mjs'] }),
    );
    try {
      await withPolicy({}, async (url) => {
        expect(await runVerifier(url, false, directory)).not.toBe(0);
        expect(existsSync(marker)).toBe(false);
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it.each([false, true])(
    'accepts policy using effective CODEOWNERS ref (explicit=%s)',
    async (explicitCodeownersRef) => {
      await withPolicy({ explicitCodeownersRef }, async (url) => {
        expect(await runVerifier(url, explicitCodeownersRef)).toBe(0);
      });
    },
  );

  it.each([
    { excludeDevelopment: 'exact' },
    { excludeDevelopment: 'wildcard' },
    { excludeDevelopment: 'single' },
    { excludeDevelopment: 'recursive' },
    { excludeDevelopment: 'class' },
    { excludeDevelopment: 'range' },
    { excludeDevelopment: 'negated' },
    { excludeDevelopment: 'malformed' },
  ] as Overrides[])('rejects development exclusion %#', async (overrides) => {
    await withPolicy(overrides, async (url) => {
      expect(await runVerifier(url)).not.toBe(0);
    });
  });

  it.each([
    { bypassActors: 'hidden' },
    { bypassActors: 'present' },
    { requiredCheck: false },
    { dismissStale: false },
    { lastPush: false },
    { codeowners: 'missing' },
    { codeowners: 'limited' },
  ] as Overrides[])('rejects fail-open payload %#', async (overrides) => {
    await withPolicy(overrides, async (url) => {
      expect(await runVerifier(url)).not.toBe(0);
    });
  });
});
