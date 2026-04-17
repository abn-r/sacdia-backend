/**
 * folder-templates-ownership.integration.spec.ts
 *
 * Integration tests for the DB-level invariants on `folder_templates` introduced
 * by migration 20260415100000_folder_templates_polymorphic_owner (T-B1-1).
 *
 * These tests hit the real Neon dev database (DATABASE_URL from .env) and exercise:
 *   - folder_templates_exactly_one_owner_check  (CHECK constraint)
 *   - folder_templates_union_owner_unique       (partial unique index)
 *   - folder_templates_local_field_owner_unique (partial unique index)
 *
 * Tests match spec assertions C1-S1, C1-S3, C1-S4, C1-S5, C1-S6 + INV-4.
 *
 * Fixture anchors (stable rows in dev DB — do NOT delete these):
 *   union_id  1  → Unión Centroamericana del Sur
 *   union_id  2  → Unión Colombiana del Norte
 *   local_field_id 1 → Asociación Chontalpa      (union_id 20)
 *   local_field_id 2 → Asociación Norte de Veracruz (union_id 20)
 *   club_type_id   2 → Conquistadores
 *   ecclesiastical_year_id 1 → 2026
 *
 * Unions 1 and 2 have NO folder_templates in the dev DB so tests can create
 * and delete rows without touching production-like data.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

// ---------------------------------------------------------------------------
// Stable fixture IDs — referenced from the dev DB (do not create/delete them)
// ---------------------------------------------------------------------------
const UNION_A_ID = 1;   // Unión Centroamericana del Sur — has no templates in dev
const UNION_B_ID = 2;   // Unión Colombiana del Norte    — has no templates in dev
const LF_1_ID    = 1;   // Asociación Chontalpa (union_id 20)
const LF_2_ID    = 2;   // Asociación Norte de Veracruz (union_id 20)
const CLUB_TYPE  = 2;   // Conquistadores
const YEAR_ID    = 1;   // Ecclesiastical year 2026

// ---------------------------------------------------------------------------
// Prisma client — uses the same adapter pattern as the production PrismaService
// ---------------------------------------------------------------------------
let pool: pg.Pool;
let prisma: PrismaClient;

// Track IDs created during each test for cleanup
const createdIds: string[] = [];

beforeAll(() => {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

afterEach(async () => {
  // Clean up any rows created during the test
  if (createdIds.length > 0) {
    await prisma.folder_templates.deleteMany({
      where: { folder_template_id: { in: [...createdIds] } },
    });
    createdIds.length = 0;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTemplate(opts: {
  clubTypeId: number;
  yearId: number;
  ownerUnionId?: number | null;
  ownerLocalFieldId?: number | null;
}): Promise<string> {
  const row = await prisma.folder_templates.create({
    data: {
      name: `Test template ${Date.now()}`,
      club_type_id: opts.clubTypeId,
      ecclesiastical_year_id: opts.yearId,
      owner_union_id: opts.ownerUnionId ?? null,
      owner_local_field_id: opts.ownerLocalFieldId ?? null,
    },
    select: { folder_template_id: true },
  });
  createdIds.push(row.folder_template_id);
  return row.folder_template_id;
}

// ---------------------------------------------------------------------------
// C1-S1: Two unions, same type-year — both succeed
// ---------------------------------------------------------------------------
describe('C1-S1: Two unions owning the same type-year', () => {
  it('allows union A and union B to each own a Conquistadores 2026 template', async () => {
    const idA = await createTemplate({
      clubTypeId: CLUB_TYPE,
      yearId: YEAR_ID,
      ownerUnionId: UNION_A_ID,
    });

    const idB = await createTemplate({
      clubTypeId: CLUB_TYPE,
      yearId: YEAR_ID,
      ownerUnionId: UNION_B_ID,
    });

    const rows = await prisma.folder_templates.findMany({
      where: { folder_template_id: { in: [idA, idB] } },
      select: { folder_template_id: true, owner_union_id: true },
    });

    expect(rows).toHaveLength(2);
    const ownerIds = rows.map((r) => r.owner_union_id);
    expect(ownerIds).toContain(UNION_A_ID);
    expect(ownerIds).toContain(UNION_B_ID);
  });
});

// ---------------------------------------------------------------------------
// C1-S3: Reject template with no owner (CHECK violation)
// ---------------------------------------------------------------------------
describe('C1-S3: Template with no owner must be rejected', () => {
  it('throws a CHECK constraint violation when both owner fields are null', async () => {
    await expect(
      createTemplate({
        clubTypeId: CLUB_TYPE,
        yearId: YEAR_ID,
        ownerUnionId: null,
        ownerLocalFieldId: null,
      }),
    ).rejects.toThrow(/folder_templates_exactly_one_owner_check/);

    // No orphan row was created
    const count = await prisma.folder_templates.count({
      where: {
        club_type_id: CLUB_TYPE,
        ecclesiastical_year_id: YEAR_ID,
        owner_union_id: null,
        owner_local_field_id: null,
      },
    });
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C1-S4: Reject template with both owners set (CHECK violation)
// ---------------------------------------------------------------------------
describe('C1-S4: Template with both owners must be rejected', () => {
  it('throws a CHECK constraint violation when both owner_union_id and owner_local_field_id are set', async () => {
    await expect(
      createTemplate({
        clubTypeId: CLUB_TYPE,
        yearId: YEAR_ID,
        ownerUnionId: UNION_A_ID,
        ownerLocalFieldId: LF_1_ID,
      }),
    ).rejects.toThrow(/folder_templates_exactly_one_owner_check/);

    // Confirm nothing was inserted (createdIds is still empty at this point)
    // The helper pushes to createdIds only after successful create — so nothing to clean up.
    // Double-check the DB to be explicit:
    const rows = await prisma.folder_templates.findMany({
      where: {
        club_type_id: CLUB_TYPE,
        ecclesiastical_year_id: YEAR_ID,
        owner_union_id: UNION_A_ID,
        owner_local_field_id: LF_1_ID,
      },
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C1-S5: Reject duplicate union ownership (partial unique violation)
// ---------------------------------------------------------------------------
describe('C1-S5: Duplicate union ownership must be rejected', () => {
  it('throws a unique constraint violation when union A tries to own a second Conquistadores 2026 template', async () => {
    // First template for union A — must succeed
    await createTemplate({
      clubTypeId: CLUB_TYPE,
      yearId: YEAR_ID,
      ownerUnionId: UNION_A_ID,
    });

    // Second attempt for same (club_type, year, union) — must fail
    await expect(
      createTemplate({
        clubTypeId: CLUB_TYPE,
        yearId: YEAR_ID,
        ownerUnionId: UNION_A_ID,
      }),
    ).rejects.toThrow(/folder_templates_union_owner_unique|unique constraint/i);

    // Only one row exists for union A on this type-year
    const count = await prisma.folder_templates.count({
      where: {
        club_type_id: CLUB_TYPE,
        ecclesiastical_year_id: YEAR_ID,
        owner_union_id: UNION_A_ID,
      },
    });
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C1-S6: Two LFs in the same union (should succeed)
// INV-7: mutual exclusion union↔LF is enforced at RESOLUTION time, not creation.
// ---------------------------------------------------------------------------
describe('C1-S6: Two local fields in the same union can each own the same type-year template', () => {
  it('allows LF-1 and LF-2 (both in union 20) to coexist for Conquistadores 2026', async () => {
    // No pre-condition check needed: the partial unique index
    // folder_templates_local_field_owner_unique is on (owner_local_field_id, club_type_id,
    // ecclesiastical_year_id) WHERE owner_local_field_id IS NOT NULL. Union-owned rows
    // (owner_union_id IS NOT NULL, owner_local_field_id IS NULL) live under a separate
    // index and do not collide with LF-owned rows. INV-7 mutual exclusion is enforced
    // at resolution time, not creation time — two LFs in the same union can independently
    // own templates for the same (club_type, year) pair.

    const idL1 = await createTemplate({
      clubTypeId: CLUB_TYPE,
      yearId: YEAR_ID,
      ownerLocalFieldId: LF_1_ID,
    });

    const idL2 = await createTemplate({
      clubTypeId: CLUB_TYPE,
      yearId: YEAR_ID,
      ownerLocalFieldId: LF_2_ID,
    });

    const rows = await prisma.folder_templates.findMany({
      where: { folder_template_id: { in: [idL1, idL2] } },
      select: { folder_template_id: true, owner_local_field_id: true },
    });

    expect(rows).toHaveLength(2);
    const lfIds = rows.map((r) => r.owner_local_field_id);
    expect(lfIds).toContain(LF_1_ID);
    expect(lfIds).toContain(LF_2_ID);
  });
});
