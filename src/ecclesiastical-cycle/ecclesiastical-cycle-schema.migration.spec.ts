import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migrationPath = join(
  __dirname,
  '..',
  '..',
  'prisma/migrations/20260731120000_ecclesiastical_cycle_schema/migration.sql',
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, 'utf8')
  : '';
const databaseUrl = process.env.ECCLESIASTICAL_CYCLE_TEST_DATABASE_URL;
const dbIt = databaseUrl ? it : it.skip;

const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TABLE users (user_id uuid PRIMARY KEY);
  CREATE TABLE local_fields (local_field_id integer PRIMARY KEY);
  CREATE TABLE ecclesiastical_years (year_id integer PRIMARY KEY);
  CREATE TABLE club_role_assignments (assignment_id uuid PRIMARY KEY);
  CREATE TABLE enrollments (enrollment_id integer PRIMARY KEY);
  CREATE TABLE classes (class_id integer PRIMARY KEY);
  CREATE TABLE club_sections (club_section_id integer PRIMARY KEY);
  INSERT INTO users VALUES
    ('00000000-0000-0000-0000-000000000001'),
    ('00000000-0000-0000-0000-000000000002');
  INSERT INTO local_fields VALUES (1), (2);
  INSERT INTO ecclesiastical_years VALUES (2027), (2028);
  INSERT INTO club_role_assignments VALUES ('10000000-0000-0000-0000-000000000001');
  INSERT INTO enrollments VALUES (10); INSERT INTO classes VALUES (20);
  INSERT INTO club_sections VALUES (30);`;

describe('ecclesiastical cycle schema migration', () => {
  it('owns only runs, decisions and append-only events', () => {
    expect(
      [...migration.matchAll(/CREATE TABLE (\w+)/g)].map((match) => match[1]),
    ).toEqual([
      'ecclesiastical_cycle_runs',
      'ecclesiastical_cycle_decisions',
      'ecclesiastical_cycle_events',
    ]);
    expect(migration).toMatch(
      /BEFORE UPDATE OR DELETE ON ecclesiastical_cycle_events/i,
    );
    expect(migration).not.toMatch(/CREATE TABLE class_progression_/i);
    expect(migration).not.toMatch(/renewed_from_enrollment_id/i);
  });

  dbIt('rolls back every cycle artifact when migration fails', async () => {
    if (!databaseUrl) throw new Error('integration URL required');
    const schema = `cycle_c02a_rollback_${randomBytes(6).toString('hex')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(fixtures(schema));
      await expect(
        client.query(
          `SET search_path=${schema},public; ${migration.replace('COMMIT;', 'SELECT 1 / 0; COMMIT;')}`,
        ),
      ).rejects.toMatchObject({ code: '22012' });
      await client.query('ROLLBACK');
      const artifacts = await client.query(`SELECT
        to_regclass('ecclesiastical_cycle_runs') AS runs,
        to_regclass('ecclesiastical_cycle_decisions') AS decisions,
        to_regclass('ecclesiastical_cycle_events') AS events,
        to_regprocedure('prevent_ecclesiastical_cycle_event_mutation()') AS fn`);
      expect(artifacts.rows[0]).toEqual({
        runs: null,
        decisions: null,
        events: null,
        fn: null,
      });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  });

  dbIt(
    'rejects cross-run mismatches, duplicate reruns and event mutation',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `cycle_c02a_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);
        const run = `INSERT INTO ecclesiastical_cycle_runs
        (run_id, local_field_id, target_year_id, owner_user_id)
        VALUES ('20000000-0000-0000-0000-000000000001', 1, 2027,
          '00000000-0000-0000-0000-000000000001')`;
        await client.query(run);
        await expect(
          client.query(run.replace("000000000001', 1", "000000000002', 1")),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'ecclesiastical_cycle_runs_local_field_year_key',
        });
        await expect(
          client.query("UPDATE ecclesiastical_cycle_runs SET status='running'"),
        ).rejects.toMatchObject({ code: '23514' });
        await client.query(`INSERT INTO ecclesiastical_cycle_runs
          (run_id, local_field_id, target_year_id, owner_user_id)
          VALUES ('20000000-0000-0000-0000-000000000002', 2, 2028,
            '00000000-0000-0000-0000-000000000001')`);

        const decision = `INSERT INTO ecclesiastical_cycle_decisions
        (decision_id, run_id, user_id, source_assignment_id,
         source_enrollment_id, target_year_id, canonical_transition_id,
         target_class_id, target_club_section_id, actor_user_id)
        VALUES ('30000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          '10000000-0000-0000-0000-000000000001', 10, 2027, 17, 20, 30,
          '00000000-0000-0000-0000-000000000001')`;
        await client.query(decision);
        await expect(
          client.query(
            decision
              .replace(
                '30000000-0000-0000-0000-000000000001',
                '30000000-0000-0000-0000-000000000003',
              )
              .replace(', 10, 2027,', ', 10, 2028,'),
          ),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'ecclesiastical_cycle_decisions_run_year_fkey',
        });
        await expect(
          client.query(
            decision.replace(
              '30000000-0000-0000-0000-000000000001',
              '30000000-0000-0000-0000-000000000002',
            ),
          ),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'ecclesiastical_cycle_decisions_member_source_year_key',
        });
        await expect(
          client.query(
            "UPDATE ecclesiastical_cycle_decisions SET status='blocked'",
          ),
        ).rejects.toMatchObject({ code: '23514' });

        await client.query(`INSERT INTO ecclesiastical_cycle_events
        (run_id, decision_id, event_key, event_type, actor_user_id, payload)
        VALUES ('20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000001', 'decision-1-planned',
          'DECISION_PLANNED', '00000000-0000-0000-0000-000000000001', '{}')`);
        await expect(
          client.query(`INSERT INTO ecclesiastical_cycle_events
            (run_id, decision_id, event_key, event_type) VALUES
            ('20000000-0000-0000-0000-000000000002',
             '30000000-0000-0000-0000-000000000001', 'mismatch',
             'DECISION_PLANNED')`),
        ).rejects.toMatchObject({
          code: '23503',
          constraint: 'ecclesiastical_cycle_events_decision_run_fkey',
        });
        await expect(
          client.query(`INSERT INTO ecclesiastical_cycle_events
            (run_id, decision_id, event_key, event_type) VALUES
            ('20000000-0000-0000-0000-000000000001',
             '30000000-0000-0000-0000-000000000001', 'bad-run-kind',
             'RUN_STARTED')`),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(`INSERT INTO ecclesiastical_cycle_events
            (run_id, event_key, event_type) VALUES
            ('20000000-0000-0000-0000-000000000001', 'bad-decision-kind',
             'DECISION_PLANNED')`),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          client.query(`INSERT INTO ecclesiastical_cycle_events
          (run_id, event_key, event_type, payload) VALUES
          ('20000000-0000-0000-0000-000000000001', 'decision-1-planned',
           'RUN_STARTED', '{}')`),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'ecclesiastical_cycle_events_event_key_key',
        });
        await expect(
          client.query("UPDATE ecclesiastical_cycle_events SET payload='{}'"),
        ).rejects.toMatchObject({ code: 'P0001' });
        await expect(
          client.query('DELETE FROM ecclesiastical_cycle_events'),
        ).rejects.toMatchObject({ code: 'P0001' });
        await expect(
          client.query('DELETE FROM enrollments WHERE enrollment_id=10'),
        ).rejects.toMatchObject({ code: '23001' });
        const indexes =
          await client.query(`SELECT count(*)::int count FROM pg_indexes
        WHERE schemaname=current_schema() AND indexname IN
        ('ecclesiastical_cycle_runs_status_lease_idx',
         'ecclesiastical_cycle_decisions_run_status_idx',
         'ecclesiastical_cycle_events_decision_created_idx')`);
        expect(indexes.rows[0]).toEqual({ count: 3 });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
