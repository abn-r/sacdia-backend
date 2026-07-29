#!/usr/bin/env node

const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const {
  GITHUB_API_URL = 'https://api.github.com',
  GITHUB_BASE_REF,
  GITHUB_REPOSITORY,
  IANA_TZDB_TRUST_CODEOWNERS_REF,
  IANA_TZDB_TRUST_POLICY_READ_TOKEN,
  IANA_TZDB_TRUST_PROTECTED_BRANCH,
  IANA_TZDB_TRUST_REQUIRED_STATUS,
} = process.env;
const environmentName = 'iana-timezone-trust';
const protectedPaths =
  `.github/CODEOWNERS .github/actions/** .github/workflows/ci.yml .github/workflows/** .githooks/** .husky/** .npmrc .pnpmfile.cjs .prettierrc* docs/runbooks/iana-timezone-trust-bootstrap.md eslint.config.* eslint.config.mjs nest-cli.json package.json patches/** pnpm-lock.yaml pnpm-workspace.yaml prettier-plugins/** prettier.config.* scripts/** src/common/timezone/** tsconfig*.json tsconfig.build.json tsconfig.json`
    .trim()
    .split(/\s+/);
const prettierConfigPattern =
  /^(?:\.prettierrc(?:\.(?:json|json5|ya?ml|toml|[cm]?[jt]s))?|prettier\.config\.[cm]?[jt]s)$/;
const jsonPrettierConfigs = new Set(['.prettierrc', '.prettierrc.json']);

function assertPrettierPlugins(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  if (Array.isArray(config)) {
    config.forEach(assertPrettierPlugins);
    return;
  }
  for (const [key, value] of Object.entries(config)) {
    if (key !== 'plugins') {
      assertPrettierPlugins(value);
      continue;
    }
    if (!Array.isArray(value))
      throw new Error('Prettier plugins must be a static array');
    for (const plugin of value) {
      if (typeof plugin !== 'string')
        throw new Error('Prettier plugins must use package names');
      const normalized = plugin.replaceAll('\\', '/');
      const local =
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('./') ||
        normalized.startsWith('../') ||
        normalized.startsWith('/') ||
        normalized.startsWith('~/') ||
        normalized.startsWith('file:') ||
        /^[A-Za-z]:\//.test(normalized);
      if (
        local &&
        (!normalized.startsWith('./prettier-plugins/') ||
          normalized.includes('/../') ||
          normalized.endsWith('/..'))
      )
        throw new Error('local Prettier plugin is outside prettier-plugins');
    }
  }
}

function assertPrettierConfigTrust(): void {
  const root = process.cwd();
  const packagePath = join(root, 'package.json');
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
    assertPrettierPlugins(packageJson.prettier);
  }
  for (const name of readdirSync(root).filter((value) =>
    prettierConfigPattern.test(value),
  )) {
    if (!jsonPrettierConfigs.has(name))
      throw new Error('executable Prettier configuration is forbidden');
    let config: unknown;
    try {
      config = JSON.parse(readFileSync(join(root, name), 'utf8'));
    } catch {
      throw new Error('Prettier configuration must be strict JSON');
    }
    assertPrettierPlugins(config);
  }
}

assertPrettierConfigTrust();

if (
  !GITHUB_REPOSITORY ||
  !IANA_TZDB_TRUST_POLICY_READ_TOKEN ||
  !IANA_TZDB_TRUST_PROTECTED_BRANCH ||
  !IANA_TZDB_TRUST_REQUIRED_STATUS
) {
  throw new Error('external timezone trust-policy attestation is unavailable');
}
const repository = GITHUB_REPOSITORY;
const token = IANA_TZDB_TRUST_POLICY_READ_TOKEN;
const protectedBranch = IANA_TZDB_TRUST_PROTECTED_BRANCH;
const requiredStatus = IANA_TZDB_TRUST_REQUIRED_STATUS;
const codeownersRef =
  IANA_TZDB_TRUST_CODEOWNERS_REF || GITHUB_BASE_REF || protectedBranch;

async function api(path) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`GitHub policy API returned ${response.status}`);
  return response.json();
}

const emptyArray = (value) => Array.isArray(value) && value.length === 0;
const requiredContexts = (policy) => [
  ...(Array.isArray(policy?.contexts) ? policy.contexts : []),
  ...(Array.isArray(policy?.checks)
    ? policy.checks.map((check) => check.context)
    : []),
];
const requiresStatus = (policy, strictKey = 'strict') =>
  policy?.[strictKey] === true &&
  requiredContexts(policy).includes(requiredStatus);
const ruleRequiresStatus = (rule) =>
  rule?.type === 'required_status_checks' &&
  rule.parameters?.strict_required_status_checks_policy === true &&
  Array.isArray(rule.parameters?.required_status_checks) &&
  rule.parameters.required_status_checks.some(
    (check) => check.context === requiredStatus,
  );

type PatternMatch = boolean | undefined;
type ClassToken = { escaped: boolean; value: string };

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function characterClass(
  pattern: string,
  start: number,
): { next: number; source: string } | undefined {
  let index = start + 1;
  let negated = false;
  if (pattern[index] === '!' || pattern[index] === '^') {
    negated = true;
    index += 1;
  }
  const tokens: ClassToken[] = [];
  while (index < pattern.length && pattern[index] !== ']') {
    if (pattern[index] === '\\') {
      index += 1;
      if (index === pattern.length) return undefined;
      tokens.push({ escaped: true, value: pattern[index] });
    } else {
      tokens.push({ escaped: false, value: pattern[index] });
    }
    index += 1;
  }
  if (
    pattern[index] !== ']' ||
    tokens.length === 0 ||
    tokens.some(
      ({ escaped, value }) => value === '/' || (!escaped && value === '['),
    )
  )
    return undefined;

  const source = tokens
    .map(({ escaped, value }, tokenIndex) => {
      if (value === '-' && !escaped) {
        if (tokenIndex === 0 || tokenIndex === tokens.length - 1) return '\\-';
        const left = tokens[tokenIndex - 1].value.codePointAt(0);
        const right = tokens[tokenIndex + 1].value.codePointAt(0);
        if (
          tokens[tokenIndex - 1].value === '-' ||
          tokens[tokenIndex + 1].value === '-' ||
          left === undefined ||
          right === undefined ||
          left > right
        )
          throw new Error('invalid range');
        return '-';
      }
      return value.replace(/[\\\]^]/g, '\\$&');
    })
    .join('');
  return {
    next: index + 1,
    source: negated ? `(?!/)[^${source}]` : `[${source}]`,
  };
}

function rulesetPatternMatches(pattern: unknown, ref: string): PatternMatch {
  if (pattern === '~ALL') return true;
  if (typeof pattern !== 'string' || !pattern || pattern.startsWith('~'))
    return undefined;
  let glob = '';
  try {
    for (let index = 0; index < pattern.length; ) {
      const value = pattern[index];
      if (value === '\\') {
        index += 1;
        if (index === pattern.length) return undefined;
        glob += escapeRegex(pattern[index]);
        index += 1;
      } else if (value === '*') {
        let count = 1;
        while (pattern[index + count] === '*') count += 1;
        if (count > 2) return undefined;
        glob += count === 2 ? '.*' : '[^/]*';
        index += count;
      } else if (value === '?') {
        glob += '[^/]';
        index += 1;
      } else if (value === '[') {
        const parsed = characterClass(pattern, index);
        if (!parsed) return undefined;
        glob += parsed.source;
        index = parsed.next;
      } else {
        if (value === '\0') return undefined;
        glob += escapeRegex(value);
        index += 1;
      }
    }
    return new RegExp(`^${glob}$`).test(ref);
  } catch {
    return undefined;
  }
}

function codeownersCovers(payload): boolean {
  if (payload?.encoding !== 'base64' || typeof payload.content !== 'string')
    return false;
  const entries = Buffer.from(payload.content, 'base64')
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s+#.*$/, '')
        .trim()
        .split(/\s+/),
    )
    .filter(
      ([pattern, ...owners]) =>
        pattern && !pattern.startsWith('#') && owners.some((v) => /^@/.test(v)),
    );
  return protectedPaths.every((path) =>
    entries.some(([rawPattern]) => {
      const pattern = rawPattern.replace(/^\//, '');
      if (pattern === '*' || pattern === '**' || pattern === '**/*')
        return true;
      if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3));
      if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
      return path === pattern;
    }),
  );
}

async function main(): Promise<void> {
  const encodedEnvironment = encodeURIComponent(environmentName);
  const encodedBranch = encodeURIComponent(protectedBranch);
  const encodedCodeownersRef = encodeURIComponent(codeownersRef);
  const [environment, branchProtection, ruleSummaries, codeowners] =
    await Promise.all([
      api(`/repos/${repository}/environments/${encodedEnvironment}`),
      api(`/repos/${repository}/branches/${encodedBranch}/protection`),
      api(`/repos/${repository}/rulesets?includes_parents=true`),
      api(
        `/repos/${repository}/contents/${encodeURIComponent('.github/CODEOWNERS')}?ref=${encodedCodeownersRef}`,
      ),
    ]);
  const reviewerRule = environment.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  );
  const reviewPolicy = branchProtection.required_pull_request_reviews;

  if (
    !reviewerRule ||
    reviewerRule.prevent_self_review !== true ||
    !Array.isArray(reviewerRule.reviewers) ||
    reviewerRule.reviewers.length === 0 ||
    branchProtection.enforce_admins?.enabled !== true ||
    reviewPolicy?.required_approving_review_count < 1 ||
    reviewPolicy?.require_code_owner_reviews !== true ||
    reviewPolicy?.dismiss_stale_reviews !== true ||
    reviewPolicy?.require_last_push_approval !== true ||
    !emptyArray(reviewPolicy?.bypass_pull_request_allowances?.apps) ||
    !emptyArray(reviewPolicy?.bypass_pull_request_allowances?.teams) ||
    !emptyArray(reviewPolicy?.bypass_pull_request_allowances?.users) ||
    !requiresStatus(branchProtection.required_status_checks) ||
    !codeownersCovers(codeowners)
  ) {
    throw new Error(
      'external timezone trust policy does not satisfy review controls',
    );
  }

  const activeRuleSummaries = ruleSummaries.filter(
    (ruleset) =>
      ruleset.target === 'branch' && ruleset.enforcement === 'active',
  );
  const activeRulesets = await Promise.all(
    activeRuleSummaries.map((ruleset) =>
      api(`/repos/${repository}/rulesets/${ruleset.id}?includes_parents=true`),
    ),
  );
  const protectedRef = `refs/heads/${protectedBranch}`;
  const attestedRuleset = activeRulesets.some((ruleset) => {
    const includes = ruleset.conditions?.ref_name?.include ?? [];
    const excludes = ruleset.conditions?.ref_name?.exclude;
    const includeMatches = Array.isArray(includes)
      ? includes.map((pattern) => rulesetPatternMatches(pattern, protectedRef))
      : [];
    const excludeMatches = Array.isArray(excludes)
      ? excludes.map((pattern) => rulesetPatternMatches(pattern, protectedRef))
      : [];
    const pullRequest = ruleset.rules?.find(
      (rule) => rule.type === 'pull_request',
    );
    return (
      emptyArray(ruleset.bypass_actors) &&
      Array.isArray(includes) &&
      Array.isArray(excludes) &&
      !includeMatches.includes(undefined) &&
      !excludeMatches.includes(undefined) &&
      includeMatches.includes(true) &&
      !excludeMatches.includes(true) &&
      pullRequest?.parameters?.required_approving_review_count >= 1 &&
      pullRequest?.parameters?.require_code_owner_review === true &&
      pullRequest?.parameters?.dismiss_stale_reviews_on_push === true &&
      pullRequest?.parameters?.require_last_push_approval === true &&
      ruleset.rules.some(ruleRequiresStatus)
    );
  });

  if (!attestedRuleset) {
    throw new Error(
      'no active non-bypassable external ruleset protects the branch',
    );
  }

  process.stdout.write(
    `attested ${repository}/${environmentName} on ${protectedRef}\n`,
  );
}

void main();
