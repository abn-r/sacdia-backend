import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync as rawReadFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync, gzipSync, inflateRawSync } from 'node:zlib';

const VERSION = '2026b';
const SOURCE_SHA256 = {
  'zone.tab':
    '4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c',
  'tzdata.zi':
    'd4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466',
} as const;
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

function assertRegularTargets(outputDirectory: string, names: string[]): void {
  for (const name of names) {
    const target = join(outputDirectory, `${name}.gz`);
    if (existsSync(target) && !lstatSync(target).isFile())
      throw new Error(`${name}.gz must be a regular file`);
  }
}

function replaceAtomically(
  outputDirectory: string,
  artifacts: Array<{ name: string; bytes: Buffer }>,
): void {
  mkdirSync(outputDirectory, { recursive: true });
  assertRegularTargets(
    outputDirectory,
    artifacts.map(({ name }) => name),
  );
  const nonce = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const paths = artifacts.map(({ name }) => {
    const target = join(outputDirectory, `${name}.gz`);
    return {
      target,
      staged: `${target}.${nonce}.tmp`,
      backup: existsSync(target) ? `${target}.${nonce}.bak` : undefined,
    };
  });
  const movedBackups: Array<{ target: string; backup: string }> = [];
  const installedTargets: string[] = [];
  try {
    artifacts.forEach(({ bytes }, index) =>
      writeFileSync(paths[index].staged, bytes, {
        flag: 'wx',
        mode: 0o644,
        flush: true,
      }),
    );
    paths.forEach(({ target, backup }) => {
      if (backup) {
        renameSync(target, backup);
        movedBackups.push({ target, backup });
      }
    });
    paths.forEach(({ target, staged }) => {
      renameSync(staged, target);
      installedTargets.push(target);
    });
  } catch (error) {
    installedTargets.forEach((target) => rmSync(target, { force: true }));
    movedBackups.reverse().forEach(({ target, backup }) => {
      if (backup && existsSync(backup)) renameSync(backup, target);
    });
    throw error;
  } finally {
    paths.forEach(({ staged, backup }) => {
      rmSync(staged, { force: true });
      if (backup && installedTargets.length === paths.length)
        rmSync(backup, { force: true });
    });
  }
}

export function generatePinnedIanaTimezoneSources(
  sourceDirectory: string,
  checkOnly: boolean,
  outputDirectory = PINNED_IANA_SOURCE_DIRECTORY,
): void {
  const artifacts = readVerifiedSources(resolve(sourceDirectory));
  if (checkOnly) {
    assertRegularTargets(
      outputDirectory,
      artifacts.map(({ name }) => name),
    );
    for (const { name, bytes } of artifacts)
      if (!readFileSync(join(outputDirectory, `${name}.gz`)).equals(bytes))
        throw new Error(`${name}.gz differs byte-for-byte`);
  } else replaceAtomically(outputDirectory, artifacts);
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
