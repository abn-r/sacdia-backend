#!/usr/bin/env bash
set -euo pipefail

readonly VERSION=2026b
readonly ARCHIVE="tzdata${VERSION}.tar.gz"
readonly URL="https://data.iana.org/time-zones/releases/${ARCHIVE}"
readonly SHA512="a44882258c0a7fbe587e8b73d6bb3cd5be7d4788976ea742adbbf176eb3b33e5bd7d1714b2fffe2972b1a42e7335eac39ed0bd63e819bb421550f8cae1df4f2f"
readonly FINGERPRINT="7E3792A9D8ACF7D633BC1588ED97E90E62AA7E34"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

curl -fsSLo "$workdir/$ARCHIVE" "$URL"
curl -fsSLo "$workdir/$ARCHIVE.asc" "$URL.asc"
if command -v sha512sum >/dev/null; then
  echo "$SHA512  $workdir/$ARCHIVE" | sha512sum -c -
else
  echo "$SHA512  $workdir/$ARCHIVE" | shasum -a 512 -c -
fi
export GNUPGHOME="$workdir/gnupg"
mkdir -m 700 "$GNUPGHOME"
gpg --batch --auto-key-locate wkd --locate-keys eggert@cs.ucla.edu
actual="$(gpg --batch --with-colons --fingerprint "$FINGERPRINT" |
  awk -F: '$1 == "fpr" { print $10; exit }')"
test "$actual" = "$FINGERPRINT"
gpg --batch --verify "$workdir/$ARCHIVE.asc" "$workdir/$ARCHIVE"

mkdir "$workdir/source"
tar -xzf "$workdir/$ARCHIVE" -C "$workdir/source"
make -C "$workdir/source" -o version DATAFORM=rearguard tzdata.zi
pnpm exec tsx scripts/generate-geographic-iana-timezone-sources.ts \
  "$workdir/source" --check
