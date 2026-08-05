import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Client, Pool } from 'pg';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { DirectorSuccessionActivationService } from './director-succession-activation.service';

const databaseUrl = process.env.P0_R03_TEST_DATABASE_URL;
const allowDatabase = process.env.ALLOW_P0_R03_TEST_DB === '1';
if (allowDatabase !== Boolean(databaseUrl))
  throw new Error('P0_R03_DATABASE_CONFIG_MUST_BE_COUPLED');
const assertLocal = (value: string) => {
  const host = new Client({ connectionString: value }).connectionParameters.host;
  const parsed = new URL(value);
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host) || host === '/tmp';
  const safe =
    parsed.search === '' || parsed.searchParams.toString() === 'host=%2Ftmp';
  if (!local || !safe) throw new Error('P0_R03_DATABASE_MUST_BE_LOCAL');
};
if (databaseUrl) assertLocal(databaseUrl);
const pgDescribe = allowDatabase && databaseUrl ? describe : describe.skip;

const U = {
  out: '11111111-1111-4111-8111-111111111111',
  suc: '22222222-2222-4222-8222-222222222222',
  sch: '33333333-3333-4333-8333-333333333333',
  role: '44444444-4444-4444-8444-444444444444',
  asg: '55555555-5555-4555-8555-555555555555',
  plan: '66666666-6666-4666-8666-666666666666',
};
const now = new Date('2026-10-02T12:00:00.000Z');
const effective = new Date('2026-10-01T00:00:00.000Z');
const schema = `r03_${randomBytes(6).toString('hex')}`;
let pool: Pool;
type QErr = { code?: unknown; message?: unknown };
const mapPg = (e: unknown) => {
  const c = (e as QErr)?.code;
  if (c === '23505') return { code: 'P2002' };
  if (c === '40001' || c === '40P01') return { code: 'P2034' };
  return e;
};
const one = async (c: Client, text: string, values: unknown[]) =>
  (await c.query(text, values)).rows[0] ?? null;

const txAdapter = (client: Client) => ({
  $queryRaw: async (q: Prisma.Sql) =>
    (await client.query(q.text, q.values as unknown[])).rows,
  director_succession_plans: {
    update: async ({
      where,
      data,
    }: {
      where: { succession_id: string };
      data: Record<string, unknown>;
    }) => {
      const inc = (data.attempt_count as { increment?: number } | undefined)?.increment;
      if (inc)
        return one(
          client,
          `UPDATE director_succession_plans SET processing_token=$2,last_attempt_at=$3,attempt_count=attempt_count+$4
           WHERE succession_id=$1 RETURNING succession_id`,
          [where.succession_id, data.processing_token, data.last_attempt_at, inc],
        );
      return one(
        client,
        `UPDATE director_succession_plans SET status=$2::director_succession_status_enum,
           activated_assignment_id=$3,activated_at=$4,processing_token=$5,processing_expires_at=$6
         WHERE succession_id=$1 RETURNING succession_id`,
        [
          where.succession_id, data.status, data.activated_assignment_id,
          data.activated_at, data.processing_token, data.processing_expires_at,
        ],
      );
    },
  },
  club_role_assignments: {
    findUnique: async ({ where }: { where: { assignment_id: string } }) => {
      const row = await one(
        client,
        `SELECT a.assignment_id,a.user_id,a.club_section_id,a.role_id,a.active,r.role_name
         FROM club_role_assignments a JOIN roles r USING(role_id) WHERE a.assignment_id=$1`,
        [where.assignment_id],
      );
      return row ? { ...row, roles: { role_name: row.role_name } } : null;
    },
    update: async ({
      where, data,
    }: { where: { assignment_id: string }; data: Record<string, unknown> }) =>
      one(
        client,
        `UPDATE club_role_assignments SET active=$2,status=$3,end_date=$4,modified_at=$5
         WHERE assignment_id=$1 RETURNING assignment_id,user_id`,
        [where.assignment_id, data.active, data.status, data.end_date, data.modified_at],
      ),
    create: async ({ data }: { data: Record<string, unknown> }) =>
      one(
        client,
        `INSERT INTO club_role_assignments(assignment_id,user_id,role_id,ecclesiastical_year_id,start_date,active,status,club_section_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING assignment_id,user_id`,
        [randomUUID(), data.user_id, data.role_id, data.ecclesiastical_year_id, data.start_date, data.active, data.status, data.club_section_id],
      ),
    count: async ({ where }: { where: Record<string, unknown> }) => {
      const notId = (where.assignment_id as { not?: string } | undefined)?.not;
      const row = await one(
        client,
        `SELECT COUNT(*)::int AS n FROM club_role_assignments
         WHERE club_section_id=$1 AND role_id=$2 AND active=$3 AND ($4::uuid IS NULL OR assignment_id<>$4)`,
        [where.club_section_id, where.role_id, where.active, notId ?? null],
      );
      return row?.n ?? 0;
    },
  },
  roles: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      one(client, `SELECT role_id FROM roles WHERE role_name=$1 AND role_category=$2 AND active=$3 LIMIT 1`,
        [where.role_name, where.role_category, where.active]),
  },
  authorization_context_versions: {
    upsert: async ({
      where, create, update,
    }: {
      where: { user_id: string };
      create: { version: bigint };
      update: { version: { increment: number } };
    }) => {
      const row = await one(
        client,
        `INSERT INTO authorization_context_versions(user_id,version) VALUES($1,$2)
         ON CONFLICT(user_id) DO UPDATE SET version=authorization_context_versions.version+$3 RETURNING version`,
        [where.user_id, create.version, update.version.increment],
      );
      return { version: BigInt(row.version) };
    },
  },
  audit_logs: {
    findUnique: async ({ where }: { where: { event_key: string } }) => {
      const row = await one(
        client,
        `SELECT audit_log_id,entity_type,entity_id,action,event_key,club_id,summary,actor_user_id,actor_kind,
          actor_role_name,actor_scope,target_user_id,target_scope,effective_at,correlation_id,idempotency_key,result,changes
         FROM audit_logs WHERE event_key=$1`,
        [where.event_key],
      );
      return row ? { ...row, audit_log_id: BigInt(row.audit_log_id) } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      try {
        const row = await one(
          client,
          `INSERT INTO audit_logs(entity_type,entity_id,action,event_key,club_id,summary,actor_user_id,actor_kind,
             actor_role_name,actor_scope,target_user_id,target_scope,effective_at,correlation_id,idempotency_key,result,changes)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16,$17::jsonb) RETURNING audit_log_id`,
          [
            data.entity_type, data.entity_id, data.action, data.event_key, data.club_id ?? null, data.summary ?? null,
            data.actor_user_id, data.actor_kind, data.actor_role_name, JSON.stringify(data.actor_scope),
            data.target_user_id, JSON.stringify(data.target_scope), data.effective_at ?? null,
            data.correlation_id ?? null, data.idempotency_key ?? null, data.result, JSON.stringify(data.changes),
          ],
        );
        return { audit_log_id: BigInt(row.audit_log_id) };
      } catch (error) {
        if ((error as QErr).code === '23505')
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'fixture' });
        throw new Prisma.PrismaClientUnknownRequestError(String((error as QErr).message), { clientVersion: 'fixture' });
      }
    },
  },
});

class PgDatabase {
  constructor(private readonly root: Pool) {}
  director_succession_plans = {
    findMany: async ({ where }: { where: { status: string; effective_date: { lte: Date } } }) => {
      const client = await this.root.connect();
      try {
        await client.query(`SET search_path=${schema},public`);
        return (await client.query(
          `SELECT succession_id FROM director_succession_plans
           WHERE status=$1::director_succession_status_enum AND effective_date<=$2::date
           ORDER BY effective_date ASC LIMIT 50`,
          [where.status, where.effective_date.lte],
        )).rows;
      } finally { client.release(); }
    },
  };
  async $transaction<T>(work: (tx: ReturnType<typeof txAdapter>) => Promise<T>) {
    const client = await this.root.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL search_path=${schema},public`);
      const result = await work(txAdapter(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapPg(error);
    } finally { client.release(); }
  }
}

const svc = () => {
  const db = new PgDatabase(pool);
  return new DirectorSuccessionActivationService(
    db as never, new CriticalAuditWriterService(), new AuthorizationContextVersionService(db as never),
  );
};
const q = async (text: string, values: unknown[] = []) => {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path=${schema},public`);
    return client.query(text, values);
  } finally { client.release(); }
};
const seed = async () => {
  await q(`TRUNCATE club_role_assignments,director_succession_plans,audit_logs,authorization_context_versions RESTART IDENTITY`);
  await q(
    `INSERT INTO club_role_assignments(assignment_id,user_id,role_id,ecclesiastical_year_id,start_date,active,status,club_section_id)
     VALUES($1,$2,$3,2025,'2025-10-01',true,'active',11)`, [U.asg, U.out, U.role],
  );
  await q(
    `INSERT INTO director_succession_plans(succession_id,club_section_id,outgoing_assignment_id,successor_user_id,
       target_ecclesiastical_year_id,effective_date,status,scheduled_by_id,scheduled_by_role,scheduled_local_field_id)
     VALUES($1,11,$2,$3,2026,$4::date,'scheduled',$5,'union_admin',7)`,
    [U.plan, U.asg, U.suc, effective, U.sch],
  );
};

it('rejects unsafe destination', () =>
  expect(() => assertLocal('postgresql://localhost/postgres?host=db.example.invalid')).toThrow());

pgDescribe('DirectorSuccessionActivationService PostgreSQL', () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.query(`SET search_path=${schema},public;
        CREATE TYPE director_succession_status_enum AS ENUM ('scheduled','activated','blocked','cancelled');
        CREATE TABLE roles(role_id UUID PRIMARY KEY,role_name TEXT NOT NULL,role_category TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT true);
        CREATE TABLE club_role_assignments(assignment_id UUID PRIMARY KEY,user_id UUID NOT NULL,role_id UUID NOT NULL,ecclesiastical_year_id INT,start_date DATE,end_date DATE,active BOOLEAN NOT NULL DEFAULT true,status TEXT NOT NULL DEFAULT 'active',club_section_id INT NOT NULL,modified_at TIMESTAMPTZ);
        CREATE TABLE director_succession_plans(succession_id UUID PRIMARY KEY,club_section_id INT NOT NULL,outgoing_assignment_id UUID NOT NULL,successor_user_id UUID NOT NULL,target_ecclesiastical_year_id INT NOT NULL,effective_date DATE NOT NULL,status director_succession_status_enum NOT NULL DEFAULT 'scheduled',scheduled_by_id UUID NOT NULL,scheduled_by_role VARCHAR(64) NOT NULL,scheduled_local_field_id INT NOT NULL,activated_assignment_id UUID UNIQUE,activated_at TIMESTAMPTZ,blocked_at TIMESTAMPTZ,block_code VARCHAR(96),processing_token UUID,processing_expires_at TIMESTAMPTZ,attempt_count INT NOT NULL DEFAULT 0,last_attempt_at TIMESTAMPTZ,version INT NOT NULL DEFAULT 1);
        CREATE TABLE audit_logs(audit_log_id BIGSERIAL PRIMARY KEY,entity_type VARCHAR(50) NOT NULL,entity_id VARCHAR(64) NOT NULL,action VARCHAR(64) NOT NULL,event_key VARCHAR(160) UNIQUE,club_id INT,summary VARCHAR(500),actor_user_id UUID,actor_kind VARCHAR(24) NOT NULL,actor_role_name VARCHAR(64),actor_scope JSONB,target_user_id UUID,target_scope JSONB,effective_at TIMESTAMPTZ,correlation_id UUID,idempotency_key VARCHAR(128),result VARCHAR(32) NOT NULL,changes JSONB,created_at TIMESTAMPTZ DEFAULT now());
        CREATE TABLE authorization_context_versions(user_id UUID PRIMARY KEY,version BIGINT NOT NULL DEFAULT 0);`);
      pool = new Pool({ connectionString: databaseUrl });
      await q(`INSERT INTO roles VALUES($1,'director','CLUB',true)`, [U.role]);
    } catch (error) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      throw error;
    } finally { await admin.end(); }
  });
  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  beforeEach(async () => {
    await seed();
  });

  it('serializes two concurrent activators to one transition and one audit', async () => {
    const settled = await Promise.allSettled([svc().activateDue(now), svc().activateDue(now)]);
    const ok = settled.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ activated: number }>[];
    expect(ok.reduce((n, r) => n + r.value.activated, 0)).toBe(1);
    expect(settled.some((r) => r.status === 'rejected')).toBe(false);
    expect((await q(
      `SELECT user_id FROM club_role_assignments WHERE club_section_id=11 AND role_id=$1 AND active`, [U.role],
    )).rows).toEqual([{ user_id: U.suc }]);
    expect((await q(`SELECT action FROM audit_logs WHERE event_key=$1`,
      [`director-succession.activated:${U.plan}`])).rows)
      .toEqual([{ action: 'DIRECTOR_SUCCESSION_ACTIVATED' }]);
  });

  it('replays activateDue without duplicating roles or audits', async () => {
    expect(await svc().activateDue(now)).toEqual({ activated: 1 });
    expect(await svc().activateDue(now)).toEqual({ activated: 0 });
    expect((await q(
      `SELECT user_id FROM club_role_assignments WHERE club_section_id=11 AND role_id=$1 AND active`, [U.role],
    )).rows).toEqual([{ user_id: U.suc }]);
    expect((await q('SELECT 1 FROM audit_logs')).rows).toHaveLength(1);
  });

  it('does not mutate roles or write audit for a blocked plan', async () => {
    await q(
      `UPDATE director_succession_plans SET status='blocked',blocked_at=$2,block_code='PRECONDITION_FAILED' WHERE succession_id=$1`,
      [U.plan, now],
    );
    expect(await svc().activateDue(now)).toEqual({ activated: 0 });
    expect((await q(
      `SELECT status::text AS status,activated_assignment_id FROM director_succession_plans WHERE succession_id=$1`, [U.plan],
    )).rows[0]).toEqual({ status: 'blocked', activated_assignment_id: null });
    expect((await q(
      `SELECT active,status FROM club_role_assignments WHERE assignment_id=$1`, [U.asg],
    )).rows[0]).toEqual({ active: true, status: 'active' });
    expect((await q('SELECT 1 FROM audit_logs')).rows).toHaveLength(0);
  });
});
