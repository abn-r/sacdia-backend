import type { Client } from 'pg';
import type {
  AuthorizationP0PreflightOptions,
  executeAuthorizationP0Preflight as Executor,
} from './authorization-p0-preflight';

const options: AuthorizationP0PreflightOptions = {
  canonicalTimezones: ['America/Mexico_City'],
  sampleLimit: 10,
  now: new Date('2026-07-28T12:00:00Z'),
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 1_000,
};

type Runtime = { executeAuthorizationP0Preflight: typeof Executor };

function runtime(): Runtime {
  return require('./authorization-p0-preflight') as Runtime;
}

function failingClient({
  beginError,
  mainError,
  rollbackError,
}: {
  beginError?: Error;
  mainError?: Error;
  rollbackError?: Error;
}) {
  const queries: string[] = [];
  const query = jest.fn(async (sql: string) => {
    queries.push(sql);
    if (sql.startsWith('BEGIN') && beginError) throw beginError;
    if (sql.includes("current_setting('transaction_isolation')"))
      return { rows: [{ isolation: 'repeatable read', read_only: 'on' }] };
    if (sql.startsWith('/* Read-only P0 preflight'))
      throw mainError ?? new Error('Unexpected preflight main query');
    if (sql === 'ROLLBACK' && rollbackError) throw rollbackError;
    return { rows: [] };
  });
  return { client: { query } as unknown as Client, queries };
}

describe('authorization P0 preflight failure semantics', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('node:fs');
  });

  it('fails before BEGIN with a stable diagnostic when the SQL asset is absent', async () => {
    jest.doMock('node:fs', () => ({
      ...jest.requireActual<typeof import('node:fs')>('node:fs'),
      readFileSync: () => {
        throw new Error('missing preflight SQL');
      },
    }));
    let isolated: Runtime | undefined;
    jest.isolateModules(() => {
      isolated = runtime();
    });
    const query = jest.fn();
    await expect(
      isolated!.executeAuthorizationP0Preflight(
        { query } as unknown as Client,
        options,
      ),
    ).rejects.toThrow('AUTHORIZATION_P0_PREFLIGHT_SQL_UNAVAILABLE');
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves timeout codes after rolling back', async () => {
    const timeout = Object.assign(new Error('statement timeout'), {
      code: '57014',
    });
    const value = failingClient({ mainError: timeout });
    await expect(
      runtime().executeAuthorizationP0Preflight(value.client, options),
    ).rejects.toBe(timeout);
    expect(value.queries.at(-1)).toBe('ROLLBACK');
  });

  it('reports both the connection loss and failed rollback', async () => {
    const connection = new Error('connection lost');
    const cleanup = new Error('socket closed during rollback');
    const value = failingClient({
      mainError: connection,
      rollbackError: cleanup,
    });
    await expect(
      runtime().executeAuthorizationP0Preflight(value.client, options),
    ).rejects.toMatchObject({
      message: 'AUTHORIZATION_P0_PREFLIGHT_ROLLBACK_FAILED',
      errors: [connection, cleanup],
    });
    expect(value.queries.at(-1)).toBe('ROLLBACK');
  });

  it('does not issue rollback when BEGIN itself loses the connection', async () => {
    const connection = new Error('connection lost before BEGIN completed');
    const value = failingClient({ beginError: connection });
    await expect(
      runtime().executeAuthorizationP0Preflight(value.client, options),
    ).rejects.toBe(connection);
    expect(value.queries).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    ]);
  });
});
