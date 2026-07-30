import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pathModule from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  PINNED_IANA_SOURCE_DIRECTORY,
  loadCanonicalGeographicIanaTimezoneCatalog,
} from './canonical-geographic-iana-timezone';

const FILES = ['zone.tab.gz', 'tzdata.zi.gz'] as const;
type PositionalRead = (
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset: number,
  length: number,
  position: number | null,
) => number;

function spyOnReadSync(
  fsModule: typeof import('node:fs'),
): jest.SpiedFunction<PositionalRead> {
  const spy: unknown = jest.spyOn(fsModule, 'readSync');
  return spy as jest.SpiedFunction<PositionalRead>;
}

function copySources(): string {
  const directory = mkdtempSync(join(tmpdir(), 'sacdia-iana-hardening-'));
  for (const file of FILES)
    copyFileSync(
      join(PINNED_IANA_SOURCE_DIRECTORY, file),
      join(directory, file),
    );
  return directory;
}

function withSources(test: (directory: string) => void): void {
  const directory = copySources();
  try {
    test(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function descriptorCount(): number {
  const directory = process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd';
  return readdirSync(directory).length;
}

describe('canonical timezone catalog hardening', () => {
  it.each(FILES)('enforces exact compressed byte bounds for %s', (file) =>
    withSources((directory) => {
      const path = join(directory, file);
      writeFileSync(path, Buffer.alloc(65_536));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('is invalid or exceeds');

      writeFileSync(path, Buffer.alloc(65_537));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('exceeds compressed size limit');
    }),
  );

  it('rejects an oversized compressed gzip before decompression', () =>
    withSources((directory) => {
      const compressed = gzipSync(randomBytes(70_000));
      expect(compressed.length).toBeGreaterThan(65_536);
      writeFileSync(join(directory, 'tzdata.zi.gz'), compressed);
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('exceeds compressed size limit');
    }));

  it('enforces exact aggregate decompressed byte bounds', () =>
    withSources((directory) => {
      const path = join(directory, 'tzdata.zi.gz');
      writeFileSync(path, gzipSync(Buffer.alloc(262_144)));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('SHA-256 mismatch');

      writeFileSync(path, gzipSync(Buffer.alloc(262_145)));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('is invalid or exceeds 262144 bytes');
    }));

  it.each(['truncated', 'trailing', 'multimember'] as const)(
    'fails closed for a %s gzip stream',
    (kind) =>
      withSources((directory) => {
        const path = join(directory, 'tzdata.zi.gz');
        const original = readFileSync(path);
        const changed =
          kind === 'truncated'
            ? original.subarray(0, original.length - 1)
            : kind === 'trailing'
              ? Buffer.concat([original, Buffer.from('trailing garbage')])
              : Buffer.concat([original, gzipSync(Buffer.from('member'))]);
        writeFileSync(path, changed);
        expect(() =>
          loadCanonicalGeographicIanaTimezoneCatalog(directory),
        ).toThrow();
      }),
  );

  it('retries cleanly after a failed load', () =>
    withSources((directory) => {
      const path = join(directory, 'zone.tab.gz');
      const original = readFileSync(path);
      writeFileSync(path, Buffer.from('invalid gzip'));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow();

      writeFileSync(path, original);
      expect(
        loadCanonicalGeographicIanaTimezoneCatalog(directory).canonical.size,
      ).toBe(418);

      writeFileSync(path, Buffer.from('invalid gzip'));
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow();
    }));

  it('closes acquired descriptors after shrink and path replacement', () =>
    withSources((directory) => {
      const path = join(directory, 'zone.tab.gz');
      const displaced = `${path}.opened`;
      const original = readFileSync(path);
      const fsModule = require('node:fs') as typeof import('node:fs');
      const originalRead = fsModule.readSync as PositionalRead;
      const read = spyOnReadSync(fsModule);
      const before = descriptorCount();

      try {
        for (let attempt = 0; attempt < 50; attempt += 1) {
          writeFileSync(path, original);
          let shrunk = false;
          read.mockImplementation((fd, buffer, offset, length, position) => {
            if (!shrunk) {
              shrunk = true;
              writeFileSync(path, Buffer.alloc(0));
            }
            return originalRead(fd, buffer, offset, length, position);
          });
          expect(() =>
            loadCanonicalGeographicIanaTimezoneCatalog(directory),
          ).toThrow('changed while reading');
        }

        for (let attempt = 0; attempt < 50; attempt += 1) {
          writeFileSync(path, original);
          let replaced = false;
          read.mockImplementation((fd, buffer, offset, length, position) => {
            if (!replaced) {
              replaced = true;
              renameSync(path, displaced);
              writeFileSync(path, Buffer.from('invalid gzip'));
            }
            return originalRead(fd, buffer, offset, length, position);
          });
          expect(
            loadCanonicalGeographicIanaTimezoneCatalog(directory).canonical
              .size,
          ).toBe(418);
          expect(() =>
            loadCanonicalGeographicIanaTimezoneCatalog(directory),
          ).toThrow();
          rmSync(path);
          renameSync(displaced, path);
        }
        expect(descriptorCount()).toBe(before);
      } finally {
        read.mockRestore();
      }
    }));

  it.each(['fifo', 'directory'] as const)(
    'rejects a %s without blocking',
    (kind) =>
      withSources((directory) => {
        const source = join(directory, 'zone.tab.gz');
        rmSync(source);
        if (kind === 'directory') mkdirSync(source);
        else {
          const result = spawnSync('mkfifo', [source]);
          if (result.status !== 0) throw new Error('mkfifo fixture failed');
        }
        expect(() =>
          loadCanonicalGeographicIanaTimezoneCatalog(directory),
        ).toThrow('regular file');
      }),
  );

  it('rejects a Unix socket without blocking', async () => {
    const directory = copySources();
    const socket = join(directory, 'zone.tab.gz');
    rmSync(socket);
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(socket, resolve);
      });
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow();
    } finally {
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a real character device', () => {
    jest.isolateModules(() => {
      jest.doMock('node:path', () => ({
        ...pathModule,
        join: (...parts: string[]) =>
          parts.at(-1) === 'zone.tab.gz'
            ? '/dev/null'
            : pathModule.join(...parts),
      }));
      const isolated =
        require('./canonical-geographic-iana-timezone') as typeof import('./canonical-geographic-iana-timezone');
      expect(() =>
        isolated.loadCanonicalGeographicIanaTimezoneCatalog('/unused'),
      ).toThrow('regular file');
    });
    jest.dontMock('node:path');
  });

  it('handles short reads and rejects shrink, growth and unexpected EOF', () =>
    withSources((directory) => {
      const fsModule = require('node:fs') as typeof import('node:fs');
      const originalRead = fsModule.readSync;
      const positionalRead = originalRead as PositionalRead;
      const originalStat = fsModule.fstatSync;
      const shortRead = spyOnReadSync(fsModule);
      let first = true;
      shortRead.mockImplementation((fd, buffer, offset, length, position) => {
        const requested = first ? Math.min(3, length) : length;
        first = false;
        return positionalRead(fd, buffer, offset, requested, position);
      });
      expect(
        loadCanonicalGeographicIanaTimezoneCatalog(directory).canonical.size,
      ).toBe(418);
      shortRead.mockImplementationOnce(() => 0);
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('changed while reading');
      shortRead.mockRestore();

      const growth = jest.spyOn(fsModule, 'fstatSync');
      growth.mockImplementationOnce(originalStat).mockImplementationOnce(
        (fd) =>
          new Proxy(originalStat(fd), {
            get: (target, property) =>
              property === 'size'
                ? target.size + 1
                : Reflect.get(target, property),
          }),
      );
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('changed while reading');
      growth.mockRestore();

      const eof = spyOnReadSync(fsModule);
      eof.mockImplementation((fd, buffer, offset, length, position) =>
        length === 1 && position !== null
          ? 1
          : positionalRead(fd, buffer, offset, length, position),
      );
      expect(() =>
        loadCanonicalGeographicIanaTimezoneCatalog(directory),
      ).toThrow('changed while reading');
      eof.mockRestore();
    }));

  it('freezes every public catalog surface without exposing the backing sets', () => {
    const catalog = loadCanonicalGeographicIanaTimezoneCatalog();
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.metadata)).toBe(true);

    for (const exposed of [catalog.canonical, catalog.legacyAliases]) {
      expect(Object.isFrozen(exposed)).toBe(true);
      expect(() => (exposed as Set<string>).add('Mars/Olympus')).toThrow();
      expect(() => (exposed as Set<string>).delete('Africa/Abidjan')).toThrow();
      expect(() => (exposed as Set<string>).clear()).toThrow();
      expect(() => Set.prototype.add.call(exposed, 'Mars/Olympus')).toThrow();
      expect(() =>
        Reflect.apply(Set.prototype.delete, exposed, ['Africa/Abidjan']),
      ).toThrow();
      expect(() => Reflect.apply(Set.prototype.clear, exposed, [])).toThrow();
      expect(() => Object.setPrototypeOf(exposed, Set.prototype)).toThrow();
      expect(Reflect.set(exposed, 'size', 0)).toBe(false);
      expect([...exposed]).not.toContain('Mars/Olympus');
      let callbackSelf: ReadonlySet<string> | undefined;
      exposed.forEach((_value, _same, self) => (callbackSelf = self));
      expect(callbackSelf).toBe(exposed);
    }

    expect(() =>
      Object.defineProperty(catalog.metadata, 'version', { value: 'attacker' }),
    ).toThrow();
    expect(catalog.classify('Mars/Olympus', () => true)).toMatchObject({
      ok: false,
      diagnostic: 'NOT_IN_CATALOG',
    });
  });

  it('keeps real source payloads below both configured bounds', () => {
    for (const file of FILES) {
      const compressed = readFileSync(join(PINNED_IANA_SOURCE_DIRECTORY, file));
      expect(compressed.length).toBeLessThan(65_536);
      expect(gunzipSync(compressed).length).toBeLessThan(262_144);
    }
  });
});
