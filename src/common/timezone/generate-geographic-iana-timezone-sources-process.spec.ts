import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  generatePinnedIanaTimezoneSources,
  PINNED_IANA_SOURCE_DIRECTORY,
} from '../../../scripts/generate-geographic-iana-timezone-sources';

const root = join(__dirname, '../../..');
const expression =
  "const g=require('./scripts/generate-geographic-iana-timezone-sources');g.generatePinnedIanaTimezoneSources(process.argv[1],false,process.argv[2])";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sacdia-iana-process-'));
  const source = join(directory, 'source');
  const output = join(directory, 'output');
  mkdirSync(source);
  cpSync(PINNED_IANA_SOURCE_DIRECTORY, output, { recursive: true });
  writeFileSync(join(source, 'version'), '2026b\n');
  for (const name of ['zone.tab', 'tzdata.zi']) {
    let bytes = gunzipSync(
      readFileSync(join(PINNED_IANA_SOURCE_DIRECTORY, `${name}.gz`)),
    );
    if (name === 'tzdata.zi')
      bytes = Buffer.from(
        bytes
          .toString()
          .replace(
            '# version 2026b-rearguard\n',
            '# version 2026b\n# dataform rearguard\n',
          ),
      );
    writeFileSync(join(source, name), bytes);
  }
  return { directory, output, source };
}

function run(
  value: ReturnType<typeof fixture>,
  env: NodeJS.ProcessEnv = process.env,
) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', '-e', expression, value.source, value.output],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...env, NODE_ENV: 'test' },
    },
  );
}

function files(directory: string): Record<string, Buffer> {
  return Object.fromEntries(
    readdirSync(directory)
      .filter((name) => name !== '.iana-timezone-generation.lock')
      .sort()
      .map((name) => [name, readFileSync(join(directory, name))]),
  );
}

async function waitFor(path: string): Promise<void> {
  for (let attempts = 0; attempts < 200; attempts += 1) {
    if (existsSync(path)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function spawnPaused(
  value: ReturnType<typeof fixture>,
  checkpoint: string,
  marker: string,
  release: string,
) {
  return spawn(
    process.execPath,
    ['--import', 'tsx', '-e', expression, value.source, value.output],
    {
      cwd: root,
      env: {
        ...process.env,
        IANA_TZDB_TEST_MARKER: marker,
        IANA_TZDB_TEST_PAUSE_AT: checkpoint,
        IANA_TZDB_TEST_RELEASE: release,
        NODE_ENV: 'test',
      },
      stdio: 'ignore',
    },
  );
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => {
    const onExit = (code: number | null) => resolve(code);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.removeListener('exit', onExit);
      resolve(child.exitCode);
    }
  });
}

async function waitForExitOrPath(
  child: ReturnType<typeof spawn>,
  path: string,
): Promise<void> {
  for (let attempts = 0; attempts < 200; attempts += 1) {
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      existsSync(path)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for child exit or ${path}`);
}

describe('IANA generator process ownership and recovery', () => {
  it('observes an exit emitted while the listener is being armed', async () => {
    const child = new EventEmitter() as ReturnType<typeof spawn>;
    Object.defineProperties(child, {
      exitCode: {
        get() {
          child.emit('exit', 0);
          return null;
        },
      },
      signalCode: { value: null },
    });
    await expect(
      Promise.race([
        exited(child),
        new Promise<number>((resolve) => setImmediate(() => resolve(-1))),
      ]),
    ).resolves.toBe(0);
  });

  it.each(['prepared', 'backup-1', 'install-1', 'committed'])(
    'recovers after a real SIGKILL at %s',
    (checkpoint) => {
      const value = fixture();
      try {
        const killed = run(value, {
          ...process.env,
          IANA_TZDB_TEST_CRASH_AT: checkpoint,
        });
        expect(killed.signal).toBe('SIGKILL');
        expect(run(value).status).toBe(0);
        expect(readdirSync(value.output).sort()).toEqual([
          'README.md',
          'tzdata.zi.gz',
          'zone.tab.gz',
        ]);
      } finally {
        rmSync(value.directory, { recursive: true, force: true });
      }
    },
  );

  it('prevents a second process from recovering a live transaction', async () => {
    const value = fixture();
    const marker = join(value.directory, 'paused');
    const release = join(value.directory, 'release');
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '-e', expression, value.source, value.output],
      {
        cwd: root,
        env: {
          ...process.env,
          IANA_TZDB_TEST_MARKER: marker,
          IANA_TZDB_TEST_PAUSE_AT: 'replacing',
          IANA_TZDB_TEST_RELEASE: release,
          NODE_ENV: 'test',
        },
        stdio: 'ignore',
      },
    );
    try {
      await waitFor(marker);
      expect(run(value).status).not.toBe(0);
      const exit = exited(child);
      writeFileSync(release, '');
      expect(await exit).toBe(0);
    } finally {
      child.kill('SIGKILL');
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('serializes stale-lock recovery before another owner can create the lock', async () => {
    const value = fixture();
    const staleMarker = join(value.directory, 'stale-validated');
    const staleRelease = join(value.directory, 'release-stale');
    const lockMarker = join(value.directory, 'lock-created');
    const lockRelease = join(value.directory, 'release-lock');
    writeFileSync(
      join(value.output, '.iana-timezone-generation.lock'),
      JSON.stringify({
        version: 1,
        pid: 2_147_483_647,
        token: 'a'.repeat(24),
      }),
    );
    const stale = spawnPaused(
      value,
      'stale-lock-validated',
      staleMarker,
      staleRelease,
    );
    let racer: ReturnType<typeof spawn> | undefined;
    try {
      await waitFor(staleMarker);
      racer = spawnPaused(value, 'lock-created', lockMarker, lockRelease);
      await waitForExitOrPath(racer, lockMarker);
      expect(existsSync(lockMarker)).toBe(false);
      const exit = exited(stale);
      writeFileSync(staleRelease, '');
      expect(await exit).toBe(0);
    } finally {
      stale.kill('SIGKILL');
      racer?.kill('SIGKILL');
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('fails closed without mutating an orphaned acquisition gate', () => {
    const value = fixture();
    try {
      writeFileSync(
        join(value.output, '.iana-timezone-generation.acquire.lock'),
        JSON.stringify({
          version: 1,
          pid: 2_147_483_647,
          token: 'b'.repeat(24),
        }),
      );
      const before = files(value.output);
      const result = run(value);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('manual recovery');
      expect(files(value.output)).toEqual(before);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('recovers a complete initial journal after directory fsync fails', () => {
    const value = fixture();
    try {
      expect(
        run(value, {
          ...process.env,
          IANA_TZDB_TEST_FAIL_AT: 'initial-journal-fsync',
        }).status,
      ).not.toBe(0);
      expect(run(value).status).toBe(0);
      expect(readdirSync(value.output).sort()).toEqual([
        'README.md',
        'tzdata.zi.gz',
        'zone.tab.gz',
      ]);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('keeps --check byte-for-byte non-mutating when replacement state exists', () => {
    const value = fixture();
    try {
      writeFileSync(
        join(value.output, 'zone.tab.gz.unowned.tmp'),
        'unexpected',
      );
      const before = files(value.output);
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).toThrow('replacement state');
      expect(files(value.output)).toEqual(before);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });

  it('fails closed and preserves evidence when persisted hashes disagree', () => {
    const value = fixture();
    try {
      expect(
        run(value, {
          ...process.env,
          IANA_TZDB_TEST_CRASH_AT: 'install-1',
        }).signal,
      ).toBe('SIGKILL');
      const backup = readdirSync(value.output).find((name) =>
        name.endsWith('.bak'),
      );
      if (!backup) throw new Error('crash fixture did not leave a backup');
      writeFileSync(join(value.output, backup), 'corrupted backup');
      const before = files(value.output);
      expect(run(value).status).not.toBe(0);
      expect(files(value.output)).toEqual(before);
    } finally {
      rmSync(value.directory, { recursive: true, force: true });
    }
  });
});
