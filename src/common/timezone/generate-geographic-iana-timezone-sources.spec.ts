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
  isInflateInfo,
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
  it('validates the documented zlib info shape and byte range', () => {
    const buffer = Buffer.alloc(0);
    const invalid = [
      null,
      { buffer, engine: null },
      { buffer: 'invalid', engine: { bytesWritten: 1 } },
      { buffer, engine: { bytesWritten: 1.5 } },
      { buffer, engine: { bytesWritten: 11 } },
    ];
    expect(invalid.every((value) => !isInflateInfo(value, 10))).toBe(true);
    expect(isInflateInfo({ buffer, engine: { bytesWritten: 10 } }, 10)).toBe(
      true,
    );
  });

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

  it('accepts the exact payload with arbitrary gzip OS metadata', () => {
    const value = fixture();
    try {
      const target = join(value.output, 'zone.tab.gz');
      const changed = readFileSync(target);
      changed[9] = 0xff;
      writeFileSync(target, changed);
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).not.toThrow();
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'altered payload',
      (gzip: Buffer) => {
        const payload = gunzipSync(gzip);
        payload[payload.length - 1] ^= 1;
        return gzipSync(payload, { level: 9 });
      },
      'payload differs from authenticated source',
    ],
    [
      'multiple members',
      (gzip: Buffer) =>
        Buffer.concat([gzip, gzipSync(Buffer.from('second member'))]),
      'must contain exactly one gzip member',
    ],
    [
      'trailing bytes',
      (gzip: Buffer) => Buffer.concat([gzip, Buffer.from([0])]),
      'must contain exactly one gzip member',
    ],
    [
      'FLG != 0',
      (gzip: Buffer) => {
        const changed = Buffer.from(gzip);
        changed[3] = 0x08;
        return changed;
      },
      'must use FLG=0',
    ],
    [
      'MTIME != 0',
      (gzip: Buffer) => {
        const changed = Buffer.from(gzip);
        changed[4] = 1;
        return changed;
      },
      'must use MTIME=0',
    ],
    [
      'invalid CRC',
      (gzip: Buffer) => {
        const changed = Buffer.from(gzip);
        changed[changed.length - 8] ^= 1;
        return changed;
      },
      'is not a valid gzip member',
    ],
    [
      'invalid ISIZE',
      (gzip: Buffer) => {
        const changed = Buffer.from(gzip);
        changed[changed.length - 1] ^= 1;
        return changed;
      },
      'is not a valid gzip member',
    ],
    [
      'truncated member',
      (gzip: Buffer) => gzip.subarray(0, gzip.length - 1),
      'is not a valid gzip member',
    ],
    [
      'compressed size overflow',
      () => Buffer.alloc(1024 * 1024 + 1),
      'exceeds compressed size limit',
    ],
    [
      'decompressed size overflow',
      () => gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1), { level: 9 }),
      'exceeds decompressed size limit',
    ],
  ])('rejects %s', (_case, mutate, message) => {
    const value = fixture();
    try {
      const target = join(value.output, 'zone.tab.gz');
      writeFileSync(target, mutate(readFileSync(target)));
      expect(() =>
        generatePinnedIanaTimezoneSources(value.source, true, value.output),
      ).toThrow(message);
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
    expect(readme).toContain(
      'make -o version DATAFORM=rearguard AWK=gawk tzdata.zi',
    );
    expect(read('package.json')).toContain('"verify:iana-timezones"');
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toContain('pnpm verify:iana-timezones');
    expect(workflow).toContain(
      'apt-get install --yes --no-install-recommends gawk',
    );
  });
});
