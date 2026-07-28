#!/usr/bin/env node

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
  `.github/CODEOWNERS .github/workflows/ci.yml docs/runbooks/iana-timezone-trust-bootstrap.md nest-cli.json package.json scripts/generate-geographic-iana-timezone-sources.ts scripts/verify-github-iana-timezone-trust-policy.ts scripts/verify-iana-timezone-release.sh src/common/timezone/canonical-geographic-iana-timezone-hardening.spec.ts src/common/timezone/canonical-geographic-iana-timezone-packaging.spec.ts src/common/timezone/canonical-geographic-iana-timezone.spec.ts src/common/timezone/canonical-geographic-iana-timezone.ts src/common/timezone/generate-geographic-iana-timezone-sources-process.spec.ts src/common/timezone/generate-geographic-iana-timezone-sources.spec.ts src/common/timezone/iana-tzdb-2026b/README.md src/common/timezone/iana-tzdb-2026b/tzdata.zi.gz src/common/timezone/iana-tzdb-2026b/zone.tab.gz src/common/timezone/verify-github-iana-timezone-trust-policy.spec.ts src/common/timezone/verify-iana-timezone-real-gpg.spec.ts src/common/timezone/verify-iana-timezone-release.spec.ts`
    .trim()
    .split(/\s+/);

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

function rulesetPatternMatches(pattern, ref): boolean {
  if (pattern === '~ALL') return true;
  if (typeof pattern !== 'string' || !pattern) return false;
  const glob = pattern
    .replace(/[\\^$.[\]{}()+|]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${glob}$`).test(ref);
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
    const pullRequest = ruleset.rules?.find(
      (rule) => rule.type === 'pull_request',
    );
    return (
      emptyArray(ruleset.bypass_actors) &&
      Array.isArray(includes) &&
      Array.isArray(excludes) &&
      includes.some((pattern) =>
        rulesetPatternMatches(pattern, protectedRef),
      ) &&
      !excludes.some((pattern) =>
        rulesetPatternMatches(pattern, protectedRef),
      ) &&
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
