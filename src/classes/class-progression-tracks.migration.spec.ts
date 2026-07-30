import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const migration = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'prisma',
    'migrations',
    '20260730190000_class_progression_tracks',
    'migration.sql',
  ),
  'utf8',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

const fixtures = (schema: string) => `
  CREATE SCHEMA ${schema}; SET search_path=${schema},public;
  CREATE TABLE club_types (club_type_id integer PRIMARY KEY, name text NOT NULL);
  CREATE TABLE classes (
    class_id integer PRIMARY KEY,
    name text NOT NULL,
    club_type_id integer NOT NULL REFERENCES club_types(club_type_id),
    display_order integer NOT NULL,
    asset_code varchar(10)
  );
  INSERT INTO club_types VALUES
    (1, 'Aventureros'), (2, 'Conquistadores'), (3, 'Guías Mayores');
  INSERT INTO classes VALUES
    (1, 'Aventurero final', 1, 6, 'AV-06'),
    (2, 'Conquistador inicial', 2, 1, 'CQ-01'),
    (3, 'Conquistador final', 2, 6, 'CQ-06'),
    (4, 'Nombre renombrado sin heurística', 3, 1, 'GM-01'),
    (5, 'Guía siguiente', 3, 2, 'GM-02'),
    (6, 'Guía Mayor sólo en nombre', 2, 7, 'CUSTOM-01');
`;

describe('class progression tracks migration', () => {
  dbIt(
    'uses reviewed asset identities and creates only explicit crossover routes',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const schema = `investiture_tracks_${randomBytes(6).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(fixtures(schema));
        await client.query(`SET search_path=${schema},public; ${migration}`);

        await expect(
          client.query(
            `SELECT asset_code, formative_program_type FROM classes ORDER BY class_id`,
          ),
        ).resolves.toMatchObject({
          rows: [
            { asset_code: 'AV-06', formative_program_type: 'STANDARD' },
            { asset_code: 'CQ-01', formative_program_type: 'STANDARD' },
            { asset_code: 'CQ-06', formative_program_type: 'STANDARD' },
            { asset_code: 'GM-01', formative_program_type: 'GUIDE_MAJOR' },
            { asset_code: 'GM-02', formative_program_type: 'GUIDE_MAJOR' },
            { asset_code: 'CUSTOM-01', formative_program_type: 'STANDARD' },
          ],
        });
        await expect(
          client.query(`SELECT source.club_type_id AS from_club_type_id,
          target.club_type_id AS to_club_type_id
          FROM class_progression_track_transitions transition
          JOIN class_progression_tracks source ON source.class_progression_track_id = transition.from_track_id
          JOIN class_progression_tracks target ON target.class_progression_track_id = transition.to_track_id
          ORDER BY from_club_type_id`),
        ).resolves.toMatchObject({
          rows: [
            { from_club_type_id: 1, to_club_type_id: 2 },
            { from_club_type_id: 2, to_club_type_id: 3 },
          ],
        });
        await expect(
          client.query(`SELECT count(*)::int AS count
            FROM class_progression_track_transitions transition
            JOIN class_progression_tracks source ON source.class_progression_track_id = transition.from_track_id
            JOIN class_progression_tracks target ON target.class_progression_track_id = transition.to_track_id
            WHERE source.club_type_id = 1 AND target.club_type_id = 3`),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
        await expect(
          client.query(
            'INSERT INTO class_progression_tracks (club_type_id) VALUES (1)',
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          client.query(
            'INSERT INTO class_progression_tracks (club_type_id) VALUES (999)',
          ),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          client.query(`INSERT INTO class_progression_track_transitions (from_track_id, to_track_id)
          SELECT class_progression_track_id, class_progression_track_id
          FROM class_progression_tracks WHERE club_type_id = 1`),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'class_progression_track_transition_distinct_check',
        });
        await expect(
          client.query(`INSERT INTO class_progression_track_transitions (from_track_id, to_track_id)
          SELECT 999, class_progression_track_id
          FROM class_progression_tracks WHERE club_type_id = 1`),
        ).rejects.toMatchObject({ code: '23503' });
      } finally {
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await client.end();
      }
    },
  );
});
