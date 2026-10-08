import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import type { AuthorizationSnapshot } from '../src/common/services/authorization-context.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import { DistrictInvestiturePastorService } from '../src/classes/district-investiture-pastors.service';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const PASTOR_A = 'a1000000-0000-4000-8000-000000000001';
const PASTOR_B = 'a1000000-0000-4000-8000-000000000002';
const PASTOR_C = 'a1000000-0000-4000-8000-000000000003';
const PASTOR_D = 'a1000000-0000-4000-8000-000000000004';
const ALL_PASTORS = [PASTOR_A, PASTOR_B, PASTOR_C, PASTOR_D];

const MIGRATION_SQL_PATH = join(
  __dirname,
  '../prisma/migrations/20261008120000_district_pastor_field_change/migration.sql',
);

function ensureTestDatabaseUrl(): void {
  if (process.env.SACDIA_TEST_DATABASE_URL?.trim()) {
    return;
  }
  let text: string;
  try {
    text = readFileSync(join(__dirname, '../.env.test.local'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('SACDIA_TEST_DATABASE_URL=')) {
      continue;
    }
    const value = trimmed
      .slice('SACDIA_TEST_DATABASE_URL='.length)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (value) {
      process.env.SACDIA_TEST_DATABASE_URL = value;
    }
    return;
  }
}

function scrub(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'database error';
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'));
}

function fieldActor(localFieldId: number): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [{ role_name: 'director-lf', permissions: [], scope: {} }],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          local_field: { id: localFieldId, name: 'Campo' },
        },
        club: null,
      },
    },
  };
}

describe('district pastor assignments follow the Field on isolated PostgreSQL', () => {
  let url: string;
  let pool: pg.Pool;
  let prisma: PrismaClient;
  let service: DistrictInvestiturePastorService;
  let fieldId: number;
  let otherFieldId: number;
  let districtId: number;
  let secondDistrictId: number;

  beforeAll(async () => {
    ensureTestDatabaseUrl();
    try {
      url = await prepareAnnualCycleDatabase();
      const seeded = await withClient(url, async (client) => {
        const country = await client.query<{ country_id: number }>(
          `INSERT INTO countries (name, abbreviation, active)
           VALUES ('PF Pais', 'PF', true) RETURNING country_id`,
        );
        const division = await client.query<{ division_id: number }>(
          `INSERT INTO divisions (code, name, abbreviation, active)
           VALUES ('PF', 'PF Division', 'PF', true) RETURNING division_id`,
        );
        const union = await client.query<{ union_id: number }>(
          `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
           VALUES ('PF Union', 'PFU', true, $1, $2) RETURNING union_id`,
          [country.rows[0].country_id, division.rows[0].division_id],
        );
        const field = await client.query<{ local_field_id: number }>(
          `INSERT INTO local_fields (name, abbreviation, active, union_id)
           VALUES ('PF Campo', 'PFA', true, $1) RETURNING local_field_id`,
          [union.rows[0].union_id],
        );
        const other = await client.query<{ local_field_id: number }>(
          `INSERT INTO local_fields (name, abbreviation, active, union_id)
           VALUES ('PF Campo otro', 'PFB', true, $1) RETURNING local_field_id`,
          [union.rows[0].union_id],
        );
        const district = await client.query<{ districlub_type_id: number }>(
          `INSERT INTO districts (name, active, local_field_id)
           VALUES ('PF Distrito', true, $1) RETURNING districlub_type_id`,
          [field.rows[0].local_field_id],
        );
        const second = await client.query<{ districlub_type_id: number }>(
          `INSERT INTO districts (name, active, local_field_id)
           VALUES ('PF Distrito 2', true, $1) RETURNING districlub_type_id`,
          [field.rows[0].local_field_id],
        );
        await client.query(
          `INSERT INTO roles (role_name, description, role_category, active)
           VALUES ('pastor', 'Pastor', 'GLOBAL', true)
           ON CONFLICT (role_name) DO NOTHING`,
        );
        const role = await client.query<{ role_id: string }>(
          `SELECT role_id FROM roles
           WHERE role_name = 'pastor' AND role_category = 'GLOBAL'`,
        );
        for (const [index, userId] of ALL_PASTORS.entries()) {
          await client.query(
            `INSERT INTO users (user_id, email, name, active, local_field_id)
             VALUES ($1, $2, $3, true, $4)`,
            [
              userId,
              `pastor-${index}@pf.test`,
              `Pastor ${index}`,
              field.rows[0].local_field_id,
            ],
          );
          await client.query(
            `INSERT INTO users_roles (user_id, role_id, active)
             VALUES ($1, $2, true)`,
            [userId, role.rows[0].role_id],
          );
        }
        return {
          fieldId: field.rows[0].local_field_id,
          otherFieldId: other.rows[0].local_field_id,
          districtId: district.rows[0].districlub_type_id,
          secondDistrictId: second.rows[0].districlub_type_id,
        };
      });
      fieldId = seeded.fieldId;
      otherFieldId = seeded.otherFieldId;
      districtId = seeded.districtId;
      secondDistrictId = seeded.secondDistrictId;
      pool = new pg.Pool({ connectionString: url, max: 4 });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
      service = new DistrictInvestiturePastorService(prisma as never);
    } catch (error) {
      throw scrub(error);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });

  beforeEach(async () => {
    await prisma.district_investiture_pastors.deleteMany();
    await prisma.investiture_pastor_quota.deleteMany();
    await prisma.districts.updateMany({ data: { local_field_id: fieldId } });
    await prisma.users.updateMany({
      where: { user_id: { in: ALL_PASTORS } },
      data: { local_field_id: fieldId },
    });
  });

  async function activeIds(forDistrict = districtId): Promise<string[]> {
    const rows = await prisma.district_investiture_pastors.findMany({
      where: { districlub_type_id: forDistrict, active: true },
      select: { user_id: true },
    });
    return rows.map((row) => row.user_id).sort();
  }

  async function seedRow(userId: string, forDistrict = districtId) {
    await prisma.district_investiture_pastors.create({
      data: { districlub_type_id: forDistrict, user_id: userId, active: true },
    });
  }

  it('drops the assignment and frees the slot when the pastor changes Field', async () => {
    await service.assign(fieldActor(fieldId), districtId, PASTOR_A, PASTOR_D);
    await service.assign(fieldActor(fieldId), districtId, PASTOR_B, PASTOR_D);
    // Quota (2) is full: a third pastor does not fit.
    await expect(
      service.assign(fieldActor(fieldId), districtId, PASTOR_C, PASTOR_D),
    ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });

    await prisma.users.update({
      where: { user_id: PASTOR_A },
      data: { local_field_id: otherFieldId },
    });

    expect(await activeIds()).toEqual([PASTOR_B]);
    const dropped = await prisma.district_investiture_pastors.findUniqueOrThrow(
      {
        where: {
          districlub_type_id_user_id: {
            districlub_type_id: districtId,
            user_id: PASTOR_A,
          },
        },
      },
    );
    expect(dropped.active).toBe(false);

    await service.assign(fieldActor(fieldId), districtId, PASTOR_C, PASTOR_D);
    expect(await activeIds()).toEqual([PASTOR_B, PASTOR_C].sort());

    // Reactivation stays governed by the same-Field rule.
    await expect(
      service.assign(fieldActor(fieldId), districtId, PASTOR_A, PASTOR_D),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_PASTOR_FIELD_MISMATCH,
    });
  });

  it('drops every district of the pastor, and only that pastor', async () => {
    await seedRow(PASTOR_A, districtId);
    await seedRow(PASTOR_A, secondDistrictId);
    await seedRow(PASTOR_B, districtId);

    await prisma.users.update({
      where: { user_id: PASTOR_A },
      data: { local_field_id: otherFieldId },
    });

    expect(await activeIds(districtId)).toEqual([PASTOR_B]);
    expect(await activeIds(secondDistrictId)).toEqual([]);
  });

  it('drops the assignment when the Field is cleared, as account deletion does', async () => {
    await seedRow(PASTOR_A);
    await seedRow(PASTOR_B);

    await prisma.users.update({
      where: { user_id: PASTOR_A },
      data: { local_field_id: null },
    });

    expect(await activeIds()).toEqual([PASTOR_B]);
  });

  it('leaves the assignment alone on unrelated user updates', async () => {
    await seedRow(PASTOR_A);
    const before = await prisma.district_investiture_pastors.findFirstOrThrow({
      where: { user_id: PASTOR_A },
    });

    await prisma.users.update({
      where: { user_id: PASTOR_A },
      data: { name: 'Otro nombre' },
    });
    await prisma.users.update({
      where: { user_id: PASTOR_A },
      data: { local_field_id: fieldId },
    });

    const after = await prisma.district_investiture_pastors.findFirstOrThrow({
      where: { user_id: PASTOR_A },
    });
    expect(after.active).toBe(true);
    expect(after.modified_at.getTime()).toBe(before.modified_at.getTime());
  });

  it('drops the other-Field pastors when the district moves to another Field', async () => {
    await seedRow(PASTOR_A);
    await seedRow(PASTOR_B);
    await prisma.users.update({
      where: { user_id: PASTOR_C },
      data: { local_field_id: otherFieldId },
    });
    // Crossed legacy row: the pastor already lives in the destination Field.
    await seedRow(PASTOR_C);
    await seedRow(PASTOR_D, secondDistrictId);

    await prisma.districts.update({
      where: { districlub_type_id: districtId },
      data: { local_field_id: otherFieldId },
    });

    expect(await activeIds(districtId)).toEqual([PASTOR_C]);
    expect(await activeIds(secondDistrictId)).toEqual([PASTOR_D]);
  });

  it('leaves the pastors alone when a district update does not change its Field', async () => {
    await seedRow(PASTOR_A);
    await prisma.districts.update({
      where: { districlub_type_id: districtId },
      data: { name: 'PF Distrito renombrado' },
    });
    expect(await activeIds()).toEqual([PASTOR_A]);
  });

  it('backfills crossed active rows and is safe to run twice', async () => {
    await seedRow(PASTOR_A);
    await seedRow(PASTOR_B);
    // Crossed rows predate the triggers: write them with the Field changed
    // behind the trigger's back.
    await withClient(url, async (client) => {
      await client.query(`ALTER TABLE users DISABLE TRIGGER USER`);
      try {
        await client.query(
          `UPDATE users SET local_field_id = $1 WHERE user_id = $2`,
          [otherFieldId, PASTOR_A],
        );
        await client.query(
          `UPDATE users SET local_field_id = NULL WHERE user_id = $1`,
          [PASTOR_B],
        );
        await client.query(
          `UPDATE users SET local_field_id = $1 WHERE user_id = $2`,
          [fieldId, PASTOR_C],
        );
      } finally {
        await client.query(`ALTER TABLE users ENABLE TRIGGER USER`);
      }
    });
    await seedRow(PASTOR_C);
    expect(await activeIds()).toEqual([PASTOR_A, PASTOR_B, PASTOR_C].sort());

    const sql = readFileSync(MIGRATION_SQL_PATH, 'utf8');
    await withClient(url, (client) => client.query(sql));
    expect(await activeIds()).toEqual([PASTOR_C]);

    await withClient(url, (client) => client.query(sql));
    expect(await activeIds()).toEqual([PASTOR_C]);
  });
});
