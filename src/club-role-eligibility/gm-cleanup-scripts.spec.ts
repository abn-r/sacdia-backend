import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', '..', 'prisma', 'scripts');
const read = (name: string) => readFileSync(join(dir, name), 'utf8');

const stripComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

describe('club role GM cleanup scripts (structural)', () => {
  it('audit is read-only and writes nothing', () => {
    const sql = stripComments(read('club-role-gm-audit.sql'));
    expect(sql).toMatch(/BEGIN READ ONLY;/);
    expect(sql).toMatch(/ROLLBACK;/);
    expect(sql).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i,
    );
    expect(sql).not.toMatch(/\bCOMMIT\b/i);
  });

  it('cleanup requires confirm=yes, runs in a transaction, never hard-deletes', () => {
    const raw = read('club-role-gm-cleanup.sql');
    const sql = stripComments(raw);
    expect(sql).toMatch(/:\{\?confirm\}/);
    expect(sql).toMatch(/:'confirm' = 'yes'/);
    expect(sql).toMatch(/\\quit/);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(/gm_cleanup_snapshot_/);
    expect(sql).toMatch(/ON CONFLICT \(assignment_id\) DO NOTHING/);
    expect(sql).toMatch(/status = 'ended'/);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    // confirm guard must come before the transaction starts
    expect(sql.indexOf(":'confirm' = 'yes'")).toBeLessThan(
      sql.indexOf('BEGIN;'),
    );
    // rule-1 rows are never selected for ending
    expect(sql).toMatch(/r\.role_name = 'member'/);
    expect(sql).not.toMatch(/RULE_1/);
    // re-home defaults to empty
    expect(sql).toMatch(/\\set rehome_ids ''/);
  });

  it('restore requires confirm=yes and uses the snapshot table', () => {
    const sql = stripComments(read('club-role-gm-restore.sql'));
    expect(sql).toMatch(/:'confirm' = 'yes'/);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(/FROM :"tbl" s/);
    expect(sql).not.toMatch(/\bDELETE\b/i);
  });

  it('runbook documents the approval gate and env order', () => {
    const md = read('CLUB-ROLE-GM-CLEANUP-README.md');
    expect(md).toMatch(/APPROVAL GATE/);
    expect(md).toMatch(/development.*staging.*production/s);
  });
});
