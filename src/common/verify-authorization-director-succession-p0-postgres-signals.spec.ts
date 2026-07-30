import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';

const root = join(__dirname, '../..');
const databaseUrl = process.env.AUTHORIZATION_P0_INTEGRATION_DATABASE_URL;
const dbIt =
  process.env.ALLOW_AUTHORIZATION_P0_INTEGRATION_DB === '1' && databaseUrl
    ? it
    : it.skip;

function killPublicCommand(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The isolated process group already exited.
  }
}

function waitForExit(child: ChildProcess) {
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      killPublicCommand(child);
      reject(new Error('public preflight did not exit after signal'));
    }, 8_000);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function signalPublicCommand(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (!child.pid) throw new Error('public preflight PID unavailable');
  let target = child.pid;
  for (;;) {
    const output = spawnSync('pgrep', ['-P', String(target)], {
      encoding: 'utf8',
    }).stdout.trim();
    if (!output) break;
    const next = Number(output.split(/\s+/)[0]);
    if (!Number.isSafeInteger(next)) break;
    target = next;
  }
  process.kill(target, signal);
}

describe('authorization P0 public PostgreSQL signal lifecycle', () => {
  dbIt.each([
    ['SIGINT', 130, 'INTERRUPTED'],
    ['SIGTERM', 143, 'TERMINATED'],
  ] as const)(
    'cancels a blocked query, rolls back and exits cleanly on %s',
    async (signal, exitCode, diagnostic) => {
      const integrationDatabaseUrl = databaseUrl;
      if (!integrationDatabaseUrl) throw new Error('integration URL required');
      const schema = `be01c_signal_${process.pid}_${randomBytes(4).toString('hex')}`;
      const applicationName = `${schema}_${signal}`;
      const admin = new Client({ connectionString: integrationDatabaseUrl });
      const locker = new Client({ connectionString: integrationDatabaseUrl });
      await admin.connect();
      await locker.connect();
      const query = (sql: string, values?: unknown[]) =>
        admin.query(sql, values);
      let child: ChildProcess | undefined;
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
          CREATE TABLE director_succession_plans(club_section_id int,status text)`);
        await locker.query(`SET search_path=${schema},public; BEGIN;
          LOCK TABLE club_role_assignments IN ACCESS EXCLUSIVE MODE`);
        const childUrl = new URL(integrationDatabaseUrl);
        childUrl.searchParams.set('application_name', applicationName);
        child = spawn('pnpm', ['--silent', 'verify:authorization-p0'], {
          cwd: root,
          detached: true,
          env: {
            ...process.env,
            AUTHORIZATION_P0_LOCK_TIMEOUT_MS: '10000',
            AUTHORIZATION_P0_QUERY_TIMEOUT_MS: '30000',
            AUTHORIZATION_P0_STATEMENT_TIMEOUT_MS: '20000',
            AUTHORIZATION_P0_VERIFY_DATABASE_URL: childUrl.toString(),
            PGOPTIONS: `-csearch_path=${schema},public`,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout
          ?.setEncoding('utf8')
          .on('data', (chunk) => (stdout += chunk));
        child.stderr
          ?.setEncoding('utf8')
          .on('data', (chunk) => (stderr += chunk));
        let blocked = false;
        for (let attempt = 0; attempt < 200 && !blocked; attempt += 1) {
          const activity = await query(
            `SELECT wait_event_type FROM pg_stat_activity
             WHERE application_name=$1 AND backend_type='client backend'`,
            [applicationName],
          );
          blocked = activity.rows.some((row) => row.wait_event_type === 'Lock');
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
        }
        expect(blocked).toBe(true);
        const exited = waitForExit(child);
        signalPublicCommand(child, signal);
        expect(await exited).toEqual({
          code: exitCode,
          signal: null,
        });
        expect(stdout.trim().split('\n')).toHaveLength(1);
        expect(JSON.parse(stdout)).toMatchObject({
          error: { diagnostic },
          status: 'error',
        });
        expect(stderr).not.toMatch(
          /Unhandled|Connection terminated unexpectedly/,
        );
        const remaining = await query(
          'SELECT count(*)::int count FROM pg_stat_activity WHERE application_name=$1',
          [applicationName],
        );
        expect(remaining.rows[0].count).toBe(0);
      } finally {
        if (child) killPublicCommand(child);
        await query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE application_name=$1 AND pid <> pg_backend_pid()`,
          [applicationName],
        ).catch(() => undefined);
        await locker.query('ROLLBACK').catch(() => undefined);
        await query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await Promise.all([admin.end(), locker.end()]);
      }
    },
    30_000,
  );
});
