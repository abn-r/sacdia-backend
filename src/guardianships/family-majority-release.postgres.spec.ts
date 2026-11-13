import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { assertLoopbackDatabaseUrl } from '../common/testing/loopback-database-url';

/**
 * Phase 4 migrations against REAL PostgreSQL (gated like the other
 * `*.postgres.spec.ts` suites). A random schema holds MINIMAL stubs of the
 * touched tables (only the columns the migrations and the assertions need),
 * the four migrations are applied (twice, to prove they are re-runnable) and
 * the CHECKs, the partial unique indexes and the CAS claims are exercised.
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  assertLoopbackDatabaseUrl(
    databaseUrl,
    'FAMILY_MAJORITY_RELEASE_TEST_DATABASE_MUST_BE_LOOPBACK',
  );
}

const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const sqlOf = (name: string) =>
  readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

const PHASE4 = [
  '20261113100000_family_majority_release_columns',
  '20261113110000_family_majority_release_legal',
  '20261113120000_family_majority_release_link_codes',
  '20261113140000_family_majority_release_backfill_profiles',
].map(sqlOf);

pgDescribe('family majority release migrations against real PostgreSQL', () => {
  const schema = `fam_release_${randomBytes(6).toString('hex')}`;
  let db: Client;
  const U1 = randomUUID();
  const U2 = randomUUID();

  const rejects = async (sql: string, params: unknown[] = []) => {
    await expect(db.query(sql, params)).rejects.toBeDefined();
  };

  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path = ${schema}`);
    await db.query(`
      CREATE TABLE users (user_id uuid PRIMARY KEY);
      CREATE TABLE dependent_profiles (
        user_id uuid PRIMARY KEY,
        created_by_user_id uuid NOT NULL,
        created_at timestamptz(6) NOT NULL DEFAULT now(),
        frozen_at timestamptz(6),
        purge_after timestamptz(6),
        purged_at timestamptz(6)
      );
      CREATE TABLE guardianships (guardianship_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dependent_user_id uuid NOT NULL);
      CREATE TABLE supervised_logins (user_id uuid PRIMARY KEY);
      CREATE TABLE legal_acceptances (
        legal_acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        document_type varchar(16) NOT NULL,
        document_version varchar(32) NOT NULL,
        method varchar(32) NOT NULL,
        accepted_by_user_id uuid,
        CONSTRAINT legal_acceptances_method_ck CHECK (method IN ('register_checkbox', 'acceptance_gate'))
      );
      CREATE UNIQUE INDEX uq_legal_acceptances_user_doc_version
        ON legal_acceptances (user_id, document_type, document_version);
      CREATE TABLE guardianship_link_codes (
        code_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purpose varchar(24) NOT NULL,
        dependent_user_id uuid NOT NULL,
        consumed_by_user_id uuid,
        consumed_at timestamptz(6),
        CONSTRAINT guardianship_link_codes_purpose_ck CHECK (purpose IN ('second_guardian', 'director_claim', 'teen_guardian_link'))
      );
    `);
    await db.query(
      'INSERT INTO guardianships (dependent_user_id) VALUES ($1)',
      [U1],
    );
    await db.query('INSERT INTO supervised_logins (user_id) VALUES ($1)', [U2]);
    // Twice: every migration must be re-runnable.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const sql of PHASE4) await db.query(sql);
    }
  });

  afterAll(async () => {
    if (db) {
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
    }
  });

  it('backfill created one row per tracked dependent and a re-run is a no-op', async () => {
    const { rows } = await db.query(
      'SELECT user_id FROM dependent_profiles ORDER BY user_id',
    );
    expect(rows.map((r) => r.user_id).sort()).toEqual([U1, U2].sort());
  });

  it('legacy rows keep frozen_reason NULL and reminder level 0', async () => {
    const { rows } = await db.query(
      'SELECT frozen_reason, release_reminder_level FROM dependent_profiles WHERE user_id = $1',
      [U1],
    );
    expect(rows[0]).toEqual({ frozen_reason: null, release_reminder_level: 0 });
  });

  it('release pair CHECK rejects a half-set released_at/deadline', async () => {
    await rejects(
      'UPDATE dependent_profiles SET released_at = now() WHERE user_id = $1',
      [U1],
    );
    await db.query(
      `UPDATE dependent_profiles SET released_at = now(), release_deadline_at = now() + interval '30 days' WHERE user_id = $1`,
      [U1],
    );
  });

  it('completed requires accepted; reminder is capped at 2; source and reason are validated', async () => {
    await rejects(
      'UPDATE dependent_profiles SET release_completed_at = now() WHERE user_id = $1',
      [U2],
    );
    await rejects(
      'UPDATE dependent_profiles SET release_reminder_level = 3 WHERE user_id = $1',
      [U2],
    );
    await rejects(
      `UPDATE dependent_profiles SET release_source = 'manual' WHERE user_id = $1`,
      [U2],
    );
    await rejects(
      `UPDATE dependent_profiles SET frozen_reason = 'majority_release' WHERE user_id = $1`,
      [U2],
    );
    await db.query(
      `UPDATE dependent_profiles SET frozen_at = now(), frozen_reason = 'majority_release' WHERE user_id = $1`,
      [U2],
    );
  });

  it('frozen_ck is conditional by frozen_reason: majority freeze needs NO purge_after, legacy freeze needs one', async () => {
    const U3 = randomUUID();
    const U4 = randomUUID();
    for (const id of [U3, U4]) {
      await db.query(
        'INSERT INTO dependent_profiles (user_id, created_by_user_id) VALUES ($1, $1)',
        [id],
      );
    }
    // Majority freeze WITHOUT purge_after succeeds (R6: never auto-deleted)...
    await db.query(
      `UPDATE dependent_profiles SET frozen_at = now(), frozen_reason = 'majority_release' WHERE user_id = $1`,
      [U3],
    );
    // ...and WITH purge_after is rejected.
    await rejects(
      `UPDATE dependent_profiles SET purge_after = now() + interval '30 days' WHERE user_id = $1`,
      [U3],
    );
    // Legacy freeze (reason NULL) requires purge_after.
    await rejects(
      'UPDATE dependent_profiles SET frozen_at = now() WHERE user_id = $1',
      [U4],
    );
    await db.query(
      `UPDATE dependent_profiles SET frozen_at = now(), purge_after = now() + interval '30 days' WHERE user_id = $1`,
      [U4],
    );
  });

  it('an on-behalf row and a majority_release row coexist for the same version; duplicates of either are rejected', async () => {
    const insert = (method: string, by: string | null) =>
      db.query(
        `INSERT INTO legal_acceptances (user_id, document_type, document_version, method, accepted_by_user_id)
         VALUES ($1, 'terms', '2.0.0-family', $2, $3)`,
        [U1, method, by],
      );
    await insert('acceptance_gate', U2);
    await insert('majority_release', null);
    await expect(insert('acceptance_gate', U2)).rejects.toBeDefined();
    await expect(insert('majority_release', null)).rejects.toBeDefined();
    // createMany skipDuplicates compiles to ON CONFLICT DO NOTHING (no target).
    const res = await db.query(
      `INSERT INTO legal_acceptances (user_id, document_type, document_version, method)
       VALUES ($1, 'terms', '2.0.0-family', 'majority_release') ON CONFLICT DO NOTHING`,
      [U1],
    );
    expect(res.rowCount).toBe(0);
  });

  it('adult_claim codes are accepted and only the dependent can consume them', async () => {
    await db.query(
      `INSERT INTO guardianship_link_codes (purpose, dependent_user_id) VALUES ('adult_claim', $1)`,
      [U1],
    );
    await db.query(
      `INSERT INTO guardianship_link_codes (purpose, dependent_user_id, consumed_by_user_id) VALUES ('adult_claim', $1, $1)`,
      [U1],
    );
    await rejects(
      `INSERT INTO guardianship_link_codes (purpose, dependent_user_id, consumed_by_user_id) VALUES ('adult_claim', $1, $2)`,
      [U1, U2],
    );
    await db.query(
      `INSERT INTO guardianship_link_codes (purpose, dependent_user_id, consumed_by_user_id) VALUES ('second_guardian', $1, $2)`,
      [U1, U2],
    );
  });

  it('CAS claim under concurrency has exactly one winner', async () => {
    const id = randomUUID();
    await db.query(
      'INSERT INTO dependent_profiles (user_id, created_by_user_id) VALUES ($1, $1)',
      [id],
    );
    const clients = await Promise.all(
      [0, 1, 2, 3].map(async () => {
        const c = new Client({
          connectionString: databaseUrl,
          options: `-c search_path=${schema}`,
        });
        await c.connect();
        return c;
      }),
    );
    try {
      const results = await Promise.all(
        clients.map((c) =>
          c.query(
            `UPDATE dependent_profiles
                SET released_at = now(), release_deadline_at = now() + interval '30 days', release_source = 'cron'
              WHERE user_id = $1 AND released_at IS NULL AND frozen_at IS NULL AND purged_at IS NULL`,
            [id],
          ),
        ),
      );
      expect(results.map((r) => r.rowCount).sort()).toEqual([0, 0, 0, 1]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});
