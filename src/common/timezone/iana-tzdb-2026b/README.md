# Authenticated IANA tzdb 2026b sources

SACDIA vendors deterministic gzip projections from IANA's signed
`tzdata2026b.tar.gz`, never from `/usr/share/zoneinfo`:

- Release: <https://www.iana.org/time-zones/releases/2026b>
- Archive: <https://data.iana.org/time-zones/releases/tzdata2026b.tar.gz>
- Signature: `tzdata2026b.tar.gz.asc` beside the archive
- SHA-512: `a44882258c0a7fbe587e8b73d6bb3cd5be7d4788976ea742adbbf176eb3b33e5bd7d1714b2fffe2972b1a42e7335eac39ed0bd63e819bb421550f8cae1df4f2f`
- Signer: Paul Eggert, fingerprint
  `7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34`
- Upstream commit/tag: `48c25a1ba86cb602990c0573aba7795417931bb4`
  / `2026b`

The IANA announcement publishes the checksum, signature and commit:
<https://lists.iana.org/hyperkitty/list/tz-announce@iana.org/thread/VX2Z3CBO6KHTYZNBBKFFWM7ZCI6TVCXP/>.
Upstream declares these data files public domain.

## Exact projection

After authenticating and extracting the archive, derive `tzdata.zi` with GNU
make and the upstream awk programs:

```bash
make -o version DATAFORM=rearguard tzdata.zi
pnpm exec tsx scripts/generate-geographic-iana-timezone-sources.ts \
  /path/to/extracted/tzdata2026b
```

`-o version` keeps the signed data-only archive's existing `version` file; it
avoids Makefile rules that require the separate code archive. The resulting
header is exactly `# version 2026b` plus `# dataform rearguard`. This replaces
the prior host-derived `# version 2026b-rearguard` snapshot with a reproducible
projection while retaining the same 151 Link aliases.

Generated payload SHA-256 values:

- `zone.tab`: `4d8e389e5f4b0ec0466d5b14f42e5dfb0308c4376165fcf478339afd9ddcb00c`
- rearguard `tzdata.zi`: `74e9d0b6e73d16166bb55b3c19e68dbe4b9930e4b64bac17eef9ad45c8c86e88`

`pnpm verify:iana-timezones` downloads the pinned archive and signature,
verifies SHA-512, signer fingerprint and GPG signature, reproduces rearguard,
then byte-compares both committed gzip artifacts. Upgrades require reviewing
the release identity, source and catalog hashes, membership changes, tests and
downstream preflight results in the same stack.
