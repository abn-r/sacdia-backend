const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BLOCK_SEVERITIES = new Set(['high', 'critical']);
const ALLOWLIST_PATH = path.join(__dirname, 'audit-security.allowlist.json');

function todayUtcDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function collectBlockingAdvisories(auditJson) {
  const raw = auditJson?.advisories;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.filter((advisory) =>
    BLOCK_SEVERITIES.has(String(advisory.severity ?? '').toLowerCase()),
  );
}

function evaluateAudit({ advisories, accepted, today }) {
  const acceptedById = new Map(
    (accepted ?? []).map((entry) => [
      String(entry.github_advisory_id ?? '').toUpperCase(),
      entry,
    ]),
  );
  acceptedById.delete('');

  const blocking = [];
  const expired = [];
  const acceptedHits = [];
  const seen = new Set();

  for (const advisory of advisories) {
    const id = String(advisory.github_advisory_id ?? '').toUpperCase();
    const entry = acceptedById.get(id);
    if (!entry) {
      blocking.push(advisory);
      continue;
    }

    seen.add(id);
    if (entry.review_by && String(entry.review_by) < today) {
      expired.push({ advisory, entry });
    } else {
      acceptedHits.push({ advisory, entry });
    }
  }

  const stale = (accepted ?? []).filter(
    (entry) =>
      !seen.has(String(entry.github_advisory_id ?? '').toUpperCase()),
  );

  return {
    ok: blocking.length === 0 && expired.length === 0,
    blocking,
    expired,
    acceptedHits,
    stale,
  };
}

function loadAllowlist() {
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function runPnpmAudit() {
  const result = spawnSync('pnpm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout?.trim() ?? '';
  if (!stdout) {
    throw new Error(
      `pnpm audit produced no JSON (exit ${result.status}): ${result.stderr}`,
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `pnpm audit JSON parse failed (exit ${result.status}): ${error.message}`,
    );
  }
}

function formatAdvisory(advisory) {
  const id = advisory.github_advisory_id ?? advisory.id ?? 'unknown';
  const moduleName = advisory.module_name ?? 'unknown';
  const severity = advisory.severity ?? 'unknown';
  const title = advisory.title ?? '';
  return `${id} ${severity} ${moduleName} — ${title}`;
}

function main() {
  const allowlist = loadAllowlist();
  const auditJson = runPnpmAudit();
  const verdict = evaluateAudit({
    advisories: collectBlockingAdvisories(auditJson),
    accepted: allowlist.accepted,
    today: todayUtcDate(),
  });

  for (const hit of verdict.acceptedHits) {
    console.log(
      `accepted ${formatAdvisory(hit.advisory)} (review_by ${hit.entry.review_by})`,
    );
  }

  for (const entry of verdict.stale) {
    console.warn(
      `stale allowlist entry ${entry.github_advisory_id} — no longer reported; remove it`,
    );
  }

  for (const item of verdict.expired) {
    console.error(
      `expired allowlist ${formatAdvisory(item.advisory)} (review_by ${item.entry.review_by})`,
    );
  }

  for (const advisory of verdict.blocking) {
    console.error(`blocked ${formatAdvisory(advisory)}`);
  }

  if (!verdict.ok) {
    console.error(
      'Dependency audit failed. Triage the blocked/expired advisory; do not bulk-upgrade.',
    );
    process.exit(1);
  }

  console.log('Dependency audit passed (high/critical, allowlist-aware).');
}

if (require.main === module) {
  main();
}

module.exports = {
  collectBlockingAdvisories,
  evaluateAudit,
  todayUtcDate,
};
