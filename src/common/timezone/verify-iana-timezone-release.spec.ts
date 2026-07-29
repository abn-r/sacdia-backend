import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const root = join(__dirname, '../../..');
const verifier = join(root, 'scripts/verify-iana-timezone-release.sh');

function executable(path: string, contents: string): void {
  fs.writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${contents}`);
  fs.chmodSync(path, 0o755);
}

function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'sacdia-iana-verifier-'));
  const archive = join(directory, 'archive');
  const signature = join(directory, 'signature');
  const calls = join(directory, 'curl-calls');
  const makeCalls = join(directory, 'make-calls');
  fs.writeFileSync(archive, 'authenticated archive');
  fs.writeFileSync(signature, 'detached signature');
  executable(
    join(directory, 'curl'),
    String.raw`printf '%s\n' "$*" >> "$FAKE_CURL_CALLS"
while (($#)); do case "$1" in --output) output="$2"; shift 2;; http*) url="$1"; shift;; *) shift;; esac; done
test "$FAKE_CURL_RESULT" = success
[[ "$url" == *.asc ]] && cp "$FAKE_SIGNATURE" "$output" || cp "$FAKE_ARCHIVE" "$output"
`,
  );
  executable(
    join(directory, 'sha512sum'),
    String.raw`read -r expected path
actual="$(node -e "const f=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha512').update(f.readFileSync(process.argv[1])).digest('hex'))" "$path")"
test "$actual" = "$expected"
`,
  );
  executable(
    join(directory, 'gpg'),
    String.raw`if [[ " $* " == *" --import "* ]]; then for argument in "$@"; do last="$argument"; done; test -s "$last"
elif [[ " $* " == *" --fingerprint "* ]]; then printf 'fpr:::::::::%s:\n' "$FAKE_KEYRING_FINGERPRINT"
elif [[ " $* " == *" --verify "* ]]; then printf '%b\n' "$FAKE_GPG_STATUS"; exit "$FAKE_GPG_VERIFY_EXIT"; else exit 2
fi
`,
  );
  executable(
    join(directory, 'tar'),
    'mkdir -p "${@: -1}"; touch "${@: -1}/version"\n',
  );
  executable(join(directory, 'gawk'), 'exit 0\n');
  executable(
    join(directory, 'make'),
    `printf 'args=%s\nlc_all=%s\n' "$*" "$LC_ALL" > "$FAKE_MAKE_CALLS"\n`,
  );
  executable(join(directory, 'pnpm'), 'exit 0\n');
  const fingerprint = '7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34';
  const env = {
    ...process.env,
    PATH: `${directory}${delimiter}${process.env.PATH}`,
    FAKE_ARCHIVE: archive,
    FAKE_SIGNATURE: signature,
    FAKE_CURL_CALLS: calls,
    FAKE_CURL_RESULT: 'success',
    FAKE_KEYRING_FINGERPRINT: fingerprint,
    FAKE_MAKE_CALLS: makeCalls,
    FAKE_GPG_STATUS: `[GNUPG:] VALIDSIG ${fingerprint} 2026-04-23 0 4 0 1 10 00 ${fingerprint}`,
    FAKE_GPG_VERIFY_EXIT: '0',
    IANA_TZDB_RELEASE_SHA512: createHash('sha512')
      .update(fs.readFileSync(archive))
      .digest('hex'),
    IANA_TZDB_SIGNER_FINGERPRINT: fingerprint,
    IANA_TZDB_SIGNER_PUBLIC_KEY_B64:
      Buffer.from('public key fixture').toString('base64'),
  };
  return { calls, directory, env, fingerprint, makeCalls };
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync('/bin/bash', [verifier], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function usingFixture(assertion: (value: ReturnType<typeof fixture>) => void) {
  const value = fixture();
  try {
    assertion(value);
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
}

describe('IANA release verifier', () => {
  it('fails closed before downloading when external trust is absent', () =>
    usingFixture((value) => {
      const env: NodeJS.ProcessEnv = { ...value.env };
      delete env.IANA_TZDB_RELEASE_SHA512;
      expect(run(env).status).not.toBe(0);
      expect(() => fs.readFileSync(value.calls)).toThrow();
    }));

  it('uses bounded HTTPS retries and accepts the expected signer', () =>
    usingFixture((value) => {
      expect(run(value.env).status).toBe(0);
      const calls = fs.readFileSync(value.calls, 'utf8');
      for (const option of [
        '--connect-timeout 10',
        '--max-time 60',
        '--retry 3',
        '--retry-all-errors',
      ])
        expect(calls).toContain(option);
      const make = fs.readFileSync(value.makeCalls, 'utf8');
      expect(make).toContain('AWK=gawk');
      expect(make).toContain('lc_all=C');
    }));

  it('fails closed before downloading when GNU awk is unavailable', () =>
    usingFixture((value) => {
      fs.rmSync(join(value.directory, 'gawk'));
      const result = run({ ...value.env, PATH: value.directory });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('gawk is required');
      expect(() => fs.readFileSync(value.calls)).toThrow();
    }));

  it('rejects mismatched trust, bad statuses and exhausted retries', () => {
    const invalid = [
      (v) => (v.env.FAKE_KEYRING_FINGERPRINT = '0'.repeat(40)),
      (v) => (v.env.IANA_TZDB_RELEASE_SHA512 = '0'.repeat(128)),
      (v) => (v.env.FAKE_GPG_STATUS = `[GNUPG:] VALIDSIG ${'1'.repeat(40)}`),
      ...['REVKEYSIG', 'EXPKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED'].map(
        (status) => (v) =>
          (v.env.FAKE_GPG_STATUS = `[GNUPG:] ${status} ${v.fingerprint}`),
      ),
      (v) => (v.env.FAKE_CURL_RESULT = 'failure'),
    ] as Array<(value: ReturnType<typeof fixture>) => void>;
    for (const mutate of invalid)
      usingFixture((value) => {
        mutate(value);
        expect(run(value.env).status).not.toBe(0);
      });
  });
});
