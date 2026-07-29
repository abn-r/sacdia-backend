import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync as rawReadFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

const VERSION = '2026b';
const SOURCE_SHA256 = {
  'zone.tab':
    '4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c',
  'tzdata.zi':
    'd4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466',
} as const;
const JOURNAL = '.iana-timezone-generation.transaction.json';
const LOCK = '.iana-timezone-generation.lock';
const ACQUISITION_GATE = '.iana-timezone-generation.acquire.lock';
const HASH = /^[0-9a-f]{64}$/;
const LOCK_OPTIONS = { flag: 'wx', flush: true, mode: 0o600 } as const;

type Artifact = {
  backup?: string;
  newHash: string;
  oldHash: string | null;
  staged: string;
  target: string;
};
type ReplacementTransaction = {
  artifacts: Artifact[];
  ownerToken: string;
  phase: 'prepared' | 'replacing' | 'committed';
  version: 2;
};
type LockOwner = { pid: number; token: string; version: 1 };
type AcquiredLock = { owner: LockOwner; staleOwner?: LockOwner };

const MAX_COMPRESSED_BYTES = 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

function artifactName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path;
}

function invalidGzip(path: string): Error {
  return new Error(`${artifactName(path)} is not a valid gzip member`);
}

function isOutputLimit(error: unknown): boolean {
  const value = error as NodeJS.ErrnoException;
  return (
    value.code === 'ERR_BUFFER_TOO_LARGE' ||
    value.message?.includes('maxOutputLength')
  );
}

type InflateInfo = { buffer: Buffer; engine: { bytesWritten: number } };

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isInflateInfo(
  value: unknown,
  compressedLength: number,
): value is InflateInfo {
  if (
    !isRecord(value) ||
    !Buffer.isBuffer(value.buffer) ||
    !isRecord(value.engine)
  )
    return false;
  const bytesWritten = value.engine.bytesWritten;
  return (
    typeof bytesWritten === 'number' &&
    Number.isSafeInteger(bytesWritten) &&
    bytesWritten >= 0 &&
    bytesWritten <= compressedLength
  );
}

function verifiedGzipPayload(path: string, gzip: Buffer): Buffer {
  if (
    gzip.length < 18 ||
    gzip[0] !== 0x1f ||
    gzip[1] !== 0x8b ||
    gzip[2] !== 0x08
  )
    throw invalidGzip(path);
  if (gzip[3] !== 0) throw new Error(`${artifactName(path)} must use FLG=0`);
  if (gzip.readUInt32LE(4) !== 0)
    throw new Error(`${artifactName(path)} must use MTIME=0`);

  let trailerOffset: number;
  try {
    const raw: unknown = inflateRawSync(gzip.subarray(10), {
      info: true,
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
    if (!isInflateInfo(raw, gzip.length - 18)) throw invalidGzip(path);
    trailerOffset = 10 + raw.engine.bytesWritten;
  } catch (error) {
    if (isOutputLimit(error))
      throw new Error(`${artifactName(path)} exceeds decompressed size limit`, {
        cause: error,
      });
    throw invalidGzip(path);
  }
  if (trailerOffset + 8 > gzip.length) throw invalidGzip(path);
  if (trailerOffset + 8 < gzip.length)
    throw new Error(
      `${artifactName(path)} must contain exactly one gzip member`,
    );

  let payload: Buffer;
  try {
    payload = gunzipSync(gzip, {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
    });
  } catch (error) {
    if (isOutputLimit(error))
      throw new Error(`${artifactName(path)} exceeds decompressed size limit`, {
        cause: error,
      });
    throw invalidGzip(path);
  }
  if (gzip.readUInt32LE(trailerOffset + 4) !== payload.length >>> 0)
    throw invalidGzip(path);
  return payload;
}

function readFileSync(path: string): Buffer;
function readFileSync(path: string, encoding: 'utf8'): string;
function readFileSync(path: string, encoding?: 'utf8'): Buffer | string {
  if (encoding) return rawReadFileSync(path, encoding);
  if (path.endsWith('.gz')) {
    const metadata = lstatSync(path);
    if (!metadata.isFile())
      throw new Error(`${artifactName(path)} must be a regular file`);
    if (metadata.size > MAX_COMPRESSED_BYTES)
      throw new Error(`${artifactName(path)} exceeds compressed size limit`);
  }
  const value = rawReadFileSync(path);
  if (path.endsWith('.gz'))
    Object.defineProperty(value, 'equals', {
      value(expected: Uint8Array): boolean {
        const payload = verifiedGzipPayload(path, value);
        const authenticated = gunzipSync(Buffer.from(expected), {
          maxOutputLength: MAX_DECOMPRESSED_BYTES,
        });
        if (!payload.equals(authenticated))
          throw new Error(
            `${artifactName(path)} payload differs from authenticated source`,
          );
        return true;
      },
    });
  return value;
}

function compress(source: Buffer): Buffer {
  const gzip = gzipSync(source, { level: 9 });
  gzip.writeUInt32LE(0, 4);
  return gzip;
}

export const PINNED_IANA_SOURCE_DIRECTORY = resolve(
  __dirname,
  '../src/common/timezone/iana-tzdb-2026b',
);

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readVerifiedSources(sourceDirectory: string) {
  const version = readFileSync(join(sourceDirectory, 'version'), 'utf8').trim();
  if (version !== VERSION)
    throw new Error(`Expected IANA tzdb ${VERSION}, received ${version}`);
  return (Object.keys(SOURCE_SHA256) as Array<keyof typeof SOURCE_SHA256>).map(
    (name) => {
      const source = readFileSync(join(sourceDirectory, name));
      if (sha256(source) !== SOURCE_SHA256[name])
        throw new Error(`${name} does not match authenticated IANA ${VERSION}`);
      if (
        name === 'tzdata.zi' &&
        !source
          .subarray(0, 48)
          .toString()
          .startsWith('# version 2026b\n# dataform rearguard\n')
      )
        throw new Error('tzdata.zi is not the pinned rearguard projection');
      return { name, bytes: compress(source) };
    },
  );
}

function fileHash(path: string): string | undefined {
  try {
    if (!lstatSync(path).isFile())
      throw new Error(`${basename(path)} must be a regular file`);
    return sha256(readFileSync(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function flushDirectory(directory: string): void {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function validateLock(value: unknown): LockOwner {
  const owner = value as LockOwner;
  if (
    owner?.version !== 1 ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    !/^[0-9a-f]{24}$/.test(owner.token)
  )
    throw new Error('Invalid IANA timezone generation lock');
  return owner;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    return true;
  }
}

function readLock(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function writeLock(directory: string, name: string, owner: LockOwner): void {
  writeFileSync(join(directory, name), JSON.stringify(owner), LOCK_OPTIONS);
  flushDirectory(directory);
}

function releaseOwnedLock(directory: string, name: string, owner: LockOwner) {
  const path = join(directory, name);
  const value = validateLock(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  if (value.token !== owner.token)
    throw new Error(`IANA timezone ${name} ownership changed`);
  rmSync(path);
  flushDirectory(directory);
}

function acquireLock(directory: string): AcquiredLock {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, LOCK);
  const owner: LockOwner = {
    version: 1,
    pid: process.pid,
    token: randomBytes(12).toString('hex'),
  };
  try {
    writeLock(directory, ACQUISITION_GATE, owner);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `IANA timezone acquisition gate exists; verify no generator is running, then remove ${ACQUISITION_GATE} for manual recovery`,
        { cause: error },
      );
    throw error;
  }
  try {
    let staleOwner: LockOwner | undefined;
    for (;;) {
      try {
        writeLock(directory, LOCK, owner);
        return { owner, staleOwner };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const first = readLock(path);
        if (first === undefined) continue;
        const stale = validateLock(JSON.parse(first) as unknown);
        if (isAlive(stale.pid))
          throw new Error('IANA timezone generation is already locked', {
            cause: error,
          });
        if (readLock(path) !== first) continue;
        rmSync(path, { force: true });
        flushDirectory(directory);
        staleOwner = stale;
      }
    }
  } finally {
    releaseOwnedLock(directory, ACQUISITION_GATE, owner);
  }
}

function validateTransaction(value: unknown): ReplacementTransaction {
  const transaction = value as ReplacementTransaction;
  const targets = transaction?.artifacts
    ?.map(({ target }) => target)
    .sort()
    .join();
  if (
    transaction?.version !== 2 ||
    !/^[0-9a-f]{24}$/.test(transaction.ownerToken) ||
    !['prepared', 'replacing', 'committed'].includes(transaction.phase) ||
    !Array.isArray(transaction.artifacts) ||
    transaction.artifacts.length !== 2 ||
    targets !== 'tzdata.zi.gz,zone.tab.gz' ||
    transaction.artifacts.some(
      ({ target, staged, backup, oldHash, newHash }) =>
        basename(target) !== target ||
        basename(staged) !== staged ||
        !staged.startsWith(`${target}.`) ||
        !staged.endsWith('.tmp') ||
        (backup !== undefined &&
          (basename(backup) !== backup ||
            !backup.startsWith(`${target}.`) ||
            !backup.endsWith('.bak'))) ||
        (oldHash !== null && !HASH.test(oldHash)) ||
        !HASH.test(newHash) ||
        (oldHash === null) !== (backup === undefined),
    )
  )
    throw new Error('Invalid IANA timezone replacement transaction');
  return transaction;
}

function persistTransaction(
  directory: string,
  value: ReplacementTransaction,
  initial = false,
): void {
  const target = join(directory, JOURNAL);
  const staged = `${target}.next`;
  writeFileSync(initial ? target : staged, JSON.stringify(value), {
    flag: 'wx',
    mode: 0o600,
    flush: true,
  });
  if (!initial) renameSync(staged, target);
  flushDirectory(directory);
}

function replacementExtras(directory: string): string[] {
  return readdirSync(directory).filter(
    (name) =>
      name === `${JOURNAL}.next` ||
      /^(zone\.tab|tzdata\.zi)\.gz\..+\.(tmp|bak)$/.test(name),
  );
}

function requireHash(
  path: string,
  allowed: Array<string | undefined>,
): string | undefined {
  const actual = fileHash(path);
  if (!allowed.includes(actual))
    throw new Error(`Persisted hash invariant failed for ${basename(path)}`);
  return actual;
}

function recoverOwned(
  directory: string,
  expectedOwnerToken: string | undefined,
): void {
  const journalPath = join(directory, JOURNAL);
  if (!existsSync(journalPath)) {
    if (replacementExtras(directory).length > 0)
      throw new Error('Unowned IANA timezone replacement state exists');
    return;
  }
  const transaction = validateTransaction(
    JSON.parse(readFileSync(journalPath, 'utf8')) as unknown,
  );
  if (transaction.ownerToken !== expectedOwnerToken)
    throw new Error('IANA timezone transaction ownership is unverifiable');
  const nextPath = `${journalPath}.next`;
  if (existsSync(nextPath)) {
    const next = validateTransaction(
      JSON.parse(readFileSync(nextPath, 'utf8')) as unknown,
    );
    if (
      next.ownerToken !== transaction.ownerToken ||
      JSON.stringify(next.artifacts) !== JSON.stringify(transaction.artifacts)
    )
      throw new Error('IANA timezone phase transition is inconsistent');
  }
  const states = transaction.artifacts.map((artifact) => {
    const old = artifact.oldHash ?? undefined;
    const target = join(directory, artifact.target);
    const staged = join(directory, artifact.staged);
    const backup = artifact.backup
      ? join(directory, artifact.backup)
      : undefined;
    return {
      artifact,
      backup,
      backupHash: backup ? requireHash(backup, [undefined, old]) : undefined,
      staged,
      stagedHash: requireHash(staged, [undefined, artifact.newHash]),
      target,
      targetHash: requireHash(target, [undefined, old, artifact.newHash]),
    };
  });
  for (const state of states) {
    const { artifact, backupHash, targetHash } = state;
    if (transaction.phase === 'prepared') {
      if (
        backupHash !== undefined ||
        targetHash !== (artifact.oldHash ?? undefined)
      )
        throw new Error('Prepared IANA timezone transaction is inconsistent');
    } else if (transaction.phase === 'replacing') {
      if (
        artifact.oldHash !== null &&
        backupHash === undefined &&
        targetHash !== artifact.oldHash
      )
        throw new Error(
          'Replacing IANA timezone transaction lost its original',
        );
    } else if (targetHash !== artifact.newHash) {
      throw new Error('Committed IANA timezone transaction is incomplete');
    }
  }
  for (const { artifact, backup, staged, target } of states) {
    if (transaction.phase !== 'committed') {
      if (backup && existsSync(backup)) {
        rmSync(target, { force: true });
        renameSync(backup, target);
      } else if (artifact.oldHash === null) rmSync(target, { force: true });
    }
    rmSync(staged, { force: true });
    if (backup) rmSync(backup, { force: true });
  }
  rmSync(nextPath, { force: true });
  rmSync(journalPath);
  flushDirectory(directory);
}

function replaceAtomically(
  outputDirectory: string,
  artifacts: Array<{ name: string; bytes: Buffer }>,
  ownerToken: string,
): void {
  const path = (name: string) => join(outputDirectory, name);
  for (const { name } of artifacts) {
    const target = path(`${name}.gz`);
    if (existsSync(target) && !lstatSync(target).isFile())
      throw new Error(`${name}.gz must be a regular file`);
  }
  const nonce = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const transaction: ReplacementTransaction = {
    version: 2,
    ownerToken,
    phase: 'prepared',
    artifacts: artifacts.map(({ name, bytes }) => {
      const target = `${name}.gz`;
      const oldHash = fileHash(path(target)) ?? null;
      return {
        target,
        staged: `${target}.${nonce}.tmp`,
        backup: oldHash === null ? undefined : `${target}.${nonce}.bak`,
        oldHash,
        newHash: sha256(bytes),
      };
    }),
  };
  try {
    persistTransaction(outputDirectory, transaction, true);
    artifacts.forEach(({ bytes }, index) => {
      writeFileSync(path(transaction.artifacts[index].staged), bytes, {
        flag: 'wx',
        mode: 0o644,
        flush: true,
      });
    });
    transaction.phase = 'replacing';
    persistTransaction(outputDirectory, transaction);
    transaction.artifacts.forEach((artifact) => {
      if (artifact.backup)
        renameSync(path(artifact.target), path(artifact.backup));
    });
    transaction.artifacts.forEach((artifact) => {
      renameSync(path(artifact.staged), path(artifact.target));
    });
    flushDirectory(outputDirectory);
    transaction.phase = 'committed';
    persistTransaction(outputDirectory, transaction);
    for (const artifact of transaction.artifacts) {
      if (artifact.backup) rmSync(path(artifact.backup), { force: true });
    }
    rmSync(path(JOURNAL));
    flushDirectory(outputDirectory);
  } catch (error) {
    recoverOwned(outputDirectory, ownerToken);
    throw error;
  }
}

function assertNoReplacementState(outputDirectory: string): void {
  if (
    [JOURNAL, LOCK, ACQUISITION_GATE].some((name) =>
      existsSync(join(outputDirectory, name)),
    ) ||
    replacementExtras(outputDirectory).length > 0
  )
    throw new Error('IANA timezone replacement state exists');
}

export function generatePinnedIanaTimezoneSources(
  sourceDirectory: string,
  checkOnly: boolean,
  outputDirectory = PINNED_IANA_SOURCE_DIRECTORY,
): void {
  const artifacts = readVerifiedSources(resolve(sourceDirectory));
  if (checkOnly) {
    assertNoReplacementState(outputDirectory);
    for (const { name, bytes } of artifacts) {
      const path = join(outputDirectory, `${name}.gz`);
      if (!lstatSync(path).isFile())
        throw new Error(`${name}.gz must be a regular file`);
      if (!readFileSync(path).equals(bytes))
        throw new Error(`${name}.gz differs byte-for-byte`);
    }
  } else {
    const { owner, staleOwner } = acquireLock(outputDirectory);
    try {
      recoverOwned(outputDirectory, staleOwner?.token);
      replaceAtomically(outputDirectory, artifacts, owner.token);
    } finally {
      releaseOwnedLock(outputDirectory, LOCK, owner);
    }
  }
  process.stdout.write(
    `${JSON.stringify({ version: VERSION, sources: SOURCE_SHA256 })}\n`,
  );
}

if (require.main === module) {
  const source = process.argv.slice(2).find((value) => value !== '--check');
  if (!source)
    throw new Error('Usage: generator <authenticated-source> [--check]');
  generatePinnedIanaTimezoneSources(source, process.argv.includes('--check'));
}
