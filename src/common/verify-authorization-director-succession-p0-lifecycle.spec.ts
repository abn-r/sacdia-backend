import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONSUMER_INVENTORY,
  finalizeChecks,
} from '../../scripts/verify-authorization-director-succession-p0';
import { createTestConsumerRoots } from './testing/authorization-p0-consumer-roots.fixture';

const root = join(__dirname, '../..');
const consumerRoots = createTestConsumerRoots(CONSUMER_INVENTORY);
afterAll(() => consumerRoots.dispose());
const script = join(
  root,
  'scripts/verify-authorization-director-succession-p0.ts',
);
const tsxLoader = require.resolve('tsx');

function parseSingleReport(stdout: string) {
  const lines = stdout.trim().split('\n');
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]) as Record<string, unknown>;
}

function runDirect(extraEnv: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, ['--import', tsxLoader, script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      SACDIA_WORKSPACE_ROOT: consumerRoots.workspaceRoot,
      SACDIA_CANONICAL_DOCS_ROOT: consumerRoots.docsRoot,
      ...extraEnv,
    },
  });
}

async function interrupt(signal: 'SIGINT' | 'SIGTERM') {
  let accepted!: (socket: Socket) => void;
  const connected = new Promise<Socket>((resolve) => (accepted = resolve));
  const server = createServer((socket) => accepted(socket));
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('TCP test server did not bind');
  const child = spawn(process.execPath, ['--import', tsxLoader, script], {
    cwd: root,
    env: {
      ...process.env,
      SACDIA_WORKSPACE_ROOT: consumerRoots.workspaceRoot,
      SACDIA_CANONICAL_DOCS_ROOT: consumerRoots.docsRoot,
      AUTHORIZATION_P0_VERIFY_DATABASE_URL: `postgresql://127.0.0.1:${address.port}/postgres`,
      AUTHORIZATION_P0_CONNECTION_TIMEOUT_MS: '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (value) => (stdout += value));
  child.stderr.setEncoding('utf8').on('data', (value) => (stderr += value));
  const socket = await connected;
  socket.resume();
  child.kill(signal);
  const result = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI did not exit after ${signal}`));
    }, 5_000);
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      resolve({ code, signal: exitSignal });
    });
  });
  let activeConnections = 1;
  for (let attempt = 0; attempt < 20 && activeConnections > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    activeConnections = await new Promise<number>((resolve, reject) =>
      server.getConnections((error, count) =>
        error ? reject(error) : resolve(count),
      ),
    );
  }
  const socketClosed = activeConnections === 0;
  socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return {
    ...result,
    socketClosed,
    socketState: {
      destroyed: socket.destroyed,
      readableEnded: socket.readableEnded,
      readyState: socket.readyState,
      writableEnded: socket.writableEnded,
    },
    stderr,
    stdout,
  };
}

describe('authorization P0 CLI lifecycle', () => {
  it('keeps parallel workers from mutating tracked shared fixtures', () => {
    const mutator = ['rename', 'Sync'].join('');
    for (const path of [
      __filename,
      join(__dirname, 'verify-authorization-director-succession-p0.spec.ts'),
    ])
      expect(readFileSync(path, 'utf8')).not.toContain(`${mutator}(`);
  });

  it('keeps a top-level catalog failure as one JSON stdout record', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'be01-catalog-failure-'));
    const hook = join(temporaryRoot, 'catalog-failure.cjs');
    writeFileSync(
      hook,
      `const Module=require('node:module');
const load=Module._load;
Module._load=function(request,parent,isMain){
  if(request.endsWith('canonical-geographic-iana-timezone'))
    return {loadCanonicalGeographicIanaTimezoneCatalog(){throw new Error('forced catalog failure')}};
  return load.call(this,request,parent,isMain);
};`,
    );
    try {
      const result = runDirect({
        AUTHORIZATION_P0_VERIFY_DATABASE_URL:
          'postgresql://127.0.0.1:1/postgres',
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ''} --require=${hook}`.trim(),
      });
      expect(result.status).toBe(1);
      expect(parseSingleReport(result.stdout)).toMatchObject({
        status: 'error',
        error: { diagnostic: 'CATALOG_INTEGRITY_ERROR' },
      });
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['SIGINT', 130, 'INTERRUPTED'],
    ['SIGTERM', 143, 'TERMINATED'],
  ] as const)(
    'emits JSON and closes the DB socket on %s',
    async (signal, exitCode, diagnostic) => {
      const result = await interrupt(signal);
      if (!result.socketClosed || result.code !== exitCode)
        throw new Error(JSON.stringify(result, undefined, 2));
      expect(result).toMatchObject({
        code: exitCode,
        signal: null,
        socketClosed: true,
      });
      expect(parseSingleReport(result.stdout)).toMatchObject({
        status: 'error',
        error: { diagnostic },
      });
    },
    10_000,
  );

  it('delegates snapshot ownership to the preflight executor', () => {
    expect(readFileSync(script, 'utf8')).not.toContain('BEGIN TRANSACTION');
  });

  it('blocks when the productive Node ICU cannot support a canonical zone', () => {
    const catalog = {
      canonical: new Set(['America/Cancun', 'Europe/Kyiv']),
      classify: (timezone: string) =>
        timezone === 'America/Cancun'
          ? {
              ok: false,
              reason: 'UNKNOWN',
              diagnostic: 'RUNTIME_UNSUPPORTED',
            }
          : { ok: true, value: timezone },
    };
    const checks = finalizeChecks(
      {
        schema: {
          local_fields_timezone: 'ready',
          director_succession_plans: 'ready',
          director_succession_plans_missing_columns: [],
        },
        checks: [],
      },
      catalog as never,
      1,
    );
    expect(
      checks.find((check) => check.id === 'production_node_icu_timezones'),
    ).toMatchObject({
      total_count: 1,
      sample_count: 1,
      rows: [
        {
          timezone: 'America/Cancun',
          reason: 'UNKNOWN',
          diagnostic: 'RUNTIME_UNSUPPORTED',
        },
      ],
    });
  });
});
