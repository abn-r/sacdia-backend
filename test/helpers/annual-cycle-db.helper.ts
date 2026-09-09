import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const SACDIA_TEST_DATABASE_URL_ENV = 'SACDIA_TEST_DATABASE_URL';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const BACKEND_ROOT = join(__dirname, '../..');

const DUMMY_R2 = 'https://r2.test.invalid';

export const ANNUAL_CYCLE_IDS = {
  gmDirector: 'aaaaaaaa-aaaa-4aaa-8aaa-111111111111',
  cqDirector: 'bbbbbbbb-bbbb-4bbb-8bbb-222222222222',
  gmSuccessor: 'cccccccc-cccc-4ccc-8ccc-333333333333',
  returnedMember: 'dddddddd-dddd-4ddd-8ddd-444444444444',
  foreignLfAdmin: 'eeeeeeee-eeee-4eee-8eee-555555555555',
  ownerGhost: 'ffffffff-ffff-4fff-8fff-666666666666',
  lfScheduler: '99999999-9999-4999-8999-777777777777',
  cqContinuing: '12121212-1212-4121-8121-121212121212',
} as const;

/** Instant whose Mexico City business date is 2026-01-01. */
export const YEAR_CUT_NOW = new Date('2026-01-01T18:00:00.000Z');

export class UnsafeTestDatabaseUrlError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'UnsafeTestDatabaseUrlError';
  }
}

export function assertSafeTestDatabaseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsafeTestDatabaseUrlError(
      'SACDIA_TEST_DATABASE_URL_INVALID',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new UnsafeTestDatabaseUrlError(
      'SACDIA_TEST_DATABASE_URL_PROTOCOL_INVALID',
    );
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseUrlError(
      'SACDIA_TEST_DATABASE_URL_NOT_LOOPBACK',
    );
  }

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!dbName || !dbName.endsWith('_test')) {
    throw new UnsafeTestDatabaseUrlError(
      'SACDIA_TEST_DATABASE_URL_NAME_MUST_END_WITH_TEST',
    );
  }

  return parsed;
}

export function applyIsolatedTestDatabaseFromEnv(): string {
  const dedicated = process.env[SACDIA_TEST_DATABASE_URL_ENV];
  if (!dedicated || !dedicated.trim()) {
    throw new UnsafeTestDatabaseUrlError(
      'SACDIA_TEST_DATABASE_URL_REQUIRED',
    );
  }

  const parsed = assertSafeTestDatabaseUrl(dedicated.trim());
  const url = parsed.toString();

  process.env.DATABASE_URL = url;
  process.env.DATABASE_DIRECT_URL = url;
  process.env[SACDIA_TEST_DATABASE_URL_ENV] = url;
  installIsolatedProcessEnv();
  return url;
}

export function installIsolatedProcessEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.EMAIL_ENABLED = 'false';
  process.env.REDIS_URL = '';
  process.env.BETTER_AUTH_SECRET =
    process.env.BETTER_AUTH_SECRET &&
    process.env.BETTER_AUTH_SECRET.length >= 32
      ? process.env.BETTER_AUTH_SECRET
      : 'test-better-auth-secret-32chars!!';
  process.env.QR_JWT_SECRET =
    process.env.QR_JWT_SECRET &&
    process.env.QR_JWT_SECRET.length >= 32 &&
    process.env.QR_JWT_SECRET !== process.env.BETTER_AUTH_SECRET
      ? process.env.QR_JWT_SECRET
      : 'test-qr-jwt-secret-32-chars-xxxx';
  process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
  process.env.APPLE_CLIENT_ID ??= 'test.apple.client';
  process.env.APPLE_TEAM_ID ??= 'TESTTEAM01';
  process.env.APPLE_KEY_ID ??= 'TESTKEY01';
  process.env.APPLE_PRIVATE_KEY ??=
    '-----BEGIN PRIVATE KEY-----\nMIIBOgIBAAJBAK8=\n-----END PRIVATE KEY-----';
  process.env.R2_BUCKET_HONORS_PDF ??= 'test';
  process.env.R2_PUBLIC_URL_HONORS_PDF ??= DUMMY_R2;
  process.env.R2_BUCKET_EVIDENCE_FILES ??= 'test';
  process.env.R2_PUBLIC_URL_EVIDENCE_FILES ??= DUMMY_R2;
  process.env.R2_BUCKET_INSURANCE_EVIDENCE ??= 'test';
  process.env.R2_PUBLIC_URL_INSURANCE_EVIDENCE ??= DUMMY_R2;
  process.env.R2_BUCKET_DATA_EXPORTS ??= 'test';
  process.env.R2_PUBLIC_URL_DATA_EXPORTS ??= DUMMY_R2;
  process.env.R2_BUCKET_MONTHLY_REPORTS ??= 'test';
  process.env.R2_PUBLIC_URL_MONTHLY_REPORTS ??= DUMMY_R2;
  process.env.R2_BUCKET_RESOURCES_FILES ??= 'test';
  process.env.R2_PUBLIC_URL_RESOURCES_FILES ??= DUMMY_R2;
}

export async function withClient<T>(
  url: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function prepareAnnualCycleDatabase(): Promise<string> {
  const url = applyIsolatedTestDatabaseFromEnv();
  await resetAndApplySchema(url);
  return url;
}

async function resetAndApplySchema(url: string): Promise<void> {
  await withClient(url, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    await client.query('CREATE SCHEMA IF NOT EXISTS extensions');
    await client.query('CREATE SCHEMA IF NOT EXISTS auth');
    await client.query(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions',
    );
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await client.query(`
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT gen_random_uuid()
      $$ LANGUAGE sql
    `);
  });

  const script = execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
    ],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      maxBuffer: 80 * 1024 * 1024,
      env: {
        ...process.env,
        DATABASE_URL: url,
        DATABASE_DIRECT_URL: url,
      },
    },
  );

  await withClient(url, async (client) => {
    await client.query(script);
  });

  await seedRoles(url);
  await applySqlOnlyGuarantees(url);
}

async function seedRoles(url: string): Promise<void> {
  await withClient(url, async (client) => {
    await client.query(`
      INSERT INTO roles (role_name, description, role_category, active)
      VALUES
        ('director', 'Director', 'CLUB', true),
        ('deputy-director', 'Subdirector', 'CLUB', true),
        ('secretary', 'Secretario', 'CLUB', true),
        ('member', 'Miembro', 'CLUB', true),
        ('director-lf', 'Campo Local', 'GLOBAL', true)
      ON CONFLICT (role_name) DO NOTHING
    `);

    const director = await client.query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE role_name = 'director' AND role_category = 'CLUB'`,
    );
    const deputy = await client.query<{ role_id: string }>(
      `SELECT role_id FROM roles WHERE role_name = 'deputy-director' AND role_category = 'CLUB'`,
    );
    if (director.rows[0]) {
      await client.query(
        `INSERT INTO role_slot_limits (role_id, max_per_section)
         VALUES ($1, 1)
         ON CONFLICT (role_id) DO UPDATE SET max_per_section = 1`,
        [director.rows[0].role_id],
      );
    }
    if (deputy.rows[0]) {
      await client.query(
        `INSERT INTO role_slot_limits (role_id, max_per_section)
         VALUES ($1, 2)
         ON CONFLICT (role_id) DO UPDATE SET max_per_section = 2`,
        [deputy.rows[0].role_id],
      );
    }

    await client.query(`
      INSERT INTO permissions (permission_name, description, active)
      VALUES
        ('club_members:approve', 'Inscribir miembros', true),
        ('club_roles:assign', 'Asignar cargos', true),
        ('registration:complete', 'Completar registro', true),
        ('users:read_detail', 'Ver usuario', true),
        ('classes:read', 'Leer clases', true),
        ('classes:update', 'Escribir progreso', true),
        ('classes:submit_progress', 'Enviar progreso', true)
      ON CONFLICT (permission_name) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id, active)
      SELECT r.role_id, p.permission_id, true
      FROM roles r
      JOIN permissions p ON p.permission_name IN (
        'club_members:approve',
        'club_roles:assign',
        'users:read_detail',
        'classes:read',
        'classes:update',
        'classes:submit_progress'
      )
      WHERE r.role_name = 'director' AND r.role_category = 'CLUB'
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id, active)
      SELECT r.role_id, p.permission_id, true
      FROM roles r
      JOIN permissions p ON p.permission_name IN (
        'registration:complete',
        'classes:read',
        'classes:submit_progress'
      )
      WHERE r.role_name = 'member' AND r.role_category = 'CLUB'
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO role_permissions (role_id, permission_id, active)
      SELECT r.role_id, p.permission_id, true
      FROM roles r
      JOIN permissions p ON p.permission_name = 'club_roles:assign'
      WHERE r.role_name = 'director-lf' AND r.role_category = 'GLOBAL'
      ON CONFLICT (role_id, permission_id) DO NOTHING
    `);
  });
}

async function applySqlOnlyGuarantees(url: string): Promise<void> {
  const directorSlots = readFileSync(
    join(
      BACKEND_ROOT,
      'prisma/migrations/20260908180000_director_year_slots/migration.sql',
    ),
    'utf8',
  );
  const annualCycle = readFileSync(
    join(
      BACKEND_ROOT,
      'prisma/migrations/20260909120000_annual_membership_cycle/migration.sql',
    ),
    'utf8',
  );
  const successionOpen = readFileSync(
    join(
      BACKEND_ROOT,
      'prisma/migrations/20260909130000_director_succession_open_unique/migration.sql',
    ),
    'utf8',
  );

  await withClient(url, async (client) => {
    await client.query(extractDoBlock(directorSlots));
    await client.query(extractTriggerSql(directorSlots));
    await client.query(extractDoBlock(annualCycle));
    await client.query(successionOpen);
  });
}

function extractDoBlock(sql: string): string {
  const match = sql.match(/DO \$\$[\s\S]*?END \$\$;/);
  if (!match) {
    throw new Error('migration DO block missing');
  }
  return match[0];
}

function extractTriggerSql(sql: string): string {
  const fn = sql.indexOf('CREATE OR REPLACE FUNCTION enforce_club_role_slot_limits');
  if (fn < 0) {
    throw new Error('slot-limit trigger missing');
  }
  return sql.slice(fn);
}

export type AnnualCycleFixture = {
  yearPrev: number;
  yearCurrent: number;
  clubId: number;
  cqSectionId: number;
  gmSectionId: number;
  foreignClubId: number;
  foreignSectionId: number;
  localFieldId: number;
  foreignFieldId: number;
  cqClassId: number;
  gmClassId: number;
  nextCqClassId: number;
};

export async function seedAnnualCycleFixture(
  url: string,
  mode: 'year-cut' | 'operational' = 'year-cut',
): Promise<AnnualCycleFixture> {
  return withClient(url, async (client) => {
    await client.query(`
      INSERT INTO countries (name, abbreviation, active)
      VALUES ('México Test', 'MX-T', true)
    `);
    const country = await client.query<{ country_id: number }>(
      `SELECT country_id FROM countries WHERE abbreviation = 'MX-T'`,
    );
    await client.query(`
      INSERT INTO divisions (code, name, abbreviation, active)
      VALUES ('DIV-T', 'División Test', 'DVT', true)
      ON CONFLICT (code) DO NOTHING
    `);
    const division = await client.query<{ division_id: number }>(
      `SELECT division_id FROM divisions WHERE code = 'DIV-T'`,
    );
    await client.query(
      `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
       VALUES ('Unión Test', 'UNT', true, $1, $2)`,
      [country.rows[0].country_id, division.rows[0].division_id],
    );
    const union = await client.query<{ union_id: number }>(
      `SELECT union_id FROM unions WHERE abbreviation = 'UNT'`,
    );
    await client.query(
      `INSERT INTO local_fields (name, abbreviation, active, union_id, timezone)
       VALUES
         ('Campo Norte Test', 'CNT', true, $1, 'America/Mexico_City'),
         ('Campo Ajeno Test', 'CAT', true, $1, 'America/Mexico_City')`,
      [union.rows[0].union_id],
    );
    const fields = await client.query<{
      local_field_id: number;
      abbreviation: string;
    }>(`SELECT local_field_id, abbreviation FROM local_fields`);
    const localFieldId = fields.rows.find((r) => r.abbreviation === 'CNT')!
      .local_field_id;
    const foreignFieldId = fields.rows.find((r) => r.abbreviation === 'CAT')!
      .local_field_id;

    await client.query(
      `INSERT INTO districts (name, active, local_field_id)
       VALUES ('Distrito Test', true, $1), ('Distrito Ajeno', true, $2)`,
      [localFieldId, foreignFieldId],
    );
    const districts = await client.query<{
      districlub_type_id: number;
      name: string;
    }>(`SELECT districlub_type_id, name FROM districts`);
    const districtId = districts.rows.find((r) => r.name === 'Distrito Test')!
      .districlub_type_id;
    const foreignDistrictId = districts.rows.find(
      (r) => r.name === 'Distrito Ajeno',
    )!.districlub_type_id;

    await client.query(
      `INSERT INTO churches (name, active, districlub_type_id)
       VALUES ('Iglesia Test', true, $1), ('Iglesia Ajena', true, $2)`,
      [districtId, foreignDistrictId],
    );
    const churches = await client.query<{ church_id: number; name: string }>(
      `SELECT church_id, name FROM churches`,
    );
    const churchId = churches.rows.find((r) => r.name === 'Iglesia Test')!
      .church_id;
    const foreignChurchId = churches.rows.find(
      (r) => r.name === 'Iglesia Ajena',
    )!.church_id;

    await client.query(`
      INSERT INTO club_types (name, active)
      VALUES
        ('Aventureros', true),
        ('Conquistadores', true),
        ('Guías Mayores', true)
      ON CONFLICT (name) DO NOTHING
    `);
    const types = await client.query<{ club_type_id: number; name: string }>(
      `SELECT club_type_id, name FROM club_types`,
    );
    const cqType = types.rows.find((r) => r.name === 'Conquistadores')!
      .club_type_id;
    const gmType = types.rows.find((r) => r.name === 'Guías Mayores')!
      .club_type_id;

    await client.query(
      `INSERT INTO clubs (name, active, local_field_id, church_id, coordinates, districlub_type_id)
       VALUES
         ('Club Norte', true, $1, $2, '{"lat":0,"lng":0}', $3),
         ('Club Ajeno', true, $4, $5, '{"lat":0,"lng":0}', $6)`,
      [
        localFieldId,
        churchId,
        districtId,
        foreignFieldId,
        foreignChurchId,
        foreignDistrictId,
      ],
    );
    const clubs = await client.query<{ club_id: number; name: string }>(
      `SELECT club_id, name FROM clubs`,
    );
    const clubId = clubs.rows.find((r) => r.name === 'Club Norte')!.club_id;
    const foreignClubId = clubs.rows.find((r) => r.name === 'Club Ajeno')!
      .club_id;

    await client.query(
      `INSERT INTO club_sections (active, club_type_id, main_club_id)
       VALUES (true, $1, $3), (true, $2, $3), (true, $2, $4)`,
      [cqType, gmType, clubId, foreignClubId],
    );
    const sections = await client.query<{
      club_section_id: number;
      club_type_id: number;
      main_club_id: number;
    }>(
      `SELECT club_section_id, club_type_id, main_club_id FROM club_sections`,
    );
    const cqSectionId = sections.rows.find(
      (r) => r.club_type_id === cqType && r.main_club_id === clubId,
    )!.club_section_id;
    const gmSectionId = sections.rows.find(
      (r) => r.club_type_id === gmType && r.main_club_id === clubId,
    )!.club_section_id;
    const foreignSectionId = sections.rows.find(
      (r) => r.main_club_id === foreignClubId,
    )!.club_section_id;

    await client.query(`
      INSERT INTO ecclesiastical_years (start_date, end_date, active)
      VALUES
        ('2025-01-01', '2025-12-31', false),
        ('2026-01-01', '2026-12-31', true)
    `);
    const years = await client.query<{ year_id: number; start_date: string }>(
      `SELECT year_id, start_date::text FROM ecclesiastical_years ORDER BY start_date`,
    );
    const yearPrev = years.rows[0].year_id;
    const yearCurrent = years.rows[1].year_id;

    await client.query(
      `INSERT INTO classes (name, active, club_type_id, minimum_age, display_order, asset_code)
       VALUES
         ('Amigo', true, $1, 10, 10, 'CQ-01'),
         ('Compañero', true, $1, 11, 20, 'CQ-02'),
         ('GM-01', true, $2, 16, 10, 'GM-01')`,
      [cqType, gmType],
    );
    const classes = await client.query<{ class_id: number; asset_code: string }>(
      `SELECT class_id, asset_code FROM classes`,
    );
    const cqClassId = classes.rows.find((r) => r.asset_code === 'CQ-01')!
      .class_id;
    const nextCqClassId = classes.rows.find((r) => r.asset_code === 'CQ-02')!
      .class_id;
    const gmClassId = classes.rows.find((r) => r.asset_code === 'GM-01')!
      .class_id;

    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.gmDirector,
      'gm.dir@test.local',
      'Ana',
      'Director',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.cqDirector,
      'cq.dir@test.local',
      'Luis',
      'Pérez',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.gmSuccessor,
      'gm.suc@test.local',
      'Marta',
      'Sucesora',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.returnedMember,
      'ret@test.local',
      'Luis',
      'Pérez Soto',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.foreignLfAdmin,
      'lf.ajeno@test.local',
      'Campo',
      'Ajeno',
      foreignFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.ownerGhost,
      'ghost@test.local',
      'Nora',
      'Ghost',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.lfScheduler,
      'lf@test.local',
      'Campo',
      'Local',
      localFieldId,
    );
    await insertUser(
      client,
      ANNUAL_CYCLE_IDS.cqContinuing,
      'cq.cont@test.local',
      'Carla',
      'Continúa',
      localFieldId,
    );

    const directorRole = await roleId(client, 'director');
    const memberRole = await roleId(client, 'member');
    const lfRole = await roleId(client, 'director-lf');

    await client.query(
      `INSERT INTO users_roles (user_id, role_id, active)
       VALUES ($1, $2, true), ($3, $2, true)
       ON CONFLICT (user_id, role_id) DO NOTHING`,
      [ANNUAL_CYCLE_IDS.lfScheduler, lfRole, ANNUAL_CYCLE_IDS.foreignLfAdmin],
    );

    await client.query(
      `INSERT INTO enrollments
        (user_id, class_id, ecclesiastical_year_id, investiture_status, active)
       VALUES ($1, $2, $3, 'INVESTIDO', true)`,
      [ANNUAL_CYCLE_IDS.cqDirector, gmClassId, yearPrev],
    );
    await client.query(
      `INSERT INTO enrollments
        (user_id, class_id, ecclesiastical_year_id, investiture_status, active)
       VALUES ($1, $2, $3, 'INVESTIDO', true)`,
      [ANNUAL_CYCLE_IDS.returnedMember, gmClassId, yearPrev],
    );
    await client.query(
      `INSERT INTO enrollments
        (user_id, class_id, ecclesiastical_year_id, investiture_status, active)
       VALUES ($1, $2, $3, 'IN_PROGRESS', true)`,
      [ANNUAL_CYCLE_IDS.returnedMember, cqClassId, yearPrev],
    );
    await client.query(
      `INSERT INTO enrollments
        (user_id, class_id, ecclesiastical_year_id, investiture_status, active)
       VALUES ($1, $2, $3, 'IN_PROGRESS', true)`,
      [ANNUAL_CYCLE_IDS.cqContinuing, cqClassId, yearPrev],
    );

    if (mode === 'year-cut') {
      await client.query(
        `INSERT INTO club_role_assignments
          (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, end_date, active, status)
         VALUES
           ($1, $2, $3, $4, '2025-01-01', '2025-12-31', true, 'active'),
           ($5, $2, $6, $4, '2025-01-01', '2025-12-31', true, 'active'),
           ($7, $8, $3, $4, '2025-01-01', '2025-12-31', true, 'active')`,
        [
          ANNUAL_CYCLE_IDS.cqDirector,
          directorRole,
          cqSectionId,
          yearPrev,
          ANNUAL_CYCLE_IDS.gmDirector,
          gmSectionId,
          ANNUAL_CYCLE_IDS.returnedMember,
          memberRole,
        ],
      );

      await client.query(
        `INSERT INTO director_succession_plans (
           club_section_id, outgoing_assignment_id, successor_user_id,
           target_ecclesiastical_year_id, effective_date, status,
           scheduled_by_id, scheduled_by_role, scheduled_local_field_id,
           idempotency_key, request_hash, version
         )
         SELECT
           $1, assignment_id, $2, $3, '2026-01-01', 'scheduled',
           $4, 'director-lf', $5, 'gm-2026-plan', $6, 1
         FROM club_role_assignments
         WHERE user_id = $7 AND ecclesiastical_year_id = $8 AND status = 'active'
           AND club_section_id = $9
         LIMIT 1`,
        [
          gmSectionId,
          ANNUAL_CYCLE_IDS.gmSuccessor,
          yearCurrent,
          ANNUAL_CYCLE_IDS.lfScheduler,
          localFieldId,
          'a'.repeat(64),
          ANNUAL_CYCLE_IDS.gmDirector,
          yearPrev,
          gmSectionId,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO club_role_assignments
          (user_id, role_id, club_section_id, ecclesiastical_year_id, start_date, end_date, active, status)
         VALUES
           ($1, $2, $3, $4, '2026-01-01', NULL, true, 'active'),
           ($5, $6, $3, $4, '2026-01-01', NULL, true, 'inactive'),
           ($7, $6, $3, $4, '2026-01-01', NULL, true, 'inactive'),
           ($8, $2, $9, $10, '2025-01-01', '2025-12-31', true, 'ended'),
           ($8, $2, $9, $4, '2026-01-01', NULL, true, 'active'),
           ($11, $6, $9, $4, '2026-01-01', NULL, true, 'inactive'),
           ($11, $6, $9, $10, '2025-01-01', '2025-12-31', true, 'ended')`,
        [
          ANNUAL_CYCLE_IDS.gmDirector,
          directorRole,
          gmSectionId,
          yearCurrent,
          ANNUAL_CYCLE_IDS.returnedMember,
          memberRole,
          ANNUAL_CYCLE_IDS.ownerGhost,
          ANNUAL_CYCLE_IDS.cqDirector,
          cqSectionId,
          yearPrev,
          ANNUAL_CYCLE_IDS.cqContinuing,
        ],
      );
    }

    return {
      yearPrev,
      yearCurrent,
      clubId,
      cqSectionId,
      gmSectionId,
      foreignClubId,
      foreignSectionId,
      localFieldId,
      foreignFieldId,
      cqClassId,
      gmClassId,
      nextCqClassId,
    };
  });
}

async function insertUser(
  client: Client,
  userId: string,
  email: string,
  name: string,
  last: string,
  localFieldId: number,
): Promise<void> {
  await client.query(
    `INSERT INTO users (user_id, email, name, paternal_last_name, active, approval_status, local_field_id)
     VALUES ($1, $2, $3, $4, true, 'approved', $5)`,
    [userId, email, name, last, localFieldId],
  );
}

async function roleId(client: Client, name: string): Promise<string> {
  const result = await client.query<{ role_id: string }>(
    `SELECT role_id FROM roles WHERE role_name = $1`,
    [name],
  );
  return result.rows[0].role_id;
}

const ANNUAL_CYCLE_BETTER_AUTH_MOCK = {
  signInWithPassword: jest.fn(),
  refreshSession: jest.fn(),
  signOut: jest.fn().mockResolvedValue(undefined),
  createUser: jest.fn(),
  signJwt: jest.fn().mockReturnValue('fake-jwt'),
  resetPasswordForEmail: jest.fn(),
  updatePasswordById: jest.fn(),
  getOAuthUrl: jest.fn(),
  handleOAuthCallback: jest.fn(),
  enrollTotp: jest.fn(),
  verifyTotp: jest.fn(),
  disableTotp: jest.fn(),
  hasTotpEnabled: jest.fn().mockResolvedValue({ enabled: false }),
};

export type AnnualCycleClock = { now: () => Date };

/**
 * Carga AppModule con require() (Jest CJS) solo después de
 * `prepareAnnualCycleDatabase()`. No usar en tests de URL.
 */
export async function bootstrapAnnualCycleApp(clock?: AnnualCycleClock) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ValidationPipe } = require('@nestjs/common');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Test } = require('@nestjs/testing');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../../src/app.module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BetterAuthService } = require('../../src/better-auth/better-auth.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { YearCutCronService } = require('../../src/year-cut/year-cut-cron.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CLOCK } = require('../../src/common/clock/clock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SystemClockService } = require('../../src/common/clock/system-clock.service');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaService } = require('../../src/prisma/prisma.service');

  const resolvedClock = clock ?? { now: () => YEAR_CUT_NOW };

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(BetterAuthService)
    .useValue(ANNUAL_CYCLE_BETTER_AUTH_MOCK)
    .overrideProvider(YearCutCronService)
    .useValue({
      onModuleInit: async () => undefined,
      handleYearCut: async () => undefined,
    })
    .overrideProvider(SystemClockService)
    .useValue(resolvedClock)
    .overrideProvider(CLOCK)
    .useValue(resolvedClock)
    .compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    clock: resolvedClock,
  };
}
