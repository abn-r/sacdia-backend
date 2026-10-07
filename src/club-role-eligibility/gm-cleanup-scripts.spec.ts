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

  it('cleanup requires an approved id allowlist and aborts when empty', () => {
    const sql = stripComments(read('club-role-gm-cleanup.sql'));
    expect(sql).toMatch(/:\{\?approved_rule3_ids\}/);
    expect(sql).toMatch(/ABORT: approved_rule3_ids is empty/);
    expect(sql).toMatch(/CREATE TEMP TABLE _gm_target/);
    expect(sql).toMatch(
      /JOIN _gm_approved ap ON ap\.assignment_id = v\.assignment_id/,
    );
    // the end UPDATE targets the intersection, never the raw rule-3 set
    expect(sql).toMatch(
      /FROM _gm_target v\s+WHERE a\.assignment_id = v\.assignment_id/,
    );
    expect(sql).toMatch(/approved_but_not_violating/);
    expect(sql.indexOf('approved_rule3_ids is empty')).toBeLessThan(
      sql.indexOf('BEGIN;'),
    );
  });

  it('cleanup re-home honors uniq_cra_annual_member_section_year', () => {
    const sql = stripComments(read('club-role-gm-cleanup.sql'));
    expect(sql).toMatch(/'active', 'inactive', 'designated'/);
    expect(sql).toMatch(/_gm_reactivated/);
    expect(sql).toMatch(/SKIPPED_ALREADY_ACTIVE_IN_GM/);
    expect(sql).not.toMatch(/ON CONFLICT DO NOTHING/);
  });

  it('restore only touches rows still in cleanup state', () => {
    const sql = stripComments(read('club-role-gm-restore.sql'));
    expect(sql).toMatch(/a\.status = 'ended'/);
    expect(sql).toMatch(/a\.modified_at = s\.snapshot_at/);
    expect(sql).toMatch(/still_cleanup_state/);
    expect(sql).toMatch(/skipped_assignment_id/);
  });

  it('audit reports enrollment history, proposed action and NO_SECTION', () => {
    const sql = stripComments(read('club-role-gm-audit.sql'));
    expect(sql).toMatch(/has_enrollment_history/);
    expect(sql).toMatch(/proposed_action/);
    expect(sql).toMatch(/rule-1-no-history/);
    expect(sql).toMatch(/'NO_SECTION'/);
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
