# Authenticated IANA tzdb 2026b sources

SACDIA vendors deterministic gzip projections from IANA's signed
`tzdata2026b.tar.gz`, never from `/usr/share/zoneinfo`:
Release `2026b` uses <https://data.iana.org/time-zones/releases/tzdata2026b.tar.gz>.
Its `tzdata2026b.tar.gz.asc` signature authenticates SHA-512 `a44882258c0a7fbe587e8b73d6bb3cd5be7d4788976ea742adbbf176eb3b33e5bd7d1714b2fffe2972b1a42e7335eac39ed0bd63e819bb421550f8cae1df4f2f`.
Signer Paul Eggert has fingerprint `7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34`; upstream is commit `48c25a1ba86cb602990c0573aba7795417931bb4` / tag `2026b`.
The IANA announcement is <https://lists.iana.org/hyperkitty/list/tz-announce@iana.org/thread/VX2Z3CBO6KHTYZNBBKFFWM7ZCI6TVCXP/>; upstream declares the data public domain.

## Exact projection

After authenticating and extracting the archive, derive `tzdata.zi` with GNU
make and GNU Awk; upstream `zishrink.awk` only sorts arrays under Gawk:

```bash
make -o version DATAFORM=rearguard AWK=gawk tzdata.zi
pnpm exec tsx scripts/generate-geographic-iana-timezone-sources.ts \
  /path/to/extracted/tzdata2026b
```

`-o version` preserves the signed data archive's version without requiring the code archive.
The output header is `# version 2026b` plus `# dataform rearguard`, retaining 151 Link aliases.
Payload SHA-256 is `4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c` for `zone.tab`
and `d4b8a2bbebff0c9a396a29ea9552441854b49d68fc6375918671b7dfa0e17466` for rearguard `tzdata.zi`.

`pnpm verify:iana-timezones` downloads the pinned archive and signature,
verifies SHA-512, signer fingerprint and GPG signature, reproduces rearguard,
then compares the exact decompressed payload of both committed gzip artifacts
with the authenticated source. The gzip container must satisfy all of these
invariants:

- regular file, at most 1 MiB compressed and 2 MiB decompressed;
- exactly one member with gzip magic, deflate compression and no trailing bytes;
- `FLG=0`, `MTIME=0`, and valid CRC/ISIZE; the OS field is not authenticated;
- exact authenticated payload bytes and SHA-256.

Generation remains gzip level 9 with zero mtime. The gzip OS byte is metadata,
and RFC 1952 permits a decompressor to ignore it, so any byte value is accepted.
SACDIA validates the rest of the fixed header but does not claim byte-identical
gzip containers across operating systems. Upgrades require reviewing the release
identity, source and catalog hashes, membership changes, tests and downstream
preflight results in the same stack.

## Provisional CI trust inputs

Owner-only CI reads repository Actions variables `IANA_TZDB_RELEASE_SHA512`,
`IANA_TZDB_SIGNER_FINGERPRINT` and `IANA_TZDB_SIGNER_PUBLIC_KEY_B64`,
not secrets or an Environment. Missing or malformed values fail before download;
moving them into the protected Environment requires the independently reviewed
`docs/runbooks/iana-timezone-trust-bootstrap.md` upgrade.
