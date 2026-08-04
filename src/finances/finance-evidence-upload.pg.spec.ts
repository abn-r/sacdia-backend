import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Client } from 'pg';
import { FinanceEvidenceUploadService } from './finance-evidence-upload.service';
import { FinanceLedgerAuthorizationAdapter } from './finance-ledger-authorization.adapter';

const hosts = new Set(['localhost', '127.0.0.1', '::1', '/tmp']);
const host = (value: string) =>
  value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
const resolveUrl = (
  value = process.env.FINANCE_LEDGER_INTEGRATION_DATABASE_URL,
  allowed = process.env.ALLOW_FINANCE_LEDGER_INTEGRATION_DB === '1',
) => {
  if (!allowed) return;
  if (!value) throw new Error('finance evidence PostgreSQL URL is required');
  const url = new URL(value),
    requested = url.searchParams.get('host');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !hosts.has(host(url.hostname)) ||
    url.searchParams.get('finance_ledger_scratch') !== '1' ||
    (requested && !hosts.has(host(requested)))
  )
    throw new Error('unsafe finance evidence PostgreSQL URL');
  url.searchParams.delete('finance_ledger_scratch');
  if (
    !hosts.has(
      host(
        new Client({ connectionString: url.toString() }).connectionParameters
          .host,
      ),
    )
  )
    throw new Error('unsafe effective finance evidence PostgreSQL host');
  return url.toString();
};
const url = resolveUrl(),
  dbIt = url ? it : it.skip,
  safetyIt = url ? it.skip : it;
const actor = '00000000-0000-4000-8000-000000000001',
  key = '00000000-0000-4000-8000-000000000002';
const input = {
  clubId: 1,
  clubSectionId: 7,
  mimeType: 'image/png' as const,
  fileSize: 10,
};
const sql = (name: string) =>
  readFileSync(
    join(process.cwd(), 'prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
const one = <T>(result: { rows: T[] }) => result.rows[0];
const deferred = () => {
  let release!: () => void, entered!: () => void;
  return {
    wait: new Promise<void>((resolve) => (release = resolve)),
    entered: new Promise<void>((resolve) => (entered = resolve)),
    release,
    enter: entered,
  };
};

// prettier-ignore
class Storage {
  readonly objects = new Map<string, { bytes: Buffer; mimeType: 'image/png'; etag: string }>(); issue = 0; headCalls = 0; get = 0; hold?: ReturnType<typeof deferred>;
  async issueCreateOnlyPut(value: any) { this.issue++; return { uploadUrl: `https://storage.invalid/${value.uploadId}`, expiresInSeconds: value.expiresInSeconds, requiredHeaders: { 'content-type': value.mimeType, 'if-none-match': '*' } }; }
  async head(value: any) { this.headCalls++; this.hold?.enter(); await this.hold?.wait; const object = this.objects.get(value.uploadId); return object && { etag: object.etag, size: object.bytes.length, mimeType: object.mimeType, metadata: { ...value, size: object.bytes.length } }; }
  async getStream(value: any) { this.get++; const object = this.objects.get(value.uploadId); if (!object || value.etag !== object.etag) throw new Error('etag mismatch'); return Readable.from([object.bytes.subarray(0, 8), object.bytes.subarray(8)]); }
  put(id: string, tail = 1) { this.objects.set(id, { bytes: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,tail,2]), mimeType: 'image/png', etag: '"fake-etag-v1"' }); }
  clear() { this.objects.clear(); this.hold?.release(); }
}

// prettier-ignore
class Db {
  writes: string[] = []; failAudit = false; advisory?: ReturnType<typeof deferred>; rowLock?: ReturnType<typeof deferred>; constructor(readonly client: Client) {}
  async $transaction<T>(fn: (tx: this) => Promise<T>) { await this.client.query('BEGIN'); try { const value = await fn(this); await this.client.query('COMMIT'); return value; } catch (error) { await this.client.query('ROLLBACK'); throw error; } }
  $executeRaw = async (query: any) => { const result = this.client.query(query.text, query.values); this.advisory?.enter(); return result; };
  $queryRaw = async (query: any) => { this.writes.push(query.text); const result = this.client.query(query.text, query.values); if (query.text.includes('FOR UPDATE')) this.rowLock?.enter(); return (await result).rows; };
  system_config = { findUnique: async ({ where: { config_key } }: any) => one(await this.client.query('SELECT * FROM system_config WHERE config_key=$1', [config_key])) };
  users = { findUnique: async ({ where: { user_id } }: any) => {
    const result = await this.client.query(`SELECT p.active_club_assignment_id,a.assignment_id,a.active assignment_active,a.status,r.role_name,r.active role_active,pe.permission_name,pe.active permission_active,rp.active grant_active,s.club_section_id,s.main_club_id FROM users u LEFT JOIN users_pr p USING(user_id) LEFT JOIN club_role_assignments a ON a.user_id=u.user_id AND a.active AND (a.status='active' OR a.status IS NULL) LEFT JOIN roles r ON r.role_id=a.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.role_id AND rp.active LEFT JOIN permissions pe ON pe.permission_id=rp.permission_id LEFT JOIN club_sections s ON s.club_section_id=a.club_section_id WHERE u.user_id=$1 ORDER BY a.start_date DESC,a.assignment_id ASC`, [user_id]);
    if (!result.rows.length) return null; const first = result.rows[0], assignments = new Map<string, any>();
    for (const row of result.rows) if (row.assignment_id) { const value = assignments.get(row.assignment_id) ?? { assignment_id: row.assignment_id, active: row.assignment_active, status: row.status, roles: { role_name: row.role_name, active: row.role_active, role_permissions: [] }, club_sections: { club_section_id: row.club_section_id, main_club_id: row.main_club_id } }; value.roles.role_permissions.push({ active: row.grant_active, permissions: { permission_name: row.permission_name, active: row.permission_active } }); assignments.set(row.assignment_id, value); }
    return { users_pr: { active_club_assignment_id: first.active_club_assignment_id }, club_role_assignments: [...assignments.values()] };
  }};
  finance_ledger_evidence_upload_intents = {
    create: async ({ data }: any) => { try { return one(await this.client.query(`INSERT INTO finance_ledger_evidence_upload_intents(actor_user_id,club_id,club_section_id,idempotency_key,request_hash,expected_mime_type,expected_file_size,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [data.actor_user_id,data.club_id,data.club_section_id,data.idempotency_key,data.request_hash,data.expected_mime_type,data.expected_file_size,data.expires_at])); } catch (error) { if ((error as any).code === '23505') (error as any).code = 'P2002'; throw error; } },
    update: async ({ where, data }: any) => { this.writes.push(JSON.stringify(data)); const fields = Object.keys(data); return one(await this.client.query(`UPDATE finance_ledger_evidence_upload_intents SET ${fields.map((field, index) => `"${field}"=$${index + 1}`).join(',')} WHERE finance_ledger_evidence_upload_intent_id=$${fields.length + 1} RETURNING *`, [...fields.map((field) => data[field]),where.finance_ledger_evidence_upload_intent_id])); },
  };
  finance_ledger_evidence = { create: async ({ data }: any) => { try { return one(await this.client.query(`INSERT INTO finance_ledger_evidence(club_section_id,storage_key,mime_type,file_size,content_sha256,created_by_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [data.club_section_id,data.storage_key,data.mime_type,data.file_size,data.content_sha256,data.created_by_id])); } catch (error) { if ((error as any).code === '23505') (error as any).code = 'P2002'; throw error; } } };
  audit_logs = { create: async ({ data }: any) => { if (this.failAudit && data.action === 'FINANCE_EVIDENCE_UPLOAD_COMPLETED') throw new Error('audit fault'); return this.client.query('INSERT INTO audit_logs(entity_type,entity_id,action,club_id,actor_user_id,changes) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [data.entity_type,data.entity_id,data.action,data.club_id,data.actor_user_id,JSON.stringify(data.changes)]); } };
}

const configure = (client: Client, schema: string) =>
  client.query(`SET TIME ZONE 'UTC'; SET search_path TO "${schema}"`);
// prettier-ignore
const setup = async () => {
  if (!url) throw new Error('explicit safe URL required'); const schema = `finance_evidence_upload_${randomBytes(6).toString('hex')}`, client = new Client({ connectionString: url }), storage = new Storage();
  try { await client.connect(); await client.query(`CREATE SCHEMA "${schema}";`); await configure(client, schema);
    await client.query(`CREATE TABLE users(user_id UUID PRIMARY KEY); CREATE TABLE users_pr(user_id UUID PRIMARY KEY REFERENCES users,user_pr_id UUID,active_club_assignment_id UUID); CREATE TABLE club_sections(club_section_id INT PRIMARY KEY,main_club_id INT); CREATE TABLE roles(role_id INT PRIMARY KEY,role_name TEXT,active BOOLEAN); CREATE TABLE permissions(permission_id INT PRIMARY KEY,permission_name TEXT,active BOOLEAN); CREATE TABLE role_permissions(role_id INT,permission_id INT,active BOOLEAN); CREATE TABLE club_role_assignments(assignment_id UUID PRIMARY KEY,user_id UUID,club_section_id INT,role_id INT,active BOOLEAN,status TEXT,start_date TIMESTAMPTZ); CREATE TABLE finances(finance_id INT PRIMARY KEY); CREATE TABLE finances_categories(finance_category_id INT PRIMARY KEY); CREATE TABLE system_config(config_key TEXT PRIMARY KEY,config_value TEXT); CREATE TABLE audit_logs(entity_type TEXT,entity_id TEXT,action TEXT,club_id INT,actor_user_id UUID,changes JSONB);`);
    await client.query(`INSERT INTO users VALUES('${actor}'); INSERT INTO club_sections VALUES(7,1); INSERT INTO roles VALUES(1,'treasurer',true); INSERT INTO permissions VALUES(1,'finances:register',true); INSERT INTO role_permissions VALUES(1,1,true); INSERT INTO club_role_assignments VALUES('${key}','${actor}',7,1,true,'active',CURRENT_TIMESTAMP); INSERT INTO users_pr VALUES('${actor}','${actor}','${key}'); INSERT INTO system_config VALUES('finance.ledger_v2_writes_enabled','true');`);
    for (const name of ['20260730200000_finance_ledger_v2_foundation','20260803184000_finance_voucher_integrity','20260803210000_finance_ledger_evidence_upload_intents']) await client.query(sql(name));
    const db = new Db(client), service = new FinanceEvidenceUploadService(db as any, new FinanceLedgerAuthorizationAdapter(), storage as any); return { client, schema, db, storage, service };
  } catch (error) { await dispose({ client, schema, storage }).catch(() => undefined); throw error; }
};
const dispose = async (
  { client, schema, storage }: any,
  peers: Client[] = [],
) => {
  storage.clear();
  for (const peer of peers) {
    await peer.query('ROLLBACK').catch(() => undefined);
    await peer.end().catch(() => undefined);
  }
  await client.query('ROLLBACK').catch(() => undefined);
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  expect(
    one(await client.query('SELECT to_regnamespace($1) schema', [schema]))
      ?.schema,
  ).toBeNull();
  await client.end();
};
const count = async (client: Client) =>
  one(
    await client.query(
      `SELECT (SELECT count(*)::int FROM finance_ledger_evidence_upload_intents) intents,(SELECT count(*)::int FROM finance_ledger_evidence) evidence,(SELECT count(*)::int FROM audit_logs) audits`,
    ),
  );

describe('finance evidence upload PostgreSQL gate', () => {
  // The safety case runs even when DB execution is deliberately unavailable.
  // DB cases are opt-in only and derive all state from a disposable schema.
  // The fixture invokes the real upload service and authorization adapter.
  // Storage has no network path and uses a non-digest ETag intentionally.
  // Each race is held by a Promise barrier, never time-based sleeps.
  // Lease reclaim observes the server-side expiration predicate directly.
  // SQL capture proves trigger-owned lifecycle timestamps stay server-owned.
  // The audit fault is limited to final completion for transaction isolation.
  // Cleanup rolls back peers, drops the schema, then verifies its absence.
  // No controller, DTO, migration, or runtime dependency is altered here.
  safetyIt('fails closed without an explicit local scratch URL', () => {
    expect(url).toBeUndefined();
    for (const value of [
      'postgresql://evil.example/db?finance_ledger_scratch=1',
      'postgresql://localhost/db?finance_ledger_scratch=0',
    ])
      expect(() => resolveUrl(value, true)).toThrow();
  });
  dbIt(
    'issues/replays behind advisory lock with DB-fresh authorization and conflict safety',
    async () => {
      const fixture = await setup(),
        peer = new Client({ connectionString: url });
      await peer.connect();
      await configure(peer, fixture.schema);
      try {
        const barrier = deferred(),
          peerDb = new Db(peer),
          auth = new FinanceLedgerAuthorizationAdapter(),
          first = new FinanceEvidenceUploadService(
            fixture.db as any,
            {
              assertCanRegister: async (value: any) => {
                barrier.enter();
                await barrier.wait;
                return auth.assertCanRegister(value);
              },
            },
            fixture.storage as any,
          ),
          second = new FinanceEvidenceUploadService(
            peerDb as any,
            auth,
            fixture.storage as any,
          );
        const a = first.issueUpload(input, actor, key);
        await barrier.entered;
        peerDb.advisory = deferred();
        const b = second.issueUpload(input, actor, key);
        await peerDb.advisory.entered;
        barrier.release();
        const [left, right] = await Promise.all([a, b]);
        expect(left.uploadHandle).toBe(right.uploadHandle);
        expect(await count(fixture.client)).toMatchObject({
          intents: 1,
          audits: 1,
        });
        await fixture.client.query('UPDATE permissions SET active=false');
        await expect(
          second.issueUpload(input, actor, key),
        ).rejects.toMatchObject({
          status: 403,
          code: 'GUARD_PERMISSION_DENIED',
        });
        await fixture.client.query('UPDATE permissions SET active=true');
        for (const table of ['club_role_assignments', 'role_permissions']) {
          await fixture.client.query(`UPDATE ${table} SET active=false`);
          await expect(
            second.issueUpload(input, actor, key),
          ).rejects.toMatchObject({
            status: 403,
            code: 'GUARD_PERMISSION_DENIED',
          });
          await fixture.client.query(`UPDATE ${table} SET active=true`);
        }
        await expect(
          second.issueUpload({ ...input, fileSize: 11 }, actor, key),
        ).rejects.toMatchObject({ status: 409 });
        expect(fixture.storage.issue).toBe(2);
      } finally {
        await dispose(fixture, [peer]);
      }
    },
  );
  dbIt(
    'row-locks revoke, preserves trigger timestamps, reclaims/serializes leases and pins the SHA stream',
    async () => {
      const fixture = await setup(),
        locker = new Client({ connectionString: url });
      await locker.connect();
      await configure(locker, fixture.schema);
      try {
        const issued = await fixture.service.issueUpload(input, actor, key);
        await locker.query('BEGIN');
        await locker.query(
          'SELECT 1 FROM finance_ledger_evidence_upload_intents WHERE finance_ledger_evidence_upload_intent_id=$1 FOR UPDATE',
          [issued.uploadHandle],
        );
        fixture.db.rowLock = deferred();
        const blocked = fixture.service.revokeUpload(
          { ...input, uploadHandle: issued.uploadHandle },
          actor,
        );
        await fixture.db.rowLock.entered;
        await locker.query('COMMIT');
        await blocked;
        const revoked = one(
          await fixture.client.query(
            'SELECT * FROM finance_ledger_evidence_upload_intents WHERE finance_ledger_evidence_upload_intent_id=$1',
            [issued.uploadHandle],
          ),
        );
        expect(revoked.revoked_at).not.toBeNull();
        expect(fixture.db.writes.join('')).not.toContain('revoked_at');
        await fixture.service.revokeUpload(
          { ...input, uploadHandle: issued.uploadHandle },
          actor,
        );
        expect((await count(fixture.client)).audits).toBe(2);
        const reclaim = await fixture.service.issueUpload(
          input,
          actor,
          '00000000-0000-4000-8000-000000000005',
        );
        fixture.storage.put(reclaim.uploadHandle);
        await fixture.client.query(
          `UPDATE finance_ledger_evidence_upload_intents
           SET status='verifying',verification_token=$2,
               verification_expires_at=CURRENT_TIMESTAMP + interval '0.001 seconds'
           WHERE finance_ledger_evidence_upload_intent_id=$1`,
          [reclaim.uploadHandle, '00000000-0000-4000-8000-000000000006'],
        );
        let expired = false;
        for (let attempt = 0; attempt < 100 && !expired; attempt++) {
          expired = !!one(
            await fixture.client.query(
              `SELECT verification_expires_at <= clock_timestamp() expired
               FROM finance_ledger_evidence_upload_intents
               WHERE finance_ledger_evidence_upload_intent_id=$1`,
              [reclaim.uploadHandle],
            ),
          ).expired;
        }
        expect(expired).toBe(true);
        await fixture.service.completeUpload(
          { ...input, uploadHandle: reclaim.uploadHandle },
          actor,
        );
        const next = await fixture.service.issueUpload(
          input,
          actor,
          '00000000-0000-4000-8000-000000000003',
        );
        fixture.storage.put(next.uploadHandle, 3);
        fixture.storage.hold = deferred();
        const first = fixture.service.completeUpload(
          { ...input, uploadHandle: next.uploadHandle },
          actor,
        );
        await fixture.storage.hold.entered;
        await expect(
          fixture.service.completeUpload(
            { ...input, uploadHandle: next.uploadHandle },
            actor,
          ),
        ).rejects.toMatchObject({ status: 409 });
        fixture.storage.hold.release();
        await first;
        const complete = one(
          await fixture.client.query(
            'SELECT i.*,e.content_sha256 FROM finance_ledger_evidence_upload_intents i JOIN finance_ledger_evidence e USING(finance_ledger_evidence_id) WHERE i.finance_ledger_evidence_upload_intent_id=$1',
            [next.uploadHandle],
          ),
        );
        expect(complete.content_sha256).toBe(
          createHash('sha256')
            .update(fixture.storage.objects.get(next.uploadHandle)!.bytes)
            .digest('hex'),
        );
        expect(complete.content_sha256).not.toBe('"fake-etag-v1"');
        expect(complete.completed_at).not.toBeNull();
        expect(fixture.db.writes.join('')).not.toContain('completed_at');
        const gets = fixture.storage.get;
        await fixture.service.completeUpload(
          { ...input, uploadHandle: next.uploadHandle },
          actor,
        );
        expect(fixture.storage.get).toBe(gets);
      } finally {
        await dispose(fixture, [locker]);
      }
    },
  );
  dbIt(
    'rejects stale complete after revoke and rolls back evidence/state/audit together',
    async () => {
      const fixture = await setup();
      try {
        const issued = await fixture.service.issueUpload(input, actor, key);
        fixture.storage.put(issued.uploadHandle);
        fixture.storage.hold = deferred();
        const stale = fixture.service.completeUpload(
          { ...input, uploadHandle: issued.uploadHandle },
          actor,
        );
        await fixture.storage.hold.entered;
        await fixture.service.revokeUpload(
          { ...input, uploadHandle: issued.uploadHandle },
          actor,
        );
        fixture.storage.hold.release();
        await expect(stale).rejects.toMatchObject({ status: 409 });
        expect(await count(fixture.client)).toMatchObject({
          evidence: 0,
          audits: 3,
        });
        const next = await fixture.service.issueUpload(
          input,
          actor,
          '00000000-0000-4000-8000-000000000004',
        );
        fixture.storage.put(next.uploadHandle);
        fixture.db.failAudit = true;
        await expect(
          fixture.service.completeUpload(
            { ...input, uploadHandle: next.uploadHandle },
            actor,
          ),
        ).rejects.toThrow('audit fault');
        const row = one(
          await fixture.client.query(
            'SELECT status,finance_ledger_evidence_id,completed_at,verification_token FROM finance_ledger_evidence_upload_intents WHERE finance_ledger_evidence_upload_intent_id=$1',
            [next.uploadHandle],
          ),
        );
        expect(row).toMatchObject({
          status: 'verifying',
          finance_ledger_evidence_id: null,
          completed_at: null,
        });
        expect(row.verification_token).not.toBeNull();
        expect((await count(fixture.client)).evidence).toBe(0);
      } finally {
        await dispose(fixture);
      }
    },
  );
});
