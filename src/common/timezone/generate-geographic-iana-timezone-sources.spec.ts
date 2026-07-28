import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  generatePinnedIanaTimezoneSources,
  PINNED_IANA_SOURCE_DIRECTORY,
} from '../../../scripts/generate-geographic-iana-timezone-sources';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sacdia-iana-generator-'));
  const source = join(root, 'source');
  const output = join(root, 'output');
  mkdirSync(source);
  cpSync(PINNED_IANA_SOURCE_DIRECTORY, output, { recursive: true });
  writeFileSync(join(source, 'version'), '2026b\n');
  for (const name of ['zone.tab', 'tzdata.zi']) {
    let value = gunzipSync(
      readFileSync(join(PINNED_IANA_SOURCE_DIRECTORY, `${name}.gz`)),
    );
    if (name === 'tzdata.zi') {
      value = Buffer.from(
        value
          .toString()
          .replace(
            '# version 2026b-rearguard\n',
            '# version 2026b\n# dataform rearguard\n',
          ),
      );
    }
    writeFileSync(join(source, name), value);
  }
  return { root, source, output };
}

describe('pinned IANA source generator', () => {
  it('accepts only the exact official 2026b rearguard recipe output', () => {
    const value = fixture();
    try {
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).not.toThrow();
      writeFileSync(join(value.source, 'version'), '2026c\n');
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).toThrow('Expected IANA tzdb 2026b');
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('checks deterministic gzip bytes rather than only payloads', () => {
    const value = fixture();
    try {
      const target = join(value.output, 'zone.tab.gz');
      writeFileSync(
        target,
        gzipSync(gunzipSync(readFileSync(target)), { level: 1 }),
      );
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).toThrow('zone.tab.gz differs byte-for-byte');
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('rejects invalid targets before changing either artifact', () => {
    const value = fixture();
    try {
      const zoneTarget = join(value.output, 'zone.tab.gz');
      const before = readFileSync(zoneTarget);
      rmSync(join(value.output, 'tzdata.zi.gz'));
      mkdirSync(join(value.output, 'tzdata.zi.gz'));
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, false, value.output),
      ).toThrow('must be a regular file');
      expect(readFileSync(zoneTarget)).toEqual(before);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('preserves both originals when staging cannot complete', () => {
    const value = fixture();
    const zoneTarget = join(value.output, 'zone.tab.gz');
    const before = readFileSync(zoneTarget);
    try {
      chmodSync(value.output, 0o500);
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, false, value.output),
      ).toThrow();
      expect(readFileSync(zoneTarget)).toEqual(before);
    } finally {
      chmodSync(value.output, 0o700);
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('resolves committed output independently from the current directory', () => {
    const value = fixture();
    const cwd = process.cwd();
    try {
      process.chdir(value.root);
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true),
      ).not.toThrow();
    } finally {
      process.chdir(cwd);
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it('pins authenticated upstream provenance in package and CI', () => {
    const root = join(__dirname, '../../..');
    const read = (path: string) => readFileSync(join(root, path), 'utf8');
    const readme = read('src/common/timezone/iana-tzdb-2026b/README.md');
    expect(readme).toContain('tzdata2026b.tar.gz.asc');
    expect(readme).toContain('7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34');
    expect(readme).toContain('make -o version DATAFORM=rearguard tzdata.zi');
    expect(read('package.json')).toContain('"verify:iana-timezones"');
    expect(read('.github/workflows/ci.yml')).toContain(
      'pnpm verify:iana-timezones',
    );
  });
});
