import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { Client } from 'pg';
import type { AuthorizationSnapshot } from '../src/common/services/authorization-context.service';
import { ErrorCode } from '../src/common/errors/error-codes';
import {
  DistrictInvestiturePastorService,
  INVESTITURE_PASTOR_QUOTA_LOCK,
} from '../src/classes/district-investiture-pastors.service';
import {
  prepareAnnualCycleDatabase,
  withClient,
} from './helpers/annual-cycle-db.helper';

jest.setTimeout(180000);

const PASTOR_A = '11111111-1111-4111-8111-111111111111';
const PASTOR_B = '22222222-2222-4222-8222-222222222222';
const PASTOR_C = '33333333-3333-4333-8333-333333333333';

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
    let value = trimmed.slice('SACDIA_TEST_DATABASE_URL='.length).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
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

function snapshot(options: {
  role: string;
  localFieldId?: number;
}): AuthorizationSnapshot {
  return {
    grants: {
      global_roles: [{ role_name: options.role, permissions: [], scope: {} }],
      club_assignments: [],
      direct_permissions: [],
    },
    active_assignment: { assignment_id: null },
    effective: {
      permissions: [],
      scope: {
        global: {
          ...(options.localFieldId === undefined
            ? {}
            : {
                local_field: {
                  id: options.localFieldId,
                  name: 'Campo',
                },
              }),
        },
        club: null,
      },
    },
  };
}

describe('district investiture pastors on isolated PostgreSQL', () => {
  let url: string;
  let pool: pg.Pool;
  let prisma: PrismaClient;
  let service: DistrictInvestiturePastorService;
  let districtId: number;
  let localFieldId: number;

  beforeAll(async () => {
    ensureTestDatabaseUrl();
    try {
      url = await prepareAnnualCycleDatabase();
    } catch (error) {
      throw scrub(error);
    }
    try {
      const seeded = await withClient(url, async (client) => {
        const country = await client.query<{ country_id: number }>(
          `INSERT INTO countries (name, abbreviation, active)
           VALUES ('P3 Pais', 'P3', true)
           RETURNING country_id`,
        );
        const division = await client.query<{ division_id: number }>(
          `INSERT INTO divisions (code, name, abbreviation, active)
           VALUES ('P3', 'P3 Division', 'P3', true)
           RETURNING division_id`,
        );
        const union = await client.query<{ union_id: number }>(
          `INSERT INTO unions (name, abbreviation, active, country_id, division_id)
           VALUES ('P3 Union', 'P3U', true, $1, $2)
           RETURNING union_id`,
          [country.rows[0].country_id, division.rows[0].division_id],
        );
        const field = await client.query<{ local_field_id: number }>(
          `INSERT INTO local_fields (name, abbreviation, active, union_id)
           VALUES ('P3 Campo', 'P3F', true, $1)
           RETURNING local_field_id`,
          [union.rows[0].union_id],
        );
        const district = await client.query<{ districlub_type_id: number }>(
          `INSERT INTO districts (name, active, local_field_id)
           VALUES ('P3 Distrito', true, $1)
           RETURNING districlub_type_id`,
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
        for (const [userId, email, name, paternal] of [
          [PASTOR_A, 'pastor-a@p3.test', 'Ana', 'Pérez'],
          [PASTOR_B, 'pastor-b@p3.test', 'Beto', 'Lara'],
          [PASTOR_C, 'pastor-c@p3.test', 'Carlos', null],
        ] as const) {
          await client.query(
            `INSERT INTO users (user_id, email, name, paternal_last_name, active)
             VALUES ($1, $2, $3, $4, true)`,
            [userId, email, name, paternal],
          );
          await client.query(
            `INSERT INTO users_roles (user_id, role_id, active)
             VALUES ($1, $2, true)`,
            [userId, role.rows[0].role_id],
          );
        }
        return {
          districtId: district.rows[0].districlub_type_id,
          localFieldId: field.rows[0].local_field_id,
        };
      });
      districtId = seeded.districtId;
      localFieldId = seeded.localFieldId;
      pool = new pg.Pool({ connectionString: url, max: 6 });
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
  });

  function fieldActor(): AuthorizationSnapshot {
    return snapshot({ role: 'director-lf', localFieldId });
  }

  function rootActor(): AuthorizationSnapshot {
    return snapshot({ role: 'super-admin' });
  }

  async function holdLock(): Promise<{
    release: () => Promise<void>;
    pid: number;
  }> {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [INVESTITURE_PASTOR_QUOTA_LOCK],
    );
    const pid = await client.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    );
    return {
      pid: pid.rows[0].pid,
      release: async () => {
        await client.query('COMMIT');
        await client.end();
      },
    };
  }

  async function waitForAdvisoryWaiter(holderPid: number): Promise<void> {
    const observer = new Client({ connectionString: url });
    await observer.connect();
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const waiting = await observer.query(
          `SELECT pid
           FROM pg_locks
           WHERE locktype = 'advisory'
             AND NOT granted
             AND pid <> $1
           LIMIT 1`,
          [holderPid],
        );
        if ((waiting.rowCount ?? 0) > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        'la operación no quedó esperando un candado advisory en pg_locks',
      );
    } finally {
      await observer.end();
    }
  }

  async function effectiveSlots(): Promise<number> {
    const row = await prisma.investiture_pastor_quota.findUnique({
      where: { quota_id: 1 },
      select: { slots: true },
    });
    return row?.slots ?? 2;
  }

  async function activeCount(): Promise<number> {
    return prisma.district_investiture_pastors.count({
      where: { districlub_type_id: districtId, active: true },
    });
  }

  async function runWhileHeld(
    first: () => Promise<unknown>,
    second: () => Promise<unknown>,
  ) {
    const holder = await holdLock();
    let released = false;
    const releaseOnce = async () => {
      if (released) {
        return;
      }
      released = true;
      await holder.release();
    };
    const firstPromise = first();
    void firstPromise.catch(() => undefined);
    let secondPromise: Promise<unknown> = Promise.resolve();
    try {
      await waitForAdvisoryWaiter(holder.pid);
      let secondSettled = false;
      secondPromise = second().finally(() => {
        secondSettled = true;
      });
      void secondPromise.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(secondSettled).toBe(false);
      await releaseOnce();
      return await Promise.allSettled([firstPromise, secondPromise]);
    } catch (error) {
      await releaseOnce().catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise]);
      throw scrub(error);
    }
  }

  it('lists the pastors with their real name and email', async () => {
    await service.assign(fieldActor(), districtId, PASTOR_A, PASTOR_C);
    await service.assign(fieldActor(), districtId, PASTOR_C, PASTOR_A);

    const listed = await service.list(fieldActor(), districtId);

    expect(listed.pastors).toEqual([
      expect.objectContaining({
        user_id: PASTOR_A,
        user_name: 'Ana Pérez',
        email: 'pastor-a@p3.test',
        can_authorize: true,
      }),
      expect.objectContaining({
        user_id: PASTOR_C,
        user_name: 'Carlos',
        email: 'pastor-c@p3.test',
        can_authorize: true,
      }),
    ]);
  });

  describe('candidate search', () => {
    const EXTRA_PREFIX = 'aaaa0000-0000-4000-8000-0000000000';
    const INACTIVE = 'bbbb0000-0000-4000-8000-000000000001';
    const NO_ROLE = 'bbbb0000-0000-4000-8000-000000000002';
    const INACTIVE_ROLE = 'bbbb0000-0000-4000-8000-000000000003';
    const MIXED_CASE = 'bbbb0000-0000-4000-8000-000000000004';

    async function pastorRoleId(): Promise<string> {
      const role = await prisma.roles.findFirstOrThrow({
        where: { role_name: 'pastor', role_category: 'GLOBAL' },
        select: { role_id: true },
      });
      return role.role_id;
    }

    async function seedUser(
      id: string,
      name: string,
      options: { active?: boolean; role?: 'active' | 'inactive' | 'none' } = {},
    ): Promise<void> {
      await prisma.users.create({
        data: {
          user_id: id,
          email: `${name.toLowerCase().replace(/\s+/g, '.')}.${id.slice(-4)}@cand.test`,
          name,
          active: options.active ?? true,
        },
      });
      const role = options.role ?? 'active';
      if (role !== 'none') {
        await prisma.users_roles.create({
          data: {
            user_id: id,
            role_id: await pastorRoleId(),
            active: role === 'active',
          },
        });
      }
    }

    afterEach(async () => {
      const ids = await prisma.users.findMany({
        where: { email: { endsWith: '@cand.test' } },
        select: { user_id: true },
      });
      const list = ids.map((row) => row.user_id);
      await prisma.users_roles.deleteMany({ where: { user_id: { in: list } } });
      await prisma.users.deleteMany({ where: { user_id: { in: list } } });
    });

    it('finds only active accounts with the active pastor role, ignoring case, by name, surname or email', async () => {
      await seedUser(MIXED_CASE, 'ANA Mayúscula');
      await seedUser(INACTIVE, 'Ana Cuenta Inactiva', { active: false });
      await seedUser(NO_ROLE, 'Ana Sin Rol', { role: 'none' });
      await seedUser(INACTIVE_ROLE, 'Ana Rol Inactivo', { role: 'inactive' });

      const byName = await service.searchCandidates(fieldActor(), 'aNa');
      expect(byName.map((row) => row.user_id).sort()).toEqual(
        [PASTOR_A, MIXED_CASE].sort(),
      );
      expect(byName.find((row) => row.user_id === PASTOR_A)).toEqual({
        user_id: PASTOR_A,
        user_name: 'Ana Pérez',
        email: 'pastor-a@p3.test',
      });

      const bySurname = await service.searchCandidates(fieldActor(), 'pérez');
      expect(bySurname.map((row) => row.user_id)).toEqual([PASTOR_A]);

      const byFullName = await service.searchCandidates(
        fieldActor(),
        'ana pérez',
      );
      expect(byFullName.map((row) => row.user_id)).toEqual([PASTOR_A]);

      const byEmail = await service.searchCandidates(
        fieldActor(),
        'PASTOR-B@P3',
      );
      expect(byEmail.map((row) => row.user_id)).toEqual([PASTOR_B]);
    });

    it('applies the same rule that decides who can authorize', async () => {
      await seedUser(INACTIVE, 'Zeta Inactiva', { active: false });
      await seedUser(NO_ROLE, 'Zeta Sin Rol', { role: 'none' });
      await seedUser(INACTIVE_ROLE, 'Zeta Rol Inactivo', { role: 'inactive' });
      expect(await service.searchCandidates(fieldActor(), 'zeta')).toEqual([]);
    });

    it('caps the result at 20 and treats % and _ as plain text', async () => {
      for (let index = 0; index < 25; index += 1) {
        await seedUser(
          EXTRA_PREFIX + String(index).padStart(2, '0'),
          'Lote Masivo ' + String(index).padStart(2, '0'),
        );
      }
      expect(
        await service.searchCandidates(fieldActor(), 'masivo'),
      ).toHaveLength(20);
      expect(await service.searchCandidates(fieldActor(), '%%%')).toEqual([]);
      expect(await service.searchCandidates(fieldActor(), '___')).toEqual([]);
      expect(await service.searchCandidates(fieldActor(), '\\\\\\')).toEqual(
        [],
      );
      await seedUser(MIXED_CASE, 'Sub_rayado 100%');
      await seedUser(INACTIVE, 'Subxrayado 1000');
      expect(
        (await service.searchCandidates(fieldActor(), 'sub_rayado')).map(
          (row) => row.user_id,
        ),
      ).toEqual([MIXED_CASE]);
      expect(
        (await service.searchCandidates(fieldActor(), '100%')).map(
          (row) => row.user_id,
        ),
      ).toEqual([MIXED_CASE]);
    });

    it('rejects roles that cannot assign', async () => {
      await expect(
        service.searchCandidates(snapshot({ role: 'admin' }), 'ana'),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });
  });

  it('reads the default cap without inserting a row', async () => {
    const view = await service.getQuota(fieldActor());
    expect(view).toEqual({ slots: 2, configured: false, can_edit: false });
    expect(await prisma.investiture_pastor_quota.count()).toBe(0);
  });

  it.each([true, false])(
    'a quota reduction waits and does not leave more pastors than slots (row: %s)',
    async (withQuotaRow) => {
      if (withQuotaRow) {
        await prisma.investiture_pastor_quota.create({
          data: { quota_id: 1, slots: 2 },
        });
      }
      await prisma.district_investiture_pastors.create({
        data: {
          districlub_type_id: districtId,
          user_id: PASTOR_A,
          active: true,
        },
      });

      const [lowered, assigned] = await runWhileHeld(
        () => service.updateQuota(rootActor(), 1, PASTOR_C),
        () => service.assign(fieldActor(), districtId, PASTOR_B, PASTOR_C),
      );

      expect(lowered.status).toBe('fulfilled');
      expect(assigned.status).toBe('rejected');
      if (assigned.status === 'rejected') {
        expect(assigned.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL,
        });
      }
      expect(await activeCount()).toBe(1);
      expect(await effectiveSlots()).toBe(1);
      expect(await activeCount()).toBeLessThanOrEqual(await effectiveSlots());
    },
  );

  it.each([true, false])(
    'an assign waits and a later reduction to zero cannot pass under it (row: %s)',
    async (withQuotaRow) => {
      if (withQuotaRow) {
        await prisma.investiture_pastor_quota.create({
          data: { quota_id: 1, slots: 2 },
        });
      }

      const [assigned, lowered] = await runWhileHeld(
        () => service.assign(fieldActor(), districtId, PASTOR_A, PASTOR_C),
        () => service.updateQuota(rootActor(), 0, PASTOR_C),
      );

      expect(assigned.status).toBe('fulfilled');
      expect(lowered.status).toBe('rejected');
      if (lowered.status === 'rejected') {
        expect(lowered.reason).toMatchObject({
          code: ErrorCode.INVESTITURE_PASTOR_QUOTA_BELOW_ASSIGNMENTS,
        });
      }
      expect(await activeCount()).toBe(1);
      expect(await effectiveSlots()).toBe(2);
      const stored = await prisma.investiture_pastor_quota.findUnique({
        where: { quota_id: 1 },
      });
      expect(stored?.slots ?? null).toBe(withQuotaRow ? 2 : null);
    },
  );

  it('keeps one pastor when two assigns race for the last slot', async () => {
    await prisma.investiture_pastor_quota.create({
      data: { quota_id: 1, slots: 1 },
    });
    const results = await Promise.allSettled([
      service.assign(fieldActor(), districtId, PASTOR_A, PASTOR_C),
      service.assign(fieldActor(), districtId, PASTOR_B, PASTOR_C),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected && rejected.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
    expect(await activeCount()).toBe(1);
    expect(await effectiveSlots()).toBe(1);
  });

  it('keeps one pastor when a reactivation races a new assign for the last slot', async () => {
    await prisma.investiture_pastor_quota.create({
      data: { quota_id: 1, slots: 1 },
    });
    await prisma.district_investiture_pastors.create({
      data: {
        districlub_type_id: districtId,
        user_id: PASTOR_A,
        active: false,
      },
    });
    const results = await Promise.allSettled([
      service.assign(fieldActor(), districtId, PASTOR_A, PASTOR_C),
      service.assign(fieldActor(), districtId, PASTOR_B, PASTOR_C),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(
      rejected && rejected.status === 'rejected' ? rejected.reason : null,
    ).toMatchObject({ code: ErrorCode.INVESTITURE_PASTOR_QUOTA_FULL });
    expect(await activeCount()).toBe(1);
    expect(await effectiveSlots()).toBe(1);
  });
});
