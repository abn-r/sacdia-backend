# IANA timezone trust bootstrap

`.github/CODEOWNERS` is the root of the timezone release trust boundary. It
cannot attest its own introduction.

## Provisional owner-only protection attestation

**Attested on 2026-07-29 against `development` at
`08400ec6ff6444e621366da8c63a10a937e70a32`.**

**T00 classification:** owner-only branch protection is applied. Independent
human approval remains pending and is accepted as an explicit provisional
exception; T00 must not be represented as independently enforced.

### Effective configuration

| Control                        | Effective value                                    |
| ------------------------------ | -------------------------------------------------- |
| Changes to `development`       | Pull request required                              |
| Required approvals             | `0`                                                |
| Dismiss stale reviews          | Enabled                                            |
| Code-owner review              | Disabled                                           |
| Last-push approval             | Disabled                                           |
| Required checks                | Strict; `Lint & Type Check`, `Unit Tests`, `Build` |
| Required-check application     | GitHub Actions, app ID `15368`                     |
| Administrator enforcement      | Enabled                                            |
| Conversation resolution        | Required                                           |
| Force pushes / branch deletion | Disabled / disabled                                |
| Repository rulesets            | `0`                                                |
| Environments                   | `0`                                                |

The only direct collaborator with write or administrative access is `abn-r`,
and the effective CODEOWNERS entries name only `@abn-r`. This configuration
requires a pull request, a current green CI result, resolved conversations, and
preserves history against force pushes or deletion, including for repository
administrators.

It does **not** provide independent human approval. Another account or address
controlled by the same owner, including `sacdia.app@gmail.com`, must not be
presented as an independent reviewer or used to simulate separation of duties.

The canonical SHA-256 fingerprint of the complete normalized protection policy
below is:

```text
ad4079f9a4d9e0a5d4ad7ba8b54c0136a0314fbd9dc9e98031abe9caf07786d2
```

### Independent-control upgrade

Trigger this upgrade only after a second human maintainer has accepted
repository access with write permission:

1. Verify that the maintainer is controlled by a different human.
2. Add that maintainer as co-owner of every timezone trust-boundary CODEOWNERS
   entry and merge that change under the current protection.
3. Before any control mutation, merge a separate PR that replaces this
   owner-only verifier with a reviewed, explicit independent-control expectation.
   It must name the second human, require at least one approval plus code-owner
   and last-push review, and fingerprint the active no-bypass ruleset and exact
   environment reviewers with self-review prevented.
4. Apply only that reviewed expectation, re-run its GET verification, require
   PASS, then exercise the controls with a pull request authored by one
   maintainer and approved by the other.

The verifier below intentionally accepts only the current owner-only profile.
Any upgrade-shaped change fails as drift; never accept the live value as a new
default or weaken this expectation in the same mutation that changes controls.

### GET verification and drift fingerprint

Extract this block into the approved durable change record and run it with
`--check`. Its temporary working directory is only execution scratch space and
is not attestation evidence. Keep the reviewed script, normalized policy,
fingerprint, date, and operator identity in the durable record.

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly REPO='abn-r/sacdia-backend'
readonly BRANCH='development'
readonly API_VERSION='2022-11-28'
readonly PROTECTION_ENDPOINT="repos/${REPO}/branches/${BRANCH}/protection"
readonly BRANCH_ENDPOINT="repos/${REPO}/branches/${BRANCH}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

api() {
  gh api -H 'Accept: application/vnd.github+json' \
    -H "X-GitHub-Api-Version: ${API_VERSION}" "$@"
}

[[ $# -eq 1 && ( "$1" == '--check' || "$1" == '--delete' ) ]] ||
  die "usage: $0 --check|--delete"
readonly MODE=$1

for command_name in gh jq shasum cmp diff; do
  command -v "$command_name" >/dev/null 2>&1 ||
    die "required command not found: ${command_name}"
done

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/sacdia-owner-only-guard.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT

cat >"$work_dir/expected-policy.json" <<'JSON'
{"required_status_checks":{"strict":true,
"contexts":["Build","Lint & Type Check","Unit Tests"],
"checks":[{"context":"Build","app_id":15368},{"context":"Lint & Type Check","app_id":15368},{"context":"Unit Tests","app_id":15368}]},
"required_pull_request_reviews":{"dismiss_stale_reviews":true,
"require_code_owner_reviews":false,"require_last_push_approval":false,
"required_approving_review_count":0,"dismissal_restrictions":{"users":[],"teams":[],"apps":[]},"bypass_pull_request_allowances":{"users":[],"teams":[],"apps":[]}},
"required_signatures":false,"enforce_admins":true,"restrictions":null,
"required_linear_history":false,"allow_force_pushes":false,
"allow_deletions":false,"block_creations":false,
"required_conversation_resolution":true,"lock_branch":false,"allow_fork_syncing":false}
JSON
jq -cS . "$work_dir/expected-policy.json" \
  >"$work_dir/expected-policy.normalized.json"
readonly EXPECTED_FINGERPRINT=$(
  shasum -a 256 "$work_dir/expected-policy.normalized.json" | awk '{print $1}'
)

printf '%s\n' '[{"login":"abn-r","role_name":"admin","permissions":{
  "admin":true,"maintain":true,"push":true,"triage":true,"pull":true}}]' \
  >"$work_dir/expected-collaborators.json"
jq -cS . "$work_dir/expected-collaborators.json" \
  >"$work_dir/expected-collaborators.normalized.json"

validate_policy_keys() {
  local source_file=$1

  jq -e '
    def object_only($value; $allowed):
      ($value == null) or ((($value | type) == "object") and
      (((($value | keys_unsorted) - $allowed) | length) == 0));
    ((keys_unsorted - ["url","required_status_checks",
      "required_pull_request_reviews","required_signatures","enforce_admins",
      "restrictions","required_linear_history","allow_force_pushes",
      "allow_deletions","block_creations","required_conversation_resolution",
      "lock_branch","allow_fork_syncing"]) | length) == 0 and
    object_only(.required_status_checks;
      ["url","strict","contexts","contexts_url","checks"]) and
    all((.required_status_checks.checks // [])[];
      object_only(.; ["context","app_id"])) and
    object_only(.required_pull_request_reviews; [
      "url","dismiss_stale_reviews","require_code_owner_reviews",
      "require_last_push_approval","required_approving_review_count",
      "dismissal_restrictions","bypass_pull_request_allowances"
    ]) and
    object_only(.required_pull_request_reviews.dismissal_restrictions;
      ["url","users_url","teams_url","apps_url","users","teams","apps"]) and
    object_only(.required_pull_request_reviews.bypass_pull_request_allowances;
      ["users","teams","apps"]) and
    object_only(.required_signatures; ["url", "enabled"]) and
    object_only(.enforce_admins; ["url", "enabled"]) and
    object_only(.restrictions;
      ["url","users_url","teams_url","apps_url","users","teams","apps"]) and
    object_only(.required_linear_history; ["enabled"]) and
    object_only(.allow_force_pushes; ["enabled"]) and
    object_only(.allow_deletions; ["enabled"]) and
    object_only(.block_creations; ["enabled"]) and
    object_only(.required_conversation_resolution; ["enabled"]) and
    object_only(.lock_branch; ["enabled"]) and
    object_only(.allow_fork_syncing; ["enabled"])
  ' "$source_file" >/dev/null
}

normalize_policy() {
  local source_file=$1

  validate_policy_keys "$source_file" || return 1
  jq -cS '
    def users($value):
      [($value // [])[] | if type == "string" then . else .login end] | sort;
    def slugs($value):
      [($value // [])[] | if type == "string" then . else .slug end] | sort;
    .required_pull_request_reviews as $reviews |
    {
      required_status_checks: (
        if .required_status_checks == null then null
        else {
          strict: .required_status_checks.strict,
          contexts: ((.required_status_checks.contexts // []) | sort),
          checks: ([.required_status_checks.checks[]? | {context, app_id}] |
            sort_by(.context, .app_id))
        } end
      ),
      required_pull_request_reviews: (
        if $reviews == null then null
        else {
          dismiss_stale_reviews: $reviews.dismiss_stale_reviews,
          require_code_owner_reviews: $reviews.require_code_owner_reviews,
          require_last_push_approval: $reviews.require_last_push_approval,
          required_approving_review_count: $reviews.required_approving_review_count,
          dismissal_restrictions: {
            users: users($reviews.dismissal_restrictions.users),
            teams: slugs($reviews.dismissal_restrictions.teams),
            apps: slugs($reviews.dismissal_restrictions.apps)
          },
          bypass_pull_request_allowances: {
            users: users($reviews.bypass_pull_request_allowances.users),
            teams: slugs($reviews.bypass_pull_request_allowances.teams),
            apps: slugs($reviews.bypass_pull_request_allowances.apps)
          }
        } end
      ),
      required_signatures: (.required_signatures.enabled // false),
      enforce_admins: (.enforce_admins.enabled // false),
      restrictions: (
        if .restrictions == null then null
        else {users: users(.restrictions.users),
          teams: slugs(.restrictions.teams), apps: slugs(.restrictions.apps)}
        end
      ),
      required_linear_history: (.required_linear_history.enabled // false),
      allow_force_pushes: (.allow_force_pushes.enabled // false),
      allow_deletions: (.allow_deletions.enabled // false),
      block_creations: (.block_creations.enabled // false),
      required_conversation_resolution:
        (.required_conversation_resolution.enabled // false),
      lock_branch: (.lock_branch.enabled // false),
      allow_fork_syncing: (.allow_fork_syncing.enabled // false)
    }
  ' "$source_file"
}

VERIFIED_SHA=''
VERIFIED_FINGERPRINT=''

verify_collaborators() {
  local label=$1 collaborators invitations
  collaborators="$work_dir/${label}-collaborators.json"
  invitations="$work_dir/${label}-invitations.json"

  api --paginate --slurp "repos/$REPO/collaborators?affiliation=direct&per_page=100" \
    >"$collaborators"
  jq -e 'all(add[];
    (((.permissions|keys_unsorted)-["admin","maintain","push","triage","pull"])
    | length)==0)' "$collaborators" >/dev/null ||
    die 'unknown collaborator permission'
  jq -cS '[add[] | select(.permissions.push or .permissions.admin) | {
    login,role_name,permissions:(.permissions |
    {admin,maintain,push,triage,pull})}] | sort_by(.login)' "$collaborators" \
    >"$work_dir/${label}-collaborators.normalized.json"
  cmp -s "$work_dir/expected-collaborators.normalized.json" \
    "$work_dir/${label}-collaborators.normalized.json" ||
    die 'write/admin collaborator drift detected'

  api --paginate --slurp "repos/$REPO/invitations?per_page=100" \
    >"$invitations"
  jq -e '[add[] | select(.permissions |
    IN("admin","maintain","push","write"))] | length==0' "$invitations" >/dev/null ||
    die 'pending elevated invitation detected'
}

verify_owner_controls() {
  local label=$1 rulesets
  rulesets="$work_dir/${label}-rulesets.json"

  api "repos/$REPO/rulesets?includes_parents=true" >"$rulesets"
  [[ $(jq 'length' "$rulesets") == 0 ]] || die 'owner-only ruleset drift'
  [[ $(api "repos/$REPO/environments" --jq '.total_count') == 0 ]] ||
    die 'owner-only environment drift'
}

fetch_and_verify() {
  local label=$1
  local branch_file="$work_dir/${label}-branch.json"
  local protection_file="$work_dir/${label}-protection.json"
  local normalized_file="$work_dir/${label}-policy.normalized.json"
  local actual_fingerprint

  api "$BRANCH_ENDPOINT" >"$branch_file"
  api "$PROTECTION_ENDPOINT" >"$protection_file"

  VERIFIED_SHA=$(jq -er '.commit.sha | select(test("^[0-9a-f]{40}$"))' \
    "$branch_file")
  [[ $(jq -er '.protected' "$branch_file") == 'true' ]] ||
    die "${REPO}/${BRANCH} is not protected"

  normalize_policy "$protection_file" >"$normalized_file" ||
    die 'unknown branch protection field detected'
  actual_fingerprint=$(
    shasum -a 256 "$normalized_file" | awk '{print $1}'
  )
  if ! cmp -s \
    "$work_dir/expected-policy.normalized.json" \
    "$normalized_file"; then
    diff -u \
      "$work_dir/expected-policy.normalized.json" \
      "$normalized_file" >&2 || true
    die "policy drift detected: ${actual_fingerprint}"
  fi
  verify_collaborators "$label"
  verify_owner_controls "$label"
  VERIFIED_FINGERPRINT=$actual_fingerprint
}

fetch_and_verify 'initial'
printf 'Verified SHA: %s\n' "$VERIFIED_SHA"
printf 'Policy fingerprint: %s\n' "$VERIFIED_FINGERPRINT"

if [[ "$MODE" == '--check' ]]; then
  printf 'CHECK ONLY: no mutation performed.\n'
  exit 0
fi

readonly CONFIRMED_SHA=$VERIFIED_SHA
readonly CONFIRMED_FINGERPRINT=$VERIFIED_FINGERPRINT
readonly CONFIRMATION="DELETE ${REPO} ${BRANCH} ${CONFIRMED_SHA} ${CONFIRMED_FINGERPRINT}"
printf 'Type exactly to restore the original unprotected baseline:\n%s\n> ' \
  "$CONFIRMATION"
IFS= read -r answer
[[ "$answer" == "$CONFIRMATION" ]] ||
  die 'confirmation mismatch; no mutation performed'

# Close the confirmation-to-mutation race with fresh GET requests.
fetch_and_verify 'pre-delete'
[[ "$VERIFIED_SHA" == "$CONFIRMED_SHA" ]] ||
  die "branch SHA drifted to ${VERIFIED_SHA}"
[[ "$VERIFIED_FINGERPRINT" == "$CONFIRMED_FINGERPRINT" ]] ||
  die "policy drifted to ${VERIFIED_FINGERPRINT}"

api --method DELETE "$PROTECTION_ENDPOINT"

if api "$PROTECTION_ENDPOINT" \
  >"$work_dir/post-delete-protection.json" \
  2>"$work_dir/post-delete-protection.stderr"; then
  die 'DELETE returned but branch protection still exists'
fi
grep -q 'HTTP 404' "$work_dir/post-delete-protection.stderr" ||
  die 'post-DELETE GET did not return HTTP 404'
printf 'Rollback verified: protection GET returned HTTP 404.\n'
```

Directed adversarial tests are mandatory. Bypass/fork-sync/unknown-policy drift,
an unexpected writer, changed owner permissions, an elevated pending invitation,
or any ruleset/environment addition must fail before mutation.

### Safe rollback after a future upgrade

The original baseline protection GET was HTTP `404`, so rollback uses the
`--delete` path above only after fresh SHA and full-policy verification,
literal confirmation bound to repository, branch, SHA, and fingerprint, and a
second fresh verification immediately before mutation. The post-delete GET
must return HTTP `404`.

Do not invent a PUT payload for this baseline. A future non-404 baseline needs a
separately reviewed rollback that validates the restore file's fixed checksum
and complete normalized semantics **before** PUT, repeats the live SHA and
fingerprint after confirmation, and requires the post-PUT GET to match exactly.
Ruleset and environment changes also require separate approved rollback records
and GET fingerprints.

Before enabling the blocking trust-policy gate:

1. An existing repository maintainer must manually review the bootstrap change.
2. Merge the bootstrap into the real base branch of the trust-policy PR.
3. Upgrade provisional branch protection, then enable the non-bypassable
   ruleset and independent environment reviewer only after the base ref exposes
   CODEOWNERS.
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
