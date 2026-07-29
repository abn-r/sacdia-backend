import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(__dirname, '../../..');
const verifier = join(root, 'scripts/verify-iana-timezone-release.sh');
const gpgBinary = spawnSync('which', ['gpg'], {
  encoding: 'utf8',
}).stdout.trim();
if (!gpgBinary) throw new Error('real GnuPG is required');
type KeyOptions = {
  expiration?: string;
  fakeTime?: number;
  signingSubkey?: boolean;
};

function executable(path: string, contents: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${contents}`, {
    mode: 0o755,
  });
}

function gpgResult(home: string, args: string[]) {
  return spawnSync('gpg', ['--batch', '--homedir', home, ...args], {
    encoding: 'utf8',
  });
}

function gpg(home: string, args: string[]): string {
  const result = gpgResult(home, args);
  if (result.status !== 0)
    throw new Error(JSON.stringify({ args, stderr: result.stderr }));
  return result.stdout;
}

function key(directory: string, identity: string, options: KeyOptions = {}) {
  const home = join(directory, identity.replace(/\W/g, '-'));
  spawnSync('mkdir', ['-m', '700', home]);
  const time = options.fakeTime
    ? ['--faked-system-time', `${options.fakeTime}!`]
    : [];
  gpg(home, [
    ...time,
    '--passphrase',
    '',
    '--quick-generate-key',
    `${identity} <${identity}@example.invalid>`,
    'ed25519',
    options.signingSubkey ? 'cert' : 'sign',
    options.expiration ?? '0',
  ]);
  const fingerprint = gpg(home, ['--with-colons', '--fingerprint'])
    .split('\n')
    .find((line) => line.startsWith('fpr:'))
    ?.split(':')[9];
  if (!fingerprint) throw new Error('ephemeral GPG fingerprint is unavailable');
  if (options.signingSubkey)
    gpg(home, [
      ...time,
      '--passphrase',
      '',
      '--quick-add-key',
      fingerprint,
      'ed25519',
      'sign',
      options.expiration ?? '0',
    ]);
  return {
    fingerprint,
    home,
  };
}

function fixture(options: KeyOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sacdia-real-gpg-'));
  const archive = join(directory, 'archive');
  const gpgCalls = join(directory, 'gpg-calls');
  const signature = join(directory, 'signature');
  writeFileSync(archive, 'authenticated archive');
  executable(
    join(directory, 'curl'),
    'while (($#)); do [[ "$1" == --output ]] && { output="$2"; shift 2; continue; }; url="$1"; shift; done\n[[ "$url" == *.asc ]] && cp "$REAL_SIGNATURE" "$output" || cp "$REAL_ARCHIVE" "$output"\n',
  );
  executable(
    join(directory, 'sha512sum'),
    String.raw`read -r expected path
actual="$(node -e "const f=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha512').update(f.readFileSync(process.argv[1])).digest('hex'))" "$path")"
test "$actual" = "$expected"
`,
  );
  executable(
    join(directory, 'tar'),
    'mkdir -p "${@: -1}"; touch "${@: -1}/version"\n',
  );
  executable(join(directory, 'make'), 'exit 0\n');
  executable(join(directory, 'pnpm'), 'exit 0\n');
  const signer = key(directory, 'Signer', options);
  executable(
    join(directory, 'gpg'),
    'printf \'%s\\n\' "$*" >> "$REAL_GPG_CALLS"\nexec "$REAL_GPG_BINARY" "$@"\n',
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    REAL_ARCHIVE: archive,
    REAL_GPG_BINARY: gpgBinary,
    REAL_GPG_CALLS: gpgCalls,
    REAL_SIGNATURE: signature,
    IANA_TZDB_RELEASE_SHA512: '',
    IANA_TZDB_SIGNER_FINGERPRINT: signer.fingerprint,
    IANA_TZDB_SIGNER_PUBLIC_KEY_B64: Buffer.from(
      gpg(signer.home, ['--armor', '--export', signer.fingerprint]),
    ).toString('base64'),
  };
  const refreshHash = () => {
    env.IANA_TZDB_RELEASE_SHA512 = createHash('sha512')
      .update(readFileSync(archive))
      .digest('hex');
  };
  const sign = (
    home = signer.home,
    output = signature,
    fakeTime = options.fakeTime,
  ) => {
    gpg(home, [
      ...(fakeTime ? ['--faked-system-time', `${fakeTime}!`] : []),
      '--yes',
      '--detach-sign',
      '--output',
      output,
      archive,
    ]);
  };
  return {
    archive,
    directory,
    env,
    gpgCalls,
    refreshHash,
    sign,
    signature,
    signer,
  };
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync('bash', [verifier], { cwd: root, encoding: 'utf8', env });
}

function status(value: ReturnType<typeof fixture>): string {
  return gpgResult(value.signer.home, [
    '--status-fd=1',
    '--verify',
    value.signature,
    value.archive,
  ]).stdout;
}

function expectRejectedAfterRealVerify(
  value: ReturnType<typeof fixture>,
): void {
  expect(run(value.env).status).not.toBe(0);
  expect(readFileSync(value.gpgCalls, 'utf8')).toContain('--verify');
}

function revoke(value: ReturnType<typeof fixture>): void {
  const certificate = join(
    value.signer.home,
    'openpgp-revocs.d',
    `${value.signer.fingerprint}.rev`,
  );
  const importable = join(value.directory, 'revocation.asc');
  writeFileSync(
    importable,
    readFileSync(certificate, 'utf8').replace(/^:/m, ''),
  );
  gpg(value.signer.home, ['--import', importable]);
}

function usingFixture(
  options: KeyOptions,
  assertion: (value: ReturnType<typeof fixture>) => void,
): void {
  const value = fixture(options);
  try {
    assertion(value);
  } finally {
    rmSync(value.directory, { recursive: true, force: true });
  }
}

describe('IANA verifier with real OpenPGP packets', () => {
  it('accepts a signing subkey only through its trusted primary', () =>
    usingFixture({ signingSubkey: true }, (value) => {
      value.sign();
      value.refreshHash();
      const packetStatus = status(value);
      expect(packetStatus).toMatch(
        new RegExp(
          `VALIDSIG (?!${value.signer.fingerprint}).* ${value.signer.fingerprint}$`,
          'm',
        ),
      );
      expect(run(value.env).status).toBe(0);
    }));

  it.each(['revoked', 'expired'])('rejects a %s signing key', (scenario) => {
    const fakeTime =
      scenario === 'expired'
        ? Math.floor(Date.now() / 1_000) - 4 * 86_400
        : undefined;
    usingFixture(
      { expiration: scenario === 'expired' ? '1d' : '0', fakeTime },
      (value) => {
        value.sign();
        if (scenario === 'revoked') {
          revoke(value);
          value.env.IANA_TZDB_SIGNER_PUBLIC_KEY_B64 = Buffer.from(
            gpg(value.signer.home, [
              '--armor',
              '--export',
              value.signer.fingerprint,
            ]),
          ).toString('base64');
        }
        value.refreshHash();
        const packetStatus = status(value);
        expect(packetStatus).toContain(
          `[GNUPG:] ${scenario === 'revoked' ? 'REVKEYSIG' : 'EXPKEYSIG'}`,
        );
        expectRejectedAfterRealVerify(value);
      },
    );
  });

  it.each([
    'BADSIG',
    'ERRSIG/NO_PUBKEY',
    'missing VALIDSIG',
    'multiple VALIDSIG',
  ])('rejects real gpg status: %s', (scenario) => {
    usingFixture({}, (value) => {
      if (scenario === 'ERRSIG/NO_PUBKEY') {
        const other = key(value.directory, 'Other');
        value.sign(other.home);
      } else if (scenario === 'missing VALIDSIG') {
        writeFileSync(value.signature, 'not an OpenPGP signature');
      } else {
        value.sign();
        if (scenario === 'BADSIG')
          writeFileSync(value.archive, 'substituted after signing');
        if (scenario === 'multiple VALIDSIG') {
          const second = join(value.directory, 'second-signature');
          value.sign(value.signer.home, second);
          writeFileSync(
            value.signature,
            Buffer.concat([
              readFileSync(value.signature),
              readFileSync(second),
            ]),
          );
        }
      }
      value.refreshHash();
      const packetStatus = status(value);
      if (scenario === 'BADSIG' || scenario === 'ERRSIG/NO_PUBKEY')
        for (const expected of scenario.split('/'))
          expect(packetStatus).toContain(`[GNUPG:] ${expected}`);
      else if (scenario === 'missing VALIDSIG') {
        expect(packetStatus).toContain('[GNUPG:] NODATA');
        expect(packetStatus).not.toContain('[GNUPG:] VALIDSIG');
      } else expect(packetStatus.match(/\[GNUPG:] VALIDSIG /g)).toHaveLength(2);
      expectRejectedAfterRealVerify(value);
    });
  });
});
