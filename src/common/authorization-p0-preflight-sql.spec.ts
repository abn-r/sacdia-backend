import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import type { AuthorizationP0PreflightReport } from './authorization-p0-preflight';
import { loadCanonicalGeographicIanaTimezoneCatalog } from './timezone/canonical-geographic-iana-timezone';

const sqlPath = join(
  process.cwd(),
  'prisma/scripts/authorization-p0-preflight.sql',
);
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;
const check = (report: AuthorizationP0PreflightReport, id: string) =>
  report.checks.find((item) => item.id === id)!;

describe('authorization P0 preflight SQL', () => {
  it('is read-only, null-safe and bounds every deterministic sample', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|set_config)\b/i,
    );
    expect(sql).not.toMatch(/LIMIT \$2|array_agg\(class_id/i);
    expect(sql).toContain('coalesce($2::int, 50)');
    expect(sql.match(/LIMIT \(SELECT sample_limit FROM input\)/g)).toHaveLength(
      10,
    );
    expect(sql).toContain('a.active IS NOT TRUE');
    expect(sql).toContain("status IS DISTINCT FROM 'active'");
    expect(sql).toContain(') IS NOT TRUE');
  });

  dbIt(
    'reports inactive pointers and NULL statuses with exact counts',
    async () => {
      if (!databaseUrl) throw new Error('integration URL required');
      const parsed = new URL(databaseUrl);
      expect(
        (parsed.searchParams.get('host') === '/tmp' ||
          ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) &&
          parsed.pathname === '/postgres',
      ).toBe(true);
      const schema = `be01b_sql_${process.pid}_${randomBytes(4).toString('hex')}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      const query = (sql: string) => client.query(sql);
      const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
      try {
        await query(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
        CREATE TABLE roles(role_id uuid,role_name text,role_category text);
        CREATE TABLE ecclesiastical_years(year_id int,start_date date,end_date date);
        CREATE TABLE club_role_assignments(assignment_id uuid,user_id uuid,role_id uuid,
          ecclesiastical_year_id int,start_date date,end_date date,active boolean,status text,
          expires_at timestamptz,club_section_id int);
        CREATE TABLE users_pr(user_id uuid,active_club_assignment_id uuid);
        CREATE TABLE classes(class_id int,asset_code text);
        CREATE TABLE audit_logs(audit_log_id bigint,action text);
        CREATE TABLE local_fields(local_field_id int,name text,union_id int,active boolean,timezone text);
        CREATE TABLE clubs(club_id int,local_field_id int);
        CREATE TABLE club_sections(club_section_id int,main_club_id int);
        CREATE TABLE director_succession_plans(club_section_id int,status text);
        INSERT INTO local_fields VALUES
          (1,'Campo',2,true,' America/Cancun '),(2,'Campo válido',2,true,'America/Cancun');
        INSERT INTO clubs VALUES(1,1),(2,2); INSERT INTO club_sections VALUES(1,1),(2,2);
        INSERT INTO roles VALUES('00000000-0000-0000-0000-000000000001','director','CLUB');
        INSERT INTO classes VALUES(1,'GM-01');
        INSERT INTO classes SELECT i + 1,'DUP' FROM generate_series(1,105)i;
        INSERT INTO ecclesiastical_years VALUES(1,'2026-01-01','2026-12-31');
        INSERT INTO club_role_assignments SELECT md5('a'||i)::uuid,md5('u'||i)::uuid,
          null,1,'2026-01-01',null,true,'mystery-'||i,null,1 FROM generate_series(1,105)i;
        INSERT INTO club_role_assignments VALUES
          ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001',1,'2026-01-01',null,true,'active',null,1),
          ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
           '00000000-0000-0000-0000-000000000001',1,'2026-02-01',null,true,'active',null,1),
          ('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003',
           null,1,'2026-01-01',null,false,'active',null,1),
          ('00000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004',
           null,1,'2026-01-01',null,true,null,null,2);
        INSERT INTO users_pr VALUES('20000000-0000-0000-0000-000000000003',
          '00000000-0000-0000-0000-000000000003')`);
        await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await client.query<{
          report: AuthorizationP0PreflightReport;
        }>(readFileSync(sqlPath, 'utf8'), [
          [...catalog.canonical],
          null,
          new Date('2026-07-28T12:00:00Z'),
        ]);
        await query('COMMIT');
        const report = result.rows[0].report;
        expect(check(report, 'unknown_assignment_statuses')).toMatchObject({
          total_count: 106,
          sample_count: 50,
          truncated: true,
        });
        expect(check(report, 'active_but_not_effective').rows).toContainEqual(
          expect.objectContaining({
            assignment_id: '00000000-0000-0000-0000-000000000004',
            reason: 'status_not_active',
          }),
        );
        expect(check(report, 'stale_active_club_assignment')).toMatchObject({
          total_count: 1,
          rows: [expect.objectContaining({ reason: 'assignment_inactive' })],
        });
        expect(check(report, 'overlapping_directors').total_count).toBe(1);
        expect(check(report, 'local_field_timezones').rows).toEqual([
          expect.objectContaining({
            local_field_id: 1,
            timezone_supported: false,
          }),
        ]);
      } finally {
        await query('ROLLBACK').catch(() => undefined);
        await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(
          () => undefined,
        );
        await client.end();
      }
    },
  );
});
