import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import ts from 'typescript';

const AUTHENTICATED_TZDATA_ZI_SHA256 =
  'd4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466';
const LEGACY_TZDATA_ZI_SHA256 =
  '74e9d0b6e73d16166bb55b3c19e68dbe4b9930e4b64bac17eef9ad45c8c86e88';

function compileCatalog(source: string, moduleFile: string): void {
  writeFileSync(
    moduleFile,
    ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
      },
    }).outputText,
  );
}

function loadDefault(moduleFile: string, cwd: string) {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const catalog = require(${JSON.stringify(moduleFile)})
        .loadCanonicalGeographicIanaTimezoneCatalog();
       process.stdout.write(String(catalog.metadata.canonicalCount));`,
    ],
    { cwd, encoding: 'utf8' },
  );
}

function readCatalogSource(): string {
  return readFileSync(
    join(__dirname, 'canonical-geographic-iana-timezone.ts'),
    'utf8',
  ).replace(LEGACY_TZDATA_ZI_SHA256, AUTHENTICATED_TZDATA_ZI_SHA256);
}

describe('canonical timezone catalog packaging', () => {
  it('attests the authenticated tzdata.zi hash across payload and metadata', () => {
    const root = join(__dirname, '../../..');
    const payload = gunzipSync(
      readFileSync(join(__dirname, 'iana-tzdb-2026b/tzdata.zi.gz')),
    );
    expect(createHash('sha256').update(payload).digest('hex')).toBe(
      AUTHENTICATED_TZDATA_ZI_SHA256,
    );
    for (const path of [
      join(__dirname, 'canonical-geographic-iana-timezone.ts'),
      join(root, 'scripts/generate-geographic-iana-timezone-sources.ts'),
      join(__dirname, 'iana-tzdb-2026b/README.md'),
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain(AUTHENTICATED_TZDATA_ZI_SHA256);
      expect(source).not.toContain(LEGACY_TZDATA_ZI_SHA256);
    }
  });

  it('declares both gzip sources as Nest dist assets', () => {
    const root = join(__dirname, '../../..');
    const config = JSON.parse(
      readFileSync(join(root, 'nest-cli.json'), 'utf8'),
    ) as { compilerOptions: { assets: Array<Record<string, unknown>> } };
    expect(config.compilerOptions.assets).toContainEqual({
      include: 'common/timezone/iana-tzdb-2026b/*.gz',
      outDir: 'dist/src',
    });
  });

  it('loads from a dist-only module layout without depending on CWD', () => {
    const root = mkdtempSync(join(tmpdir(), 'sacdia-iana-dist-'));
    const moduleDirectory = join(root, 'dist/src/common/timezone');
    const moduleFile = join(
      moduleDirectory,
      'canonical-geographic-iana-timezone.js',
    );
    const sourceDirectory = join(__dirname, 'iana-tzdb-2026b');
    const assetDirectory = join(moduleDirectory, 'iana-tzdb-2026b');
    const unrelatedCwd = join(root, 'runtime');
    mkdirSync(assetDirectory, { recursive: true });
    mkdirSync(unrelatedCwd);
    for (const file of ['zone.tab.gz', 'tzdata.zi.gz'])
      copyFileSync(join(sourceDirectory, file), join(assetDirectory, file));
    const source = readCatalogSource();
    try {
      compileCatalog(source, moduleFile);
      expect(loadDefault(moduleFile, unrelatedCwd)).toMatchObject({
        status: 0,
        stdout: '418',
      });

      compileCatalog(
        source.replace(
          'moduleDirectory = __dirname',
          'moduleDirectory = process.cwd()',
        ),
        moduleFile,
      );
      expect(loadDefault(moduleFile, unrelatedCwd).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never falls back to timezone assets beneath process CWD', () => {
    const root = mkdtempSync(join(tmpdir(), 'sacdia-iana-cwd-'));
    const moduleDirectory = join(root, 'dist/src/common/timezone');
    const moduleFile = join(
      moduleDirectory,
      'canonical-geographic-iana-timezone.js',
    );
    const cwd = join(root, 'runtime');
    const cwdAssetDirectory = join(cwd, 'src/common/timezone/iana-tzdb-2026b');
    const sourceDirectory = join(__dirname, 'iana-tzdb-2026b');
    mkdirSync(moduleDirectory, { recursive: true });
    mkdirSync(cwdAssetDirectory, { recursive: true });
    for (const file of ['zone.tab.gz', 'tzdata.zi.gz'])
      copyFileSync(join(sourceDirectory, file), join(cwdAssetDirectory, file));
    try {
      compileCatalog(readCatalogSource(), moduleFile);
      expect(loadDefault(moduleFile, cwd).status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
