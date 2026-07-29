import type { Client } from 'pg';
import {
  executeAuthorizationP0Preflight,
  type AuthorizationP0PreflightOptions,
} from './authorization-p0-preflight';

const options: AuthorizationP0PreflightOptions = {
  canonicalTimezones: ['America/Mexico_City'],
  sampleLimit: 10,
  now: new Date('2026-07-28T12:00:00Z'),
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 1_000,
};

function clientThat({
  failMain = false,
  isolation = 'repeatable read',
}: {
  failMain?: boolean;
  isolation?: string;
} = {}) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const query = jest.fn(async (sql: string, values?: readonly unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("current_setting('transaction_isolation')"))
      return { rows: [{ isolation, read_only: 'on' }] };
    if (sql.startsWith('/* Read-only P0 preflight')) {
      if (failMain) throw new Error('main statement failed');
      return {
        rows: [
          {
            report: {
              checks: [],
              schema: { director_succession_plans: 'schema_not_ready' },
            },
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { calls, client: { query } as unknown as Client };
}

describe('authorization P0 preflight transaction ownership', () => {
  it('owns one repeatable-read read-only transaction and local timeouts', async () => {
    const value = clientThat();
    await expect(
      executeAuthorizationP0Preflight(value.client, options),
    ).resolves.toMatchObject({ checks: [] });

    expect(value.calls[0].sql).toBe(
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(value.calls[1]).toMatchObject({
      values: [5_000, 1_000],
    });
    expect(value.calls[1].sql).toContain(
      "current_setting('transaction_isolation')",
    );
    expect(value.calls[1].sql).toContain("set_config('statement_timeout'");
    expect(value.calls[2]).toMatchObject({
      values: [['America/Mexico_City'], 10, new Date('2026-07-28T12:00:00Z')],
    });
    expect(value.calls[2].sql.startsWith('/* Read-only P0 preflight')).toBe(
      true,
    );
    expect(value.calls[3].sql).toBe('COMMIT');
    expect(value.calls).toHaveLength(4);
  });

  it('rolls back when the main statement fails without caller-owned BEGIN', async () => {
    const value = clientThat({ failMain: true });
    await expect(
      executeAuthorizationP0Preflight(value.client, options),
    ).rejects.toThrow('main statement failed');
    expect(value.calls.map(({ sql }) => sql)).toEqual([
      'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
      expect.stringContaining("set_config('statement_timeout'"),
      expect.stringContaining('/* Read-only P0 preflight'),
      'ROLLBACK',
    ]);
  });

  it('rejects invalid parameters before opening a transaction', async () => {
    const value = clientThat();
    await expect(
      executeAuthorizationP0Preflight(value.client, {
        ...options,
        sampleLimit: 1.5,
      }),
    ).rejects.toThrow('AUTHORIZATION_P0_PREFLIGHT_OPTIONS_INVALID');
    expect(value.calls).toEqual([]);
  });

  it('rolls back when the server does not honor the transaction contract', async () => {
    const value = clientThat({ isolation: 'read committed' });
    await expect(
      executeAuthorizationP0Preflight(value.client, options),
    ).rejects.toThrow('AUTHORIZATION_P0_PREFLIGHT_TRANSACTION_REJECTED');
    expect(value.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
});
