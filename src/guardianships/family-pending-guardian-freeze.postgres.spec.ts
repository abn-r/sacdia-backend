import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLoopbackDatabaseUrl } from '../common/testing/loopback-database-url';

/**
 * Migration 20261114120000 (teens frozen as `pending_guardian`) against REAL
 * PostgreSQL (gated like the other `*.postgres.spec.ts` suites). A random schema
 * holds MINIMAL stubs of the touched tables; the Phase 4 columns migration (which
 * defines the previous CHECKs) runs first, legacy rows are seeded under the OLD
 * rules, then the migration runs TWICE (re-runnable) and the backfill and the
 * new CHECKs are asserted.
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  assertLoopbackDatabaseUrl(
    databaseUrl,
    'FAMILY_PENDING_GUARDIAN_TEST_DATABASE_MUST_BE_LOOPBACK',
  );
}

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const sqlOf = (name: string) =>
  readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

const COLUMNS = sqlOf('20261113100000_family_majority_release_columns');
const MIGRATION = sqlOf('20261114120000_family_pending_guardian_freeze');

pgDescribe('pending_guardian freeze migration against real PostgreSQL', () => {
  const schema = `fam_pending_${randomBytes(6).toString('hex')}`;
  let db: Client;

  const TEEN_FROZEN = randomUUID(); // cron-frozen teen: backfilled
  const CUSTODY_MINOR = randomUUID(); // legacy freeze, no account: untouched
  const TEEN_PURGED = randomUUID(); // purged teen: untouched
  const MAJORITY = randomUUID(); // majority_release freeze: untouched
  const NO_ACCOUNT_MARKED = randomUUID(); // fingerprint but no account: untouched
  const TEEN_FREE = randomUUID(); // not frozen: untouched
  const TEEN_GUARDIAN_DISABLED = randomUUID(); // frozen legacy, login disabled by guardian: untouched
  const FIXTURE = randomUUID();
  const DAYS_90 = `now() + interval '90 days'`;

  const rejects = async (text: string, params: unknown[] = []) => {
    await expect(db.query(text, params)).rejects.toBeDefined();
  };
  const profile = async (id: string) =>
    (
      await db.query(
        'SELECT frozen_at IS NOT NULL AS frozen, frozen_reason, purge_after IS NOT NULL AS has_purge FROM dependent_profiles WHERE user_id = $1',
        [id],
      )
    ).rows[0];
  const login = async (id: string) =>
    (
      await db.query(
        'SELECT disabled_at IS NOT NULL AS disabled, disabled_reason FROM supervised_logins WHERE user_id = $1',
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path = ${schema}`);
    await db.query(`
      CREATE TABLE dependent_profiles (
        user_id uuid PRIMARY KEY,
        created_by_user_id uuid NOT NULL,
        created_at timestamptz(6) NOT NULL DEFAULT now(),
        frozen_at timestamptz(6),
        purge_after timestamptz(6),
        purged_at timestamptz(6)
      );
      CREATE TABLE supervised_logins (
        user_id uuid PRIMARY KEY,
        disabled_at timestamptz(6),
        disabled_by_user_id uuid,
        disabled_reason varchar(24),
        CONSTRAINT supervised_logins_disabled_ck CHECK ((disabled_at IS NULL) = (disabled_reason IS NULL))
      );
      CREATE TABLE accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
    `);
    // The Phase 4 migration defines the CHECKs this one rewrites.
    await db.query(COLUMNS);

    const seed = async (
      id: string,
      opts: {
        frozen?: boolean;
        reason?: string | null;
        purged?: boolean;
        account?: boolean;
        login?: 'unlinked_purged' | 'guardian' | null;
      },
    ) => {
      await db.query(
        `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_at, frozen_reason, purge_after, purged_at)
         VALUES ($1, $1, ${opts.frozen ? 'now()' : 'NULL'}, $2, ${
           opts.frozen && !opts.reason ? DAYS_90 : 'NULL'
         }, ${opts.purged ? 'now()' : 'NULL'})`,
        [id, opts.reason ?? null],
      );
      if (opts.account) {
        await db.query('INSERT INTO accounts (user_id) VALUES ($1)', [id]);
      }
      if (opts.login) {
        await db.query(
          'INSERT INTO supervised_logins (user_id, disabled_at, disabled_reason) VALUES ($1, now(), $2)',
          [id, opts.login],
        );
      }
    };
    await seed(TEEN_FROZEN, {
      frozen: true,
      account: true,
      login: 'unlinked_purged',
    });
    await seed(CUSTODY_MINOR, { frozen: true });
    await seed(TEEN_PURGED, {
      frozen: true,
      purged: true,
      account: true,
      login: 'unlinked_purged',
    });
    await seed(MAJORITY, {
      frozen: true,
      reason: 'majority_release',
      account: true,
    });
    await seed(NO_ACCOUNT_MARKED, { frozen: true, login: 'unlinked_purged' });
    await seed(TEEN_FREE, { account: true });
    await seed(TEEN_GUARDIAN_DISABLED, {
      frozen: true,
      account: true,
      login: 'guardian',
    });

    // Twice: re-runnable.
    for (let pass = 0; pass < 2; pass += 1) await db.query(MIGRATION);
  });

  afterAll(async () => {
    if (db) {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    }
  });

  it('backfills the cron-frozen teen: pending_guardian, no purge_after, login re-enabled', async () => {
    expect(await profile(TEEN_FROZEN)).toEqual({
      frozen: true,
      frozen_reason: 'pending_guardian',
      has_purge: false,
    });
    expect(await login(TEEN_FROZEN)).toEqual({
      disabled: false,
      disabled_reason: null,
    });
  });

  it('never touches custody minors, purged rows, majority freezes, free teens or other disabled logins', async () => {
    expect(await profile(CUSTODY_MINOR)).toEqual({
      frozen: true,
      frozen_reason: null,
      has_purge: true,
    });
    expect(await profile(TEEN_PURGED)).toMatchObject({
      frozen_reason: null,
      has_purge: true,
    });
    expect(await login(TEEN_PURGED)).toEqual({
      disabled: true,
      disabled_reason: 'unlinked_purged',
    });
    expect(await profile(MAJORITY)).toEqual({
      frozen: true,
      frozen_reason: 'majority_release',
      has_purge: false,
    });
    expect(await profile(NO_ACCOUNT_MARKED)).toMatchObject({
      frozen_reason: null,
      has_purge: true,
    });
    expect(await login(NO_ACCOUNT_MARKED)).toEqual({
      disabled: true,
      disabled_reason: 'unlinked_purged',
    });
    expect(await profile(TEEN_FREE)).toEqual({
      frozen: false,
      frozen_reason: null,
      has_purge: false,
    });
    expect(await profile(TEEN_GUARDIAN_DISABLED)).toMatchObject({
      frozen_reason: null,
      has_purge: true,
    });
    expect(await login(TEEN_GUARDIAN_DISABLED)).toEqual({
      disabled: true,
      disabled_reason: 'guardian',
    });
  });

  it('CHECK: pending_guardian never carries a purge_after, legacy freezes always do (NULL hole closed)', async () => {
    // pending_guardian + purge_after: rejected.
    await rejects(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_at, frozen_reason, purge_after)
       VALUES ($1, $1, now(), 'pending_guardian', ${DAYS_90})`,
      [FIXTURE],
    );
    // Legacy freeze (NULL reason) WITHOUT purge_after: rejected, not passed as UNKNOWN.
    await rejects(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_at) VALUES ($1, $1, now())`,
      [FIXTURE],
    );
    // Unknown reason / reason without a freeze: rejected.
    await rejects(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_at, frozen_reason) VALUES ($1, $1, now(), 'other')`,
      [FIXTURE],
    );
    await rejects(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_reason) VALUES ($1, $1, 'pending_guardian')`,
      [FIXTURE],
    );
    // purge_after without a freeze: rejected.
    await rejects(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, purge_after) VALUES ($1, $1, ${DAYS_90})`,
      [FIXTURE],
    );
  });

  it('the cron freeze and the thaw are accepted by the CHECKs', async () => {
    await db.query(
      `UPDATE dependent_profiles SET frozen_at = now(), frozen_reason = 'pending_guardian', purge_after = NULL WHERE user_id = $1`,
      [TEEN_FREE],
    );
    expect(await profile(TEEN_FREE)).toEqual({
      frozen: true,
      frozen_reason: 'pending_guardian',
      has_purge: false,
    });
    await db.query(
      `UPDATE dependent_profiles SET frozen_at = NULL, frozen_reason = NULL, purge_after = NULL WHERE user_id = $1`,
      [TEEN_FREE],
    );
    expect(await profile(TEEN_FREE)).toEqual({
      frozen: false,
      frozen_reason: null,
      has_purge: false,
    });
  });

  it('a legacy custody freeze can still be written the old way (frozen_at + purge_after, no reason)', async () => {
    await db.query(
      `INSERT INTO dependent_profiles (user_id, created_by_user_id, frozen_at, purge_after) VALUES ($1, $1, now(), ${DAYS_90})`,
      [FIXTURE],
    );
    expect(await profile(FIXTURE)).toEqual({
      frozen: true,
      frozen_reason: null,
      has_purge: true,
    });
  });
});
