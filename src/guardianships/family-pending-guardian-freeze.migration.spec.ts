import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '../../prisma/migrations');
const NAME = '20261114120000_family_pending_guardian_freeze';
const sql = readFileSync(join(MIGRATIONS, NAME, 'migration.sql'), 'utf8');
const schema = readFileSync(
  join(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

const stripComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

describe('migration 20261114120000 (teens frozen as pending_guardian, never auto-deleted)', () => {
  const body = stripComments(sql);

  it('widens frozen_reason_ck to the new reason via DROP IF EXISTS + ADD (re-runnable)', () => {
    expect(body).toMatch(
      /DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_reason_ck;\s+ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_reason_ck/,
    );
    expect(body).toMatch(
      /frozen_reason IN \('majority_release', 'pending_guardian'\)/,
    );
  });

  it('rewrites frozen_ck: reasoned freezes carry no purge_after, legacy ones still need it', () => {
    expect(body).toMatch(
      /DROP CONSTRAINT IF EXISTS dependent_profiles_frozen_ck;\s+ALTER TABLE dependent_profiles ADD CONSTRAINT dependent_profiles_frozen_ck/,
    );
    // Not frozen.
    expect(body).toMatch(/\(frozen_at IS NULL AND purge_after IS NULL\)/);
    // Legacy freeze (custody minors, ruling A9) keeps the purge date.
    expect(body).toMatch(
      /frozen_at IS NOT NULL AND frozen_reason IS NULL AND purge_after IS NOT NULL/,
    );
    // The NULL pitfall: UNKNOWN passes a CHECK, so the reason must be NOT NULL.
    expect(body).toMatch(
      /frozen_at IS NOT NULL\s+AND frozen_reason IS NOT NULL\s+AND frozen_reason IN \('majority_release', 'pending_guardian'\)\s+AND purge_after IS NULL/,
    );
  });

  it('backfills only the teens the cron froze: exact fingerprint, account holders, not purged', () => {
    const update = body.match(/UPDATE dependent_profiles dp[\s\S]*?;/)?.[0];
    expect(update).toBeDefined();
    expect(update).toMatch(
      /SET frozen_reason = 'pending_guardian',\s+purge_after = NULL/,
    );
    expect(update).toMatch(/dp\.frozen_at IS NOT NULL/);
    expect(update).toMatch(/dp\.frozen_reason IS NULL/);
    expect(update).toMatch(/dp\.purged_at IS NULL/);
    expect(update).toMatch(/sl\.disabled_reason = 'unlinked_purged'/);
    expect(update).toMatch(/FROM accounts a WHERE a\.user_id = dp\.user_id/);
  });

  it('lifts the login disable the cron used to write, only for the backfilled teens', () => {
    const update = body.match(/UPDATE supervised_logins sl[\s\S]*?;/)?.[0];
    expect(update).toBeDefined();
    expect(update).toMatch(
      /SET disabled_at = NULL,\s+disabled_reason = NULL,\s+disabled_by_user_id = NULL/,
    );
    expect(update).toMatch(/sl\.disabled_reason = 'unlinked_purged'/);
    expect(update).toMatch(/dp\.frozen_reason = 'pending_guardian'/);
    expect(update).toMatch(/dp\.purged_at IS NULL/);
  });

  it('is data-safe: no table/column drop, no DELETE, no new table', () => {
    expect(body).not.toMatch(/\bDROP (TABLE|COLUMN)\b/i);
    expect(body).not.toMatch(/\b(DELETE|TRUNCATE|INSERT|CREATE TABLE)\b/i);
  });

  it('the Prisma schema documents the new reason', () => {
    expect(schema).toMatch(/'pending_guardian'/);
  });
});
