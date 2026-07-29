# IANA timezone trust bootstrap

`.github/CODEOWNERS` is the root of the timezone release trust boundary. It
cannot attest its own introduction.

Before enabling the blocking trust-policy gate:

1. An existing repository maintainer must manually review the bootstrap change.
2. Merge the bootstrap into the real base branch of the trust-policy PR.
3. Enable branch protection, the non-bypassable ruleset, required status and
   independent environment reviewer only after the base ref exposes CODEOWNERS.
4. Run the trust-policy gate against that effective base ref. For stacked PRs,
   this is `GITHUB_BASE_REF`; automation may set
   `IANA_TZDB_TRUST_CODEOWNERS_REF` explicitly.

Never point the attestation at the unmerged head under review. Remote GitHub
configuration and reviewer independence still require manual verification; the
repository files do not prove those external controls.

## Mandatory ancestry and scope gate

Fetch first, then validate the complete stacked-PR range. `git show
<bootstrap>` is NOT evidence of bootstrap scope because it hides ancestors.

```bash
set -eu
git fetch origin development

bootstrap=codex/p0-authz-be-01a0-codeowners-bootstrap
catalog=codex/p0-authz-be-01a-timezone-catalog
base=$(git rev-parse origin/development)
bootstrap_head=$(git rev-parse "$bootstrap")

test "$(git rev-parse "$bootstrap_head^")" = "$base"
test "$(git rev-parse "$catalog^")" = "$bootstrap_head"

expected=$(printf '%s\n' \
  .github/CODEOWNERS \
  docs/runbooks/iana-timezone-trust-bootstrap.md | LC_ALL=C sort)
actual=$(git diff --name-only "origin/development...$bootstrap" | LC_ALL=C sort)
test "$actual" = "$expected"
```

The release operator MUST also validate every stacked branch in order. For each
branch, its commit parent must equal the previous branch head and its review
delta (`added + deleted`) must not exceed 400:

```bash
previous=$(git rev-parse origin/development)
while IFS= read -r branch; do
  head=$(git rev-parse "$branch")
  test "$(git rev-parse "$head^")" = "$previous"
  delta=$(git diff --numstat "$head^" "$head" |
    awk '{ total += $1 + $2 } END { print total + 0 }')
  test "$delta" -le 400
  previous=$head
done <<'BRANCHES'
codex/p0-authz-be-01a0-codeowners-bootstrap
codex/p0-authz-be-01a-timezone-catalog
codex/p0-authz-be-01a1-trust-hardening
codex/p0-authz-be-01a1-fnmatch-boundary-hardening
codex/p0-authz-be-01a1-trust-attestation-tests
codex/p0-authz-be-01a1-real-openpgp
codex/p0-authz-be-01a1-crash-recovery
codex/p0-authz-be-01a1-crash-recovery-tests
codex/p0-authz-be-01a2-timezone-runtime
codex/p0-authz-be-01a2-runtime-hardening
codex/p0-authz-be-01a3-timezone-packaging
codex/p0-authz-be-01b-preflight-sql
codex/p0-authz-be-01b-preflight-hardening
codex/p0-authz-be-01b-preflight-loader
codex/p0-authz-be-01b-executor-hardening
codex/p0-authz-be-01c-preflight-cli
codex/p0-authz-be-01c-runtime-hardening
codex/p0-authz-be-01c-public-signal-tests
codex/p0-authz-be-01c-runbook-inventory
codex/p0-authz-be-01d-crossrepo-contract
BRANCHES
```
