import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const VERSION = '2026b';
const SOURCE_SHA256 = {
  'zone.tab':
    '4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c',
  'tzdata.zi':
    '74e9d0b6e73d16166bb55b3c19e68dbe4b9930e4b64bac17eef9ad45c8c86e88',
} as const;
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
      return { name, bytes: gzipSync(source, { level: 9 }) };
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
