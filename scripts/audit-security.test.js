const assert = require('node:assert/strict');
const test = require('node:test');
const {
  collectBlockingAdvisories,
  evaluateAudit,
} = require('./audit-security');

const HIGH = {
  github_advisory_id: 'GHSA-ggr8-5vv4-36mx',
  module_name: 'deepmerge-ts',
  severity: 'high',
  title: 'stack exhaustion',
};

const OTHER_HIGH = {
  github_advisory_id: 'GHSA-aaaa-bbbb-cccc',
  module_name: 'left-pad',
  severity: 'high',
  title: 'example',
};

const LOW = {
  github_advisory_id: 'GHSA-llll-oooo-wwww',
  module_name: 'qs',
  severity: 'low',
  title: 'noise',
};

test('collects only high and critical advisories', () => {
  const found = collectBlockingAdvisories({
    advisories: {
      1: HIGH,
      2: LOW,
      3: { ...OTHER_HIGH, severity: 'critical' },
    },
  });

  assert.equal(found.length, 2);
  assert.equal(found[0].github_advisory_id, HIGH.github_advisory_id);
  assert.equal(found[1].severity, 'critical');
});

test('accepts an allowlisted high advisory before review_by', () => {
  const verdict = evaluateAudit({
    advisories: [HIGH],
    accepted: [
      {
        github_advisory_id: 'GHSA-ggr8-5vv4-36mx',
        review_by: '2026-11-23',
      },
    ],
    today: '2026-08-23',
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.acceptedHits.length, 1);
  assert.equal(verdict.blocking.length, 0);
});

test('blocks a high advisory that is not allowlisted', () => {
  const verdict = evaluateAudit({
    advisories: [OTHER_HIGH],
    accepted: [
      {
        github_advisory_id: 'GHSA-ggr8-5vv4-36mx',
        review_by: '2026-11-23',
      },
    ],
    today: '2026-08-23',
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocking[0].github_advisory_id, OTHER_HIGH.github_advisory_id);
});

test('fails when an allowlisted advisory is past review_by', () => {
  const verdict = evaluateAudit({
    advisories: [HIGH],
    accepted: [
      {
        github_advisory_id: 'GHSA-ggr8-5vv4-36mx',
        review_by: '2026-08-01',
      },
    ],
    today: '2026-08-23',
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.expired.length, 1);
});

test('warns when an allowlist entry is no longer reported', () => {
  const verdict = evaluateAudit({
    advisories: [],
    accepted: [
      {
        github_advisory_id: 'GHSA-ggr8-5vv4-36mx',
        review_by: '2026-11-23',
      },
    ],
    today: '2026-08-23',
  });

  assert.equal(verdict.ok, true);
  assert.equal(verdict.stale.length, 1);
});
