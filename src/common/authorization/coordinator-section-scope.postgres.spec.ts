import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { coordinator_assignment_type, PrismaClient } from '@prisma/client';
import { Client, Pool } from 'pg';
import {
  activeCoordinatorAssignmentWhere,
  coordinatorScopeIncludesSection,
  resolveCoordinatorAssignmentSectionIds,
  startOfUtcDay,
  type CoordinatorScopePrisma,
} from './coordinator-section-scope';

/**
 * The coordinator scope filters against REAL PostgreSQL. The unit spec only
 * checks the SHAPE of the `where` objects and an in-memory double, so nothing
 * there proves that the two spellings of the canonical rule select the same
 * rows once Postgres evaluates them:
 *  - the targeted check  `coordinatorScopeIncludesSection` (PermissionsGuard:
 *    "is THIS section in the user's scope?"), and
 *  - the expansion       `resolveCoordinatorAssignmentSectionIds` per active
 *    assignment (CoordinationService.resolveCoordinatorScope: "list the
 *    sections"), unioned the same way the service does.
 * Every scenario asserts the exact expected set AND that both agree on every
 * section in the database (including inactive ones and an orphan section).
 *
 * Harness: same env gate as the other `*.postgres.spec.ts` suites (CI's unit
 * job provides the Postgres service). A random schema holds the tables, built
 * from the REAL migrations (baseline for clubs/sections/districts/local
 * fields/club types, coordination_zones_assignments for the coordination
 * tables) plus stub parents (users, churches, unions). A REAL PrismaClient on
 * the `@prisma/adapter-pg` driver (the production wiring) runs the functions.
 * The world is re-seeded before each test. Production (Neon) runs with
 * TimeZone=UTC; the pool pins it so the suite does not depend on the server.
 */
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const enabled =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && !!databaseUrl;
const pgDescribe = enabled ? describe : describe.skip;

if (enabled && databaseUrl) {
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('COORDINATOR_SCOPE_TEST_DATABASE_MUST_BE_LOOPBACK');
  }
}

const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const baseline = readFileSync(
  join(MIGRATIONS, '0_baseline', 'migration.sql'),
  'utf8',
);
const coordination = readFileSync(
  join(
    MIGRATIONS,
    '20260617090000_coordination_zones_assignments',
    'migration.sql',
  ),
  'utf8',
);

const baselineTable = (table: string) =>
  baseline.match(
    new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`),
  )?.[0];
const baselineStatement = (pattern: RegExp) => baseline.match(pattern)?.[0];

const BASELINE_TABLES = [
  'local_fields',
  'club_types',
  'districts',
  'clubs',
  'club_sections',
].map(baselineTable);
const BASELINE_CONSTRAINTS = [
  /ALTER TABLE "local_fields" ADD CONSTRAINT "local_fields_union_id_fkey"[^;]*;/,
  /ALTER TABLE "districts" ADD CONSTRAINT "districts_local_field_id_fkey"[^;]*;/,
  /ALTER TABLE "clubs" ADD CONSTRAINT "clubs_church_id_fkey"[^;]*;/,
  /ALTER TABLE "clubs" ADD CONSTRAINT "clubs_districlub_type_id_fkey"[^;]*;/,
  /ALTER TABLE "clubs" ADD CONSTRAINT "clubs_local_field_id_fkey"[^;]*;/,
  /ALTER TABLE "club_sections" ADD CONSTRAINT "club_sections_club_type_id_fkey"[^;]*;/,
  /ALTER TABLE "club_sections" ADD CONSTRAINT "club_sections_main_club_id_fkey"[^;]*;/,
  /CREATE UNIQUE INDEX "club_sections_main_club_id_club_type_id_key"[^;]*;/,
].map(baselineStatement);
// The migration defaults the id to the Supabase `extensions` schema function;
// the rows are inserted with explicit ids anyway.
const COORDINATION_DDL = coordination.replace(
  'extensions.uuid_generate_v4()',
  'gen_random_uuid()',
);

const DAY = {
  yesterday: '2026-06-14',
  today: '2026-06-15',
  tomorrow: '2026-06-16',
  longAgo: '2026-01-01',
  farAhead: '2026-12-31',
};
/** A fixed "now" in the middle of the UTC day 2026-06-15. */
const NOW = new Date('2026-06-15T12:00:00.000Z');

const ME = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const OTHER = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

const LF1 = 1;
const LF2 = 2;
const CONQ = 1;
const AVENT = 2;
const GM = 3;
const D_A = 1; // in zone Z1 (active link)
const D_B = 2; // in zone Z1 with an INACTIVE link
const D_C = 3; // in no zone
const D_Z2 = 4; // in zone Z2
const D_X = 5; // in the INACTIVE zone Z_OFF
const D_Y = 6; // LF2, in zone Z_LF2
const Z1 = 1;
const Z2 = 2;
const Z_OFF = 3;
const Z_LF2 = 4;

// club_id -> [local field, district, active]
const CLUBS: Record<number, [number, number, boolean]> = {
  1: [LF1, D_A, true],
  2: [LF1, D_A, true],
  3: [LF1, D_A, false], // inactive club inside Z1
  4: [LF1, D_B, true],
  5: [LF1, D_C, true],
  6: [LF1, D_Z2, true],
  7: [LF1, D_X, true],
  8: [LF2, D_Y, true],
  9: [LF2, D_A, true], // inconsistent: LF2 club on an LF1 zone district
};
// section label -> [club_id | null, club type, active]
const SECTIONS = {
  a1_conq: [1, CONQ, true],
  a1_avent: [1, AVENT, true],
  a1_gm_off: [1, GM, false],
  a2_conq_off: [2, CONQ, false],
  a2_avent: [2, AVENT, true],
  aoff_conq: [3, CONQ, true],
  b_conq: [4, CONQ, true],
  c_conq: [5, CONQ, true],
  z2_conq: [6, CONQ, true],
  x_conq: [7, CONQ, true],
  lf2_conq: [8, CONQ, true],
  lf2_avent: [8, AVENT, true],
  lf2da_conq: [9, CONQ, true],
  orphan: [null, CONQ, true],
} as const satisfies Record<string, readonly [number | null, number, boolean]>;
type SectionLabel = keyof typeof SECTIONS;
const LABELS = Object.keys(SECTIONS) as SectionLabel[];
const sectionId = (label: SectionLabel) => LABELS.indexOf(label) + 1;
const labelOf = (id: number) => LABELS[id - 1];

const GENERAL_LF1: SectionLabel[] = [
  'a1_conq',
  'a1_avent',
  'a2_avent',
  'b_conq',
  'c_conq',
  'z2_conq',
  'x_conq',
];
const GENERAL_LF2: SectionLabel[] = ['lf2_conq', 'lf2_avent', 'lf2da_conq'];

type Assignment = {
  user?: string;
  type: coordinator_assignment_type;
  localField: number;
  zone?: number;
  clubType?: number;
  section?: SectionLabel;
  active?: boolean;
  start?: string;
  end?: string | null;
};

const GENERAL = coordinator_assignment_type.GENERAL;
const ZONE = coordinator_assignment_type.ZONE;
const SECTION = coordinator_assignment_type.SECTION;

pgDescribe('coordinator scope filters against real PostgreSQL', () => {
  const schema = `coord_scope_${randomBytes(6).toString('hex')}`;
  let admin: Client;
  let pool: Pool;
  let prisma: PrismaClient;
  let db: CoordinatorScopePrisma;

  const seedWorld = async () => {
    await admin.query(
      `TRUNCATE coordinator_assignments, coordination_zone_districts,
         coordination_zones, club_sections, clubs, districts, club_types,
         local_fields, churches, unions, users RESTART IDENTITY CASCADE`,
    );
    await admin.query('INSERT INTO users (user_id) VALUES ($1), ($2)', [
      ME,
      OTHER,
    ]);
    await admin.query(
      `INSERT INTO unions (union_id) VALUES (1);
       INSERT INTO churches (church_id) VALUES (1);
       INSERT INTO local_fields (local_field_id, name, abbreviation, active, union_id)
         VALUES (${LF1}, 'LF1', 'LF1', true, 1), (${LF2}, 'LF2', 'LF2', true, 1);
       INSERT INTO club_types (club_type_id, name, active)
         VALUES (${CONQ}, 'Conquistadores', true), (${AVENT}, 'Aventureros', true),
                (${GM}, 'Guias Mayores', true);
       INSERT INTO districts (districlub_type_id, name, active, local_field_id) VALUES
         (${D_A}, 'A', true, ${LF1}), (${D_B}, 'B', true, ${LF1}),
         (${D_C}, 'C', true, ${LF1}), (${D_Z2}, 'Z2', true, ${LF1}),
         (${D_X}, 'X', true, ${LF1}), (${D_Y}, 'Y', true, ${LF2});
       INSERT INTO coordination_zones (zone_id, local_field_id, name, active) VALUES
         (${Z1}, ${LF1}, 'Z1', true), (${Z2}, ${LF1}, 'Z2', true),
         (${Z_OFF}, ${LF1}, 'Z off', false), (${Z_LF2}, ${LF2}, 'Z LF2', true);
       INSERT INTO coordination_zone_districts (zone_id, districlub_type_id, active) VALUES
         (${Z1}, ${D_A}, true), (${Z1}, ${D_B}, false), (${Z2}, ${D_Z2}, true),
         (${Z_OFF}, ${D_X}, true), (${Z_LF2}, ${D_Y}, true);`,
    );
    for (const [clubId, [lf, district, active]] of Object.entries(CLUBS)) {
      await admin.query(
        `INSERT INTO clubs (club_id, name, active, local_field_id, church_id,
           coordinates, districlub_type_id)
         VALUES ($1, $2, $3, $4, 1, '{}', $5)`,
        [clubId, `club ${clubId}`, active, lf, district],
      );
    }
    for (const label of LABELS) {
      const [clubId, clubType, active] = SECTIONS[label];
      await admin.query(
        `INSERT INTO club_sections (club_section_id, active, club_type_id, main_club_id)
         VALUES ($1, $2, $3, $4)`,
        [sectionId(label), active, clubType, clubId],
      );
    }
  };

  const assign = async (a: Assignment) =>
    admin.query(
      `INSERT INTO coordinator_assignments (assignment_id, user_id, local_field_id,
         assignment_type, zone_id, club_type_id, club_section_id, active,
         start_date, end_date)
       VALUES ($1, $2, $3, $4::coordinator_assignment_type, $5, $6, $7, $8,
         $9::date, $10::date)`,
      [
        randomUUID(),
        a.user ?? ME,
        a.localField,
        a.type,
        a.zone ?? null,
        a.clubType ?? null,
        a.section ? sectionId(a.section) : null,
        a.active ?? true,
        a.start ?? DAY.longAgo,
        a.end ?? null,
      ],
    );

  /**
   * Both sides for one user, exactly as production composes them:
   * the expansion mirrors CoordinationService.resolveCoordinatorScope
   * (active-window assignments -> one expansion each -> Set union); the
   * targeted side asks every section in the database, active or not.
   */
  const evaluate = async (user: string, now: Date = NOW) => {
    const assignments = await prisma.coordinator_assignments.findMany({
      where: {
        user_id: user,
        ...activeCoordinatorAssignmentWhere(startOfUtcDay(now)),
      },
    });
    const perAssignment: number[][] = [];
    for (const assignment of assignments) {
      perAssignment.push(
        await resolveCoordinatorAssignmentSectionIds(db, {
          localFieldId: assignment.local_field_id,
          assignmentType: assignment.assignment_type,
          zoneId: assignment.zone_id ?? undefined,
          clubTypeId: assignment.club_type_id ?? undefined,
          clubSectionId: assignment.club_section_id ?? undefined,
        }),
      );
    }
    const union = [...new Set(perAssignment.flat())];

    const targeted: number[] = [];
    for (const label of LABELS) {
      if (
        await coordinatorScopeIncludesSection(db, user, sectionId(label), now)
      ) {
        targeted.push(sectionId(label));
      }
    }
    return {
      perAssignment,
      union,
      expanded: union.map(labelOf).sort(),
      targeted: targeted.map(labelOf).sort(),
    };
  };

  /** The exact expected scope, from BOTH functions, and they agree. */
  const expectScope = async (
    expected: SectionLabel[],
    user: string = ME,
    now: Date = NOW,
  ) => {
    const result = await evaluate(user, now);
    const sorted = [...expected].sort();
    expect({ via: 'expansion', sections: result.expanded }).toEqual({
      via: 'expansion',
      sections: sorted,
    });
    expect({ via: 'targeted', sections: result.targeted }).toEqual({
      via: 'targeted',
      sections: sorted,
    });
    expect(result.expanded).toEqual(result.targeted);
    // One expansion never repeats a section by itself.
    for (const ids of result.perAssignment) {
      expect(new Set(ids).size).toBe(ids.length);
    }
    return result;
  };

  beforeAll(async () => {
    if (
      BASELINE_TABLES.some((t) => !t) ||
      BASELINE_CONSTRAINTS.some((c) => !c)
    ) {
      throw new Error('baseline DDL not found');
    }
    admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path = ${schema}`);
    await admin.query(`
      CREATE TABLE users (user_id uuid PRIMARY KEY);
      CREATE TABLE unions (union_id serial PRIMARY KEY);
      CREATE TABLE churches (church_id serial PRIMARY KEY);
    `);
    for (const ddl of BASELINE_TABLES) await admin.query(ddl as string);
    for (const ddl of BASELINE_CONSTRAINTS) await admin.query(ddl as string);
    await admin.query(COORDINATION_DDL);

    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schema} -c TimeZone=UTC`,
    });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
    db = prisma;
  });

  beforeEach(seedWorld);

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('has nothing in scope without an assignment, and answers false for an unknown section', async () => {
    await expectScope([]);
    expect(await coordinatorScopeIncludesSection(db, ME, 999999, NOW)).toBe(
      false,
    );
  });

  describe('GENERAL', () => {
    it('is every active section of every active club of the local field', async () => {
      await assign({ type: GENERAL, localField: LF1 });
      // Excluded on purpose: a1_gm_off / a2_conq_off (inactive section),
      // aoff_conq (inactive club), the LF2 sections and the orphan section.
      await expectScope(GENERAL_LF1);
    });

    it('is the other local field when the assignment is for it', async () => {
      await assign({ type: GENERAL, localField: LF2 });
      await expectScope(GENERAL_LF2);
    });

    it('does not depend on districts or zones (an inactive zone changes nothing)', async () => {
      await assign({ type: GENERAL, localField: LF1 });
      await admin.query('UPDATE coordination_zones SET active = false');
      await expectScope(GENERAL_LF1);
    });

    it.each<[string, string, SectionLabel[]]>([
      [
        'a club goes inactive',
        'UPDATE clubs SET active = false WHERE club_id = 1',
        ['b_conq', 'c_conq', 'z2_conq', 'x_conq', 'a2_avent'],
      ],
      [
        'a section goes inactive',
        `UPDATE club_sections SET active = false WHERE club_section_id = ${sectionId('c_conq')}`,
        ['a1_conq', 'a1_avent', 'a2_avent', 'b_conq', 'z2_conq', 'x_conq'],
      ],
      [
        'an inactive section is reactivated',
        `UPDATE club_sections SET active = true WHERE club_section_id = ${sectionId('a1_gm_off')}`,
        [...GENERAL_LF1, 'a1_gm_off'],
      ],
      [
        'an inactive club is reactivated',
        'UPDATE clubs SET active = true WHERE club_id = 3',
        [...GENERAL_LF1, 'aoff_conq'],
      ],
      [
        'a club moves to the other local field',
        'UPDATE clubs SET local_field_id = 2 WHERE club_id = 1',
        ['a2_avent', 'b_conq', 'c_conq', 'z2_conq', 'x_conq'],
      ],
    ])('follows the data when %s', async (_name, sql, expected) => {
      await assign({ type: GENERAL, localField: LF1 });
      await admin.query(sql);
      await expectScope(expected);
    });
  });

  describe('ZONE', () => {
    it('matches the club type and the zone districts that are active in it', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: CONQ });
      // Excluded on purpose: a1_avent / a2_avent (wrong type), a2_conq_off
      // (inactive section), aoff_conq (inactive club), b_conq (INACTIVE
      // district link), c_conq (no zone), z2_conq / x_conq (other zones),
      // lf2da_conq (right district, other local field), lf2_conq, orphan.
      await expectScope(['a1_conq']);
    });

    it('selects every section of the assigned type across clubs of the zone', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: AVENT });
      await expectScope(['a1_avent', 'a2_avent']);
    });

    it('is empty for a type whose only section in the zone is inactive', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: GM });
      await expectScope([]);
    });

    it('is the districts of its own zone only', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z2, clubType: CONQ });
      await expectScope(['z2_conq']);
    });

    it('grants nothing while the zone is inactive, even with active district links', async () => {
      await assign({
        type: ZONE,
        localField: LF1,
        zone: Z_OFF,
        clubType: CONQ,
      });
      await expectScope([]);
    });

    it('is the zone of the other local field when assigned there', async () => {
      await assign({
        type: ZONE,
        localField: LF2,
        zone: Z_LF2,
        clubType: CONQ,
      });
      await expectScope(['lf2_conq']);
    });

    it('grants nothing when the zone belongs to another local field than the assignment', async () => {
      await assign({
        type: ZONE,
        localField: LF1,
        zone: Z_LF2,
        clubType: CONQ,
      });
      await expectScope([]);
    });

    it.each<[string, string, SectionLabel[]]>([
      [
        'the inactive district link is reactivated',
        `UPDATE coordination_zone_districts SET active = true
           WHERE zone_id = ${Z1} AND districlub_type_id = ${D_B}`,
        ['a1_conq', 'b_conq'],
      ],
      [
        'the active district link is deactivated',
        `UPDATE coordination_zone_districts SET active = false
           WHERE zone_id = ${Z1} AND districlub_type_id = ${D_A}`,
        [],
      ],
      [
        'the zone is deactivated',
        `UPDATE coordination_zones SET active = false WHERE zone_id = ${Z1}`,
        [],
      ],
      [
        'the club is deactivated',
        'UPDATE clubs SET active = false WHERE club_id = 1',
        [],
      ],
      [
        'the section is deactivated',
        `UPDATE club_sections SET active = false WHERE club_section_id = ${sectionId('a1_conq')}`,
        [],
      ],
      [
        'the club moves to a district outside the zone',
        `UPDATE clubs SET districlub_type_id = ${D_C} WHERE club_id = 1`,
        [],
      ],
      [
        'another club moves into the zone district',
        `UPDATE clubs SET districlub_type_id = ${D_A} WHERE club_id = 5`,
        ['a1_conq', 'c_conq'],
      ],
      [
        'the club moves to the other local field',
        'UPDATE clubs SET local_field_id = 2 WHERE club_id = 1',
        [],
      ],
      [
        'the district row itself is deactivated (only the zone link counts)',
        `UPDATE districts SET active = false WHERE districlub_type_id = ${D_A}`,
        ['a1_conq'],
      ],
    ])('follows the data when %s', async (_name, sql, expected) => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: CONQ });
      await admin.query(sql);
      await expectScope(expected);
    });
  });

  describe('SECTION', () => {
    it('is that one section when it and its club are active', async () => {
      await assign({ type: SECTION, localField: LF1, section: 'a1_conq' });
      await expectScope(['a1_conq']);
    });

    it('works across local fields (the section decides, not the local field of the user)', async () => {
      await assign({ type: SECTION, localField: LF2, section: 'lf2_avent' });
      await expectScope(['lf2_avent']);
    });

    it.each<[string, SectionLabel]>([
      ['an inactive section', 'a1_gm_off'],
      ['a section of an inactive club', 'aoff_conq'],
      ['a section with no club', 'orphan'],
    ])('grants nothing for %s', async (_name, section) => {
      await assign({ type: SECTION, localField: LF1, section });
      await expectScope([]);
    });

    it.each<[string, string, SectionLabel[]]>([
      [
        'its club is deactivated',
        'UPDATE clubs SET active = false WHERE club_id = 1',
        [],
      ],
      [
        'it is deactivated',
        `UPDATE club_sections SET active = false WHERE club_section_id = ${sectionId('a1_conq')}`,
        [],
      ],
      [
        'its sibling section is deactivated',
        `UPDATE club_sections SET active = false WHERE club_section_id = ${sectionId('a1_avent')}`,
        ['a1_conq'],
      ],
    ])('follows the data when %s', async (_name, sql, expected) => {
      await assign({ type: SECTION, localField: LF1, section: 'a1_conq' });
      await admin.query(sql);
      await expectScope(expected);
    });
  });

  describe('assignment window', () => {
    const general = (over: Partial<Assignment> = {}): Assignment => ({
      type: GENERAL,
      localField: LF1,
      ...over,
    });

    it.each<[string, Partial<Assignment>, boolean]>([
      ['active, open ended', {}, true],
      ['inactive flag', { active: false }, false],
      ['ended yesterday', { end: DAY.yesterday }, false],
      ['ends today (inclusive)', { end: DAY.today }, true],
      ['ends tomorrow', { end: DAY.tomorrow }, true],
      ['starts tomorrow (future)', { start: DAY.tomorrow }, false],
      ['starts today (inclusive)', { start: DAY.today }, true],
      ['starts yesterday', { start: DAY.yesterday }, true],
      ['starts and ends today', { start: DAY.today, end: DAY.today }, true],
      ['future window', { start: DAY.tomorrow, end: DAY.farAhead }, false],
      ['past window', { start: DAY.longAgo, end: DAY.yesterday }, false],
    ])('GENERAL %s', async (_name, over, inScope) => {
      await assign(general(over));
      await expectScope(inScope ? GENERAL_LF1 : []);
    });

    it.each<[string, Assignment]>([
      ['ZONE', { type: ZONE, localField: LF1, zone: Z1, clubType: CONQ }],
      ['SECTION', { type: SECTION, localField: LF1, section: 'a1_conq' }],
    ])('applies to %s assignments too', async (_name, base) => {
      await assign({ ...base, end: DAY.yesterday });
      await expectScope([]);
      await admin.query('DELETE FROM coordinator_assignments');
      await assign({ ...base, start: DAY.tomorrow });
      await expectScope([]);
      await admin.query('DELETE FROM coordinator_assignments');
      await assign({ ...base, active: false });
      await expectScope([]);
      await admin.query('DELETE FROM coordinator_assignments');
      await assign({ ...base, end: DAY.today });
      await expectScope(['a1_conq']);
    });

    it('compares against the UTC day, not the local day', async () => {
      // 2026-06-15T23:30 in UTC-6 is already 2026-06-16 in UTC.
      const lateLocal = new Date('2026-06-16T05:30:00.000Z');
      await assign(general({ start: DAY.tomorrow }));
      await expectScope(GENERAL_LF1, ME, lateLocal);
      await admin.query('DELETE FROM coordinator_assignments');
      await assign(general({ end: DAY.today }));
      await expectScope([], ME, lateLocal);
    });

    it('keeps the last instant of the UTC day inside the window', async () => {
      await assign(general({ start: DAY.today, end: DAY.today }));
      await expectScope(GENERAL_LF1, ME, new Date('2026-06-15T23:59:59.999Z'));
      await expectScope(GENERAL_LF1, ME, new Date('2026-06-15T00:00:00.000Z'));
      await expectScope([], ME, new Date('2026-06-16T00:00:00.000Z'));
    });

    it('does not leak the assignment of another user', async () => {
      await assign(general({ user: OTHER }));
      await expectScope([], ME);
      await expectScope(GENERAL_LF1, OTHER);
    });

    it('keeps users apart when each has their own assignments', async () => {
      await assign(general({ user: OTHER }));
      await assign({
        type: ZONE,
        localField: LF1,
        zone: Z1,
        clubType: CONQ,
        user: ME,
      });
      await expectScope(['a1_conq'], ME);
      await expectScope(GENERAL_LF1, OTHER);
    });

    it('ignores an expired assignment next to a current one of the same user', async () => {
      await assign(general({ end: DAY.yesterday }));
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: AVENT });
      await expectScope(['a1_avent', 'a2_avent']);
    });
  });

  describe('mixed assignments', () => {
    it('unions several assignments with no duplicates (GENERAL + ZONE + SECTION overlap)', async () => {
      await assign({ type: GENERAL, localField: LF1 });
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: CONQ });
      await assign({ type: SECTION, localField: LF1, section: 'a1_conq' });
      const result = await expectScope(GENERAL_LF1);
      // The raw expansions overlap; only the union is free of repeats.
      expect(result.perAssignment.flat().length).toBeGreaterThan(
        result.union.length,
      );
      expect(new Set(result.union).size).toBe(result.union.length);
    });

    it('unions disjoint assignments, also across local fields', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: CONQ });
      await assign({ type: ZONE, localField: LF1, zone: Z2, clubType: CONQ });
      await assign({ type: SECTION, localField: LF2, section: 'lf2_avent' });
      await expectScope(['a1_conq', 'z2_conq', 'lf2_avent']);
    });

    it('unions the two zone types of the same zone', async () => {
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: CONQ });
      await assign({ type: ZONE, localField: LF1, zone: Z1, clubType: AVENT });
      await expectScope(['a1_conq', 'a1_avent', 'a2_avent']);
    });

    it('drops only the assignments that are not current or whose territory is inactive', async () => {
      await assign({ type: GENERAL, localField: LF2, end: DAY.yesterday });
      await assign({
        type: ZONE,
        localField: LF1,
        zone: Z_OFF,
        clubType: CONQ,
      });
      await assign({ type: SECTION, localField: LF1, section: 'a1_gm_off' });
      await assign({ type: SECTION, localField: LF1, section: 'b_conq' });
      await expectScope(['b_conq']);
    });

    it('is empty when every assignment is spent', async () => {
      await assign({ type: GENERAL, localField: LF1, active: false });
      await assign({
        type: ZONE,
        localField: LF1,
        zone: Z1,
        clubType: CONQ,
        start: DAY.tomorrow,
      });
      await assign({
        type: SECTION,
        localField: LF1,
        section: 'a1_conq',
        end: DAY.yesterday,
      });
      await expectScope([]);
    });
  });
});
