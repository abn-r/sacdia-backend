import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Client, Pool } from 'pg';
import { CriticalAuditWriterService } from '../audit-logs/critical-audit-writer.service';
import { ErrorCode } from '../common/errors/error-codes';
import { ExactSuperAdminWritePolicy } from './exact-super-admin-write.policy';
import { GlobalUserRoleWriteService } from './global-user-role-write.service';
const databaseUrl = process.env.P0_BE13B2_TEST_DATABASE_URL;
const allowDatabase = process.env.ALLOW_P0_BE13B2_TEST_DB === '1';
if (allowDatabase !== Boolean(databaseUrl))
  throw new Error('P0_BE13B2_DATABASE_CONFIG_MUST_BE_COUPLED');
const assertLocalDatabaseUrl = (value: string) => {
  const parsed = new URL(value);
  const host = new Client({ connectionString: value }).connectionParameters
    .host;
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host) || host === '/tmp';
  const safeParams =
    parsed.search === '' || parsed.searchParams.toString() === 'host=%2Ftmp';
  if (!local || !safeParams)
    throw new Error('P0_BE13B2_DATABASE_MUST_BE_LOCAL');
};
if (databaseUrl) assertLocalDatabaseUrl(databaseUrl);
const pgDescribe = allowDatabase && databaseUrl ? describe : describe.skip;
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const role = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const peer = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const superRole = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const users = [actor, target, peer];
const schema = `be13b2_${randomBytes(6).toString('hex')}`;
let pool: Pool;
let transactionStarted: (() => void) | undefined;
type Fault = { sqlState: '23505' | '40001'; remaining: number };
type QueryError = { code?: unknown; message?: unknown };
type WriteArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};
const mapPg = (error: unknown) => {
  const code = (error as QueryError)?.code;
  if (code === '23505') return { code: 'P2002' };
  if (code === '40001' || code === '40P01') return { code: 'P2034' };
  return error;
};
const one = async (client: Client, text: string, values: unknown[]) =>
  (await client.query(text, values)).rows[0] ?? null;
const txAdapter = (client: Client) => ({
  $queryRaw: (query: Prisma.Sql) => {
    const pending = client.query(query.text, query.values);
    transactionStarted?.();
    transactionStarted = undefined;
    return pending;
  },
  users: {
    findUnique: async ({ where }: { where: { user_id: string } }) =>
      one(client, 'SELECT 1 FROM users WHERE user_id=$1', [where.user_id]),
  },
  roles: {
    findUnique: async ({ where }: { where: { role_id: string } }) =>
      one(
        client,
        'SELECT role_name,role_category,active FROM roles WHERE role_id=$1',
        [where.role_id],
      ),
  },
  users_roles: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.roles)
        return one(
          client,
          `SELECT ur.user_role_id FROM users_roles ur JOIN roles r USING(role_id)
             WHERE ur.user_id=$1 AND ur.active AND r.role_name='super-admin'
             AND r.role_category='GLOBAL' AND r.active LIMIT 1`,
          [where.user_id],
        );
      return one(
        client,
        'SELECT user_role_id,active FROM users_roles WHERE user_id=$1 AND role_id=$2 LIMIT 1',
        [where.user_id, where.role_id],
      );
    },
    create: async ({ data }: { data: Record<string, unknown> }) =>
      one(
        client,
        `INSERT INTO users_roles(user_role_id,user_id,role_id)
           VALUES($1,$2,$3) RETURNING user_role_id`,
        [randomUUID(), data.user_id, data.role_id],
      ),
    update: async ({ where, data }: WriteArgs) =>
      one(
        client,
        `UPDATE users_roles SET active=$2,modified_at=$3
           WHERE user_role_id=$1 RETURNING user_role_id`,
        [where.user_role_id, data.active, data.modified_at],
      ),
  },
  audit_logs: {
    findUnique: async ({ where }: { where: { event_key: string } }) =>
      one(client, 'SELECT * FROM audit_logs WHERE event_key=$1', [
        where.event_key,
      ]),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      try {
        const values = [
          data.entity_type,
          data.entity_id,
          data.action,
          data.event_key,
          data.actor_user_id,
          data.actor_kind,
          data.actor_role_name,
          JSON.stringify(data.actor_scope),
          data.target_user_id,
          JSON.stringify(data.target_scope),
          data.correlation_id,
          data.idempotency_key,
          data.result,
          JSON.stringify(data.changes),
        ];
        return (
          await client.query(
            `INSERT INTO audit_logs(entity_type,entity_id,action,event_key,
             actor_user_id,actor_kind,actor_role_name,actor_scope,target_user_id,
             target_scope,correlation_id,idempotency_key,result,changes)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14::jsonb)
             RETURNING audit_log_id`,
            values,
          )
        ).rows[0];
      } catch (error) {
        throw new Prisma.PrismaClientUnknownRequestError(
          String((error as QueryError).message),
          { clientVersion: 'fixture' },
        );
      }
    },
  },
});
class PgDatabase {
  attempts = 0;
  constructor(private readonly fault?: Fault) {}
  async $transaction<T>(
    work: (tx: ReturnType<typeof txAdapter>) => Promise<T>,
    options: { isolationLevel: string },
  ) {
    const client = await pool.connect();
    this.attempts += 1;
    try {
      const level = options.isolationLevel.replace(/([a-z])([A-Z])/g, '$1 $2');
      await client.query(`BEGIN ISOLATION LEVEL ${level}`);
      await client.query(`SET LOCAL search_path=${schema},public`);
      if (this.fault && this.fault.remaining-- > 0) {
        if (this.fault.sqlState === '23505')
          await client.query(
            "INSERT INTO tx_faults VALUES('duplicate'),('duplicate')",
          );
        else
          await client.query(
            "DO $$BEGIN RAISE EXCEPTION 'serialization' USING ERRCODE='40001'; END$$",
          );
      }
      const result = await work(txAdapter(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw mapPg(error);
    } finally {
      client.release();
    }
  }
}
const service = (fault?: Fault) => {
  const database = new PgDatabase(fault);
  return {
    database,
    service: new GlobalUserRoleWriteService(
      database as never,
      new ExactSuperAdminWritePolicy({} as never),
      new CriticalAuditWriterService(),
    ),
  };
};
const input = (overrides: Record<string, string> = {}) => ({
  actorUserId: actor.toUpperCase(),
  targetUserId: target.toUpperCase(),
  roleId: role.toUpperCase(),
  correlationId: randomUUID(),
  idempotencyKey: randomUUID(),
  ...overrides,
});
const createSchema = async (name: string, fail = false) => {
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${name}`);
    await admin.query(`SET search_path=${name},public;
      CREATE TABLE users(user_id UUID PRIMARY KEY);
      CREATE TABLE roles(role_id UUID PRIMARY KEY,role_name TEXT NOT NULL,role_category TEXT NOT NULL,active BOOLEAN NOT NULL DEFAULT true);
      CREATE TABLE users_roles(user_role_id UUID PRIMARY KEY,user_id UUID NOT NULL,role_id UUID NOT NULL,active BOOLEAN NOT NULL DEFAULT true,modified_at TIMESTAMPTZ,UNIQUE(user_id,role_id));
      CREATE TABLE audit_logs(audit_log_id BIGSERIAL PRIMARY KEY,entity_type VARCHAR(50) NOT NULL,entity_id VARCHAR(64) NOT NULL,action VARCHAR(64) NOT NULL,event_key VARCHAR(160) UNIQUE,
        club_id INT,summary VARCHAR(500),actor_user_id UUID,actor_kind VARCHAR(24) NOT NULL,actor_role_name VARCHAR(64),actor_scope JSONB,target_user_id UUID,target_scope JSONB,
        effective_at TIMESTAMPTZ,correlation_id UUID,idempotency_key VARCHAR(128),result VARCHAR(32) NOT NULL,changes JSONB,created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE tx_faults(fault_key TEXT PRIMARY KEY);
      CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.idempotency_key='audit-fail' THEN RAISE EXCEPTION 'audit rejected' USING ERRCODE='23514'; END IF; RETURN NEW; END$$;
      CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_audit();`);
    if (fail) throw new Error('INTENTIONAL_SETUP_FAILURE');
  } catch (error) {
    await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);
    throw error;
  } finally {
    await admin.end();
  }
};
const query = async (text: string, values: unknown[] = []) => {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path=${schema},public`);
    return await client.query(text, values);
  } finally {
    client.release();
  }
};
const rows = async (text: string, values: unknown[] = []) =>
  (await query(text, values)).rows;
it.each([
  'postgresql://localhost/postgres?host=db.example.invalid',
  'postgresql://localhost/postgres?options=-csearch_path%3Dpublic',
  'postgresql:///postgres?host=/tmp&host=/tmp',
])(
  'rejects unsafe effective destination or parameters without connecting',
  (url) => expect(() => assertLocalDatabaseUrl(url)).toThrow(),
);
pgDescribe('GlobalUserRoleWriteService PostgreSQL fixture', () => {
  beforeAll(async () => {
    await createSchema(schema);
    pool = new Pool({ connectionString: databaseUrl });
    await query('INSERT INTO users VALUES($1),($2),($3)', users);
    await query(
      `INSERT INTO roles VALUES($1,'admin','GLOBAL',true),($2,'super-admin','GLOBAL',true)`,
      [role, superRole],
    );
  });
  beforeEach(async () => {
    await query('TRUNCATE users_roles,audit_logs,tx_faults RESTART IDENTITY');
    await query(
      'INSERT INTO users_roles VALUES($1,$2,$3,true),($4,$5,$3,true)',
      [randomUUID(), actor, superRole, randomUUID(), peer],
    );
  });
  afterAll(async () => {
    if (pool) await pool.end();
    const admin = new Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  it('replays concurrent assign and revoke exactly once with canonical UUIDs', async () => {
    const assign = input({ idempotencyKey: 'assign-replay' });
    const results = await Promise.all([
      service().service.assign(assign),
      service().service.assign(assign),
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    await query(
      'UPDATE users_roles SET active=true WHERE user_id=$1 AND role_id=$2',
      [target, role],
    );
    const revoke = input({ idempotencyKey: 'revoke-replay' });
    const revoked = await Promise.all([
      service().service.revoke(revoke),
      service().service.revoke(revoke),
    ]);
    expect(revoked.filter((result) => result.replayed)).toHaveLength(1);
    expect(
      await rows(
        'SELECT user_id,active FROM users_roles WHERE user_id=$1 AND role_id=$2',
        [target, role],
      ),
    ).toEqual([{ user_id: target, active: false }]);
    const audits = await rows(
      'SELECT actor_user_id,target_user_id,target_scope FROM audit_logs',
    );
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      actor_user_id: actor,
      target_user_id: target,
      target_scope: { role_id: role },
    });
  });
  it('returns stable 409 for operation or payload reuse and keeps one audit', async () => {
    const original = input({ idempotencyKey: 'incompatible' });
    await service().service.assign(original);
    for (const incompatible of [
      () => service().service.revoke(original),
      () => service().service.assign({ ...original, targetUserId: peer }),
    ])
      await expect(incompatible()).rejects.toMatchObject({
        code: ErrorCode.IDEMPOTENCY_KEY_REUSED,
        status: 409,
      });
    expect(await rows('SELECT * FROM audit_logs')).toHaveLength(1);
  });
  it('orders inverse actor/target locks without an A-to-B/B-to-A deadlock', async () => {
    await expect(
      Promise.all([
        service().service.assign(
          input({ targetUserId: peer, idempotencyKey: 'a-to-b' }),
        ),
        service().service.assign(
          input({
            actorUserId: peer,
            targetUserId: actor,
            idempotencyKey: 'b-to-a',
          }),
        ),
      ]),
    ).resolves.toHaveLength(2);
  });
  it('revalidates authority after a concurrent revocation commits', async () => {
    const revoker = await pool.connect();
    await revoker.query('BEGIN');
    await revoker.query(`SET LOCAL search_path=${schema},public`);
    await revoker.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`rbac-user:${actor}`],
    );
    await revoker.query(
      'UPDATE users_roles SET active=false WHERE user_id=$1 AND role_id=$2',
      [actor, superRole],
    );
    const waiting = new Promise<void>(
      (resolve) => (transactionStarted = resolve),
    );
    const blocked = service().service.assign(
      input({ idempotencyKey: 'authority-race' }),
    );
    await waiting;
    await revoker.query('COMMIT');
    revoker.release();
    await expect(blocked).rejects.toMatchObject({
      code: ErrorCode.SUPER_ADMIN_WRITE_REQUIRED,
    });
    expect(await rows('SELECT * FROM audit_logs')).toEqual([]);
  });
  it('keeps missing revoke rowless and rolls back mutation when audit fails', async () => {
    await expect(
      service().service.revoke(input({ idempotencyKey: 'missing' })),
    ).resolves.toMatchObject({ changed: false });
    const targetRole =
      'SELECT * FROM users_roles WHERE user_id=$1 AND role_id=$2';
    expect(await rows(targetRole, [target, role])).toEqual([]);
    await expect(
      service().service.assign(input({ idempotencyKey: 'audit-fail' })),
    ).rejects.toMatchObject({ code: ErrorCode.AUDIT_WRITE_FAILED });
    expect(await rows(targetRole, [target, role])).toEqual([]);
    expect(
      await rows("SELECT * FROM audit_logs WHERE idempotency_key='audit-fail'"),
    ).toEqual([]);
  });
  it.each(['23505', '40001'] as const)(
    'maps SQLSTATE %s and retries the real transaction',
    async (sqlState) => {
      const fixture = service({ sqlState, remaining: 1 });
      await expect(fixture.service.assign(input())).resolves.toMatchObject({
        active: true,
      });
      expect(fixture.database.attempts).toBe(2);
    },
  );
  it('maps exhausted serialization retries to stable 409', async () => {
    const fixture = service({ sqlState: '40001', remaining: 3 });
    await expect(fixture.service.assign(input())).rejects.toMatchObject({
      code: ErrorCode.RECORD_CONFLICT,
      status: 409,
    });
    expect(fixture.database.attempts).toBe(3);
  });
  it('removes its scratch schema when setup fails', async () => {
    const doomed = `be13b2_fail_${randomBytes(6).toString('hex')}`;
    await expect(createSchema(doomed, true)).rejects.toThrow(
      'INTENTIONAL_SETUP_FAILURE',
    );
    await expect(
      pool.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [doomed]),
    ).resolves.toMatchObject({ rows: [] });
  });
});
