#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

readonly VERSION=2026b
readonly ARCHIVE="tzdata${VERSION}.tar.gz"
readonly URL="https://data.iana.org/time-zones/releases/${ARCHIVE}"
: "${IANA_TZDB_RELEASE_SHA512:?protected release SHA-512 is required}"
: "${IANA_TZDB_SIGNER_FINGERPRINT:?protected signer fingerprint is required}"
: "${IANA_TZDB_SIGNER_PUBLIC_KEY_B64:?protected signer public key is required}"
[[ "$IANA_TZDB_RELEASE_SHA512" =~ ^[0-9a-f]{128}$ ]]
[[ "$IANA_TZDB_SIGNER_FINGERPRINT" =~ ^[0-9A-F]{40}$ ]]
command -v gawk >/dev/null 2>&1 || {
  echo 'gawk is required for deterministic tzdata.zi generation' >&2
  exit 1
}
readonly SHA512="$IANA_TZDB_RELEASE_SHA512"
readonly FINGERPRINT="$IANA_TZDB_SIGNER_FINGERPRINT"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

readonly -a CURL_OPTIONS=(
  --fail --show-error --silent --location --proto '=https' --tlsv1.2
  --connect-timeout 10 --max-time 60 --retry 3 --retry-delay 2
  --retry-max-time 120 --retry-all-errors
)
curl "${CURL_OPTIONS[@]}" --output "$workdir/$ARCHIVE" "$URL"
curl "${CURL_OPTIONS[@]}" --output "$workdir/$ARCHIVE.asc" "$URL.asc"
if command -v sha512sum >/dev/null; then
  echo "$SHA512  $workdir/$ARCHIVE" | sha512sum -c -
else
  echo "$SHA512  $workdir/$ARCHIVE" | shasum -a 512 -c -
fi
export GNUPGHOME="$workdir/gnupg"
mkdir -m 700 "$GNUPGHOME"
node -e '
  const encoded = process.env.IANA_TZDB_SIGNER_PUBLIC_KEY_B64;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    process.exit(1);
  process.stdout.write(Buffer.from(encoded, "base64"));
' >"$workdir/signer.asc"
test -s "$workdir/signer.asc"
gpg --batch --import "$workdir/signer.asc"
actual="$(gpg --batch --with-colons --fingerprint "$FINGERPRINT" |
  awk -F: '$1 == "fpr" { print $10; exit }')"
test "$actual" = "$FINGERPRINT"
status="$workdir/gpg.status"
if ! gpg --batch --status-fd=1 --verify \
  "$workdir/$ARCHIVE.asc" "$workdir/$ARCHIVE" >"$status"; then
  cat "$status" >&2
  exit 1
fi
awk -v expected="$FINGERPRINT" '
  $2 ~ /^(REVKEYSIG|EXPKEYSIG|KEYEXPIRED|SIGEXPIRED|BADSIG|ERRSIG|NO_PUBKEY)$/ {
    bad = 1
  }
  $2 == "VALIDSIG" {
    valid++
    if ($3 != expected && $NF != expected) mismatch = 1
  }
  END { exit !(valid == 1 && !bad && !mismatch) }
' "$status"

mkdir "$workdir/source"
tar -xzf "$workdir/$ARCHIVE" -C "$workdir/source"
make -C "$workdir/source" -o version DATAFORM=rearguard AWK=gawk tzdata.zi
pnpm exec tsx scripts/generate-geographic-iana-timezone-sources.ts \
  "$workdir/source" --check
