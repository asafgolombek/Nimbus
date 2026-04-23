#!/usr/bin/env bash
# nimbus-verify — verify GPG signature and SHA-256 hashes for a Nimbus release.
# See docs/verify-release-integrity.md for the full walkthrough.
set -eo pipefail

# ---- Configuration ------------------------------------------------------------

# TRUSTED_FINGERPRINTS: the set of GPG fingerprints considered valid for a
# SHA256SUMS.asc signature. During key rotation, this array carries BOTH old
# and new fingerprints for one release, then narrows to the new one.
#
# NOTE: these are PLACEHOLDER fingerprints until the maintainer completes
# docs/release/v0.1.0-prerequisites.md §3 and commits the real values here.
TRUSTED_FINGERPRINTS=(
  "0000000000000000000000000000000000000000"
)
DEFAULT_KEYSERVER="keys.openpgp.org"
GITHUB_REPO="nimbus-dev/Nimbus"

# Runtime-override: tests inject NIMBUS_VERIFY_FINGERPRINT_OVERRIDE with a
# scratch fingerprint so real releases use production FPs but tests use throwaway keys.
if [[ -n "${NIMBUS_VERIFY_FINGERPRINT_OVERRIDE:-}" ]]; then
  TRUSTED_FINGERPRINTS=("$NIMBUS_VERIFY_FINGERPRINT_OVERRIDE")
fi

# ---- Usage -------------------------------------------------------------------

usage() {
  cat <<EOF
Usage: nimbus-verify [<artifact-path>]
       nimbus-verify --version <ver>

Flags:
  --version <ver>       Download SHA256SUMS + .asc for <ver> from the GitHub
                        Release; verify all artifacts in cwd matching manifest.
  --keyserver <url>     Keyserver to fetch public key from (default: keys.openpgp.org).
  --fingerprint <fp>    Override the trusted fingerprint set. Comma-separated
                        for multi-fingerprint rotation periods.
  --no-fetch            Offline mode: don't download SHA256SUMS / key. Use what's
                        in cwd / keyring. This is the "check-only" mode.
  --help, -h            Show this message.

Exit codes:
  0  every present artifact verified (signature + hash)
  1  at least one verification failed
  2  usage error / missing prerequisite (gpg, sha256sum, curl)

See docs/verify-release-integrity.md for a full walkthrough, and docs/SECURITY.md
for the authoritative project GPG fingerprint.
EOF
  return 0
}

# ---- Argument parsing --------------------------------------------------------

VERSION=""
KEYSERVER="$DEFAULT_KEYSERVER"
NO_FETCH=0
OVERRIDE_FPS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)          VERSION="${2:?--version needs a value}"; shift 2 ;;
    --keyserver)        KEYSERVER="${2:?--keyserver needs a value}"; shift 2 ;;
    --fingerprint)      OVERRIDE_FPS="${2:?--fingerprint needs a value}"; shift 2 ;;
    --no-fetch)         NO_FETCH=1; shift ;;
    --help|-h)          usage; exit 0 ;;
    -*)                 echo "unknown flag: $1" >&2; usage >&2; exit 2 ;;
    *)                  shift ;;
  esac
done

if [[ -n "$OVERRIDE_FPS" ]]; then
  IFS=',' read -r -a TRUSTED_FINGERPRINTS <<< "$OVERRIDE_FPS"
fi

# ---- Prerequisite probes -----------------------------------------------------

if ! command -v gpg >/dev/null 2>&1; then
  echo "nimbus-verify: required tool 'gpg' not found on PATH" >&2
  echo "install hint: macOS 'brew install gnupg' / Debian 'apt install gnupg'" >&2
  exit 2
fi

# macOS ships 'shasum' (Perl Digest::SHA) but NOT 'sha256sum' (coreutils) by default.
# Probe for sha256sum first, fall back to 'shasum -a 256'. Both accept the same
# sha256sum-format manifest and both accept --ignore-missing on modern OSes
# (coreutils ≥8.25 for Linux, macOS 11+ for shasum).
if command -v sha256sum >/dev/null 2>&1; then
  SHACMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHACMD="shasum -a 256"
else
  echo "nimbus-verify: neither 'sha256sum' nor 'shasum' found on PATH" >&2
  echo "install hint: macOS ships 'shasum' by default / Debian 'apt install coreutils'" >&2
  exit 2
fi

if [[ "$NO_FETCH" -eq 0 ]] && ! command -v curl >/dev/null 2>&1; then
  echo "nimbus-verify: 'curl' required for default (non --no-fetch) mode" >&2
  exit 2
fi

# ---- Locate SHA256SUMS + .asc ------------------------------------------------

if [[ -n "$VERSION" ]] && [[ "$NO_FETCH" -eq 0 ]]; then
  BASE="https://github.com/$GITHUB_REPO/releases/download/v$VERSION"
  echo "Downloading SHA256SUMS + SHA256SUMS.asc for v$VERSION..."
  curl -fsSL "$BASE/SHA256SUMS" -o SHA256SUMS
  curl -fsSL "$BASE/SHA256SUMS.asc" -o SHA256SUMS.asc
fi

if [[ ! -f SHA256SUMS ]]; then
  echo "nimbus-verify: SHA256SUMS not found in cwd" >&2
  echo "  run with --version <ver> to fetch, or cd to the folder containing the file" >&2
  exit 2
fi

if [[ ! -f SHA256SUMS.asc ]]; then
  echo "nimbus-verify: SHA256SUMS.asc not found in cwd" >&2
  exit 2
fi

# ---- Ensure public key in keyring (bootstrap-trust output) -------------------

IMPORTED_FP=""
for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
  if gpg --list-keys "$fp" >/dev/null 2>&1; then
    IMPORTED_FP="$fp"
    break
  fi
done

if [[ -z "$IMPORTED_FP" ]]; then
  if [[ "$NO_FETCH" -eq 1 ]]; then
    echo "nimbus-verify: no trusted key in keyring and --no-fetch prevents fetch" >&2
    echo "  expected fingerprints: ${TRUSTED_FINGERPRINTS[*]}" >&2
    exit 2
  fi
  for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
    echo "Importing key $fp from $KEYSERVER ..."
    if gpg --keyserver "$KEYSERVER" --recv-keys "$fp" 2>/dev/null; then
      IMPORTED_FP="$fp"
      break
    fi
  done
  if [[ -z "$IMPORTED_FP" ]]; then
    echo "nimbus-verify: could not retrieve any trusted key from $KEYSERVER" >&2
    exit 2
  fi
fi

echo ""
echo "Imported/found GPG fingerprint: $IMPORTED_FP"
echo ""
echo "Cross-check this fingerprint against ALL FOUR sources before trusting it:"
echo "  1. docs/SECURITY.md in the Nimbus repo"
echo "  2. README.md 'Verify any download' section"
echo "  3. docs/release/SIGNING-KEY.asc (ASCII-armored public key block)"
echo "  4. The same fingerprint on $KEYSERVER"
echo ""

# ---- gpg --verify ------------------------------------------------------------

VERIFY_OUT="$(gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS 2>&1 || true)"

# Look for GOODSIG <fp> or VALIDSIG <fp> — but the FP must be in TRUSTED_FINGERPRINTS.
SIG_FP="$(echo "$VERIFY_OUT" | awk '/^\[GNUPG:\] VALIDSIG/ {print $3; exit}')"
if [[ -z "$SIG_FP" ]]; then
  echo "❌ SHA256SUMS.asc: GPG signature verification FAILED" >&2
  echo "$VERIFY_OUT" >&2
  exit 1
fi

FOUND=0
for fp in "${TRUSTED_FINGERPRINTS[@]}"; do
  if [[ "$SIG_FP" == "$fp" ]]; then
    FOUND=1; break
  fi
done

if [[ "$FOUND" -ne 1 ]]; then
  echo "❌ SHA256SUMS.asc: signed by UNTRUSTED fingerprint $SIG_FP" >&2
  echo "   trusted fingerprints: ${TRUSTED_FINGERPRINTS[*]}" >&2
  exit 1
fi

# Detect expired / revoked keys
if echo "$VERIFY_OUT" | grep -qE "\[GNUPG:\] (EXPKEYSIG|REVKEYSIG)"; then
  echo "❌ SHA256SUMS.asc: key expired or revoked" >&2
  echo "$VERIFY_OUT" >&2
  exit 1
fi

echo "✅ SHA256SUMS.asc: signature OK (fingerprint $SIG_FP)"
echo ""

# ---- Hash check ($SHACMD -c) -------------------------------------------------

# --ignore-missing: only verify files present in cwd; missing files are silently skipped.
# We still need to make sure AT LEAST ONE file was checked, otherwise a user in an
# empty directory would see a false "all OK."

CHECK_OUT="$($SHACMD --ignore-missing -c SHA256SUMS 2>&1 || true)"
# Re-check exit status explicitly; both sha256sum and shasum return non-zero on mismatch.
if ! $SHACMD --ignore-missing -c SHA256SUMS >/dev/null 2>&1; then
  # At least one present file failed. Print per-file ❌.
  echo "$CHECK_OUT" | while IFS= read -r line; do
    if [[ "$line" == *": FAILED"* ]]; then
      fname="${line%%:*}"
      echo "❌ $fname: hash MISMATCH"
    fi
  done
  exit 1
fi

# Count verified files (lines ending in ": OK")
VERIFIED=0
while IFS= read -r line; do
  if [[ "$line" == *": OK"* ]]; then
    VERIFIED=$((VERIFIED + 1))
    fname="${line%%:*}"
    echo "✅ Verified $fname: signature OK, hash OK"
  fi
done <<< "$CHECK_OUT"

if [[ "$VERIFIED" -eq 0 ]]; then
  echo "nimbus-verify: no artifacts from the manifest were present in cwd — nothing to verify" >&2
  echo "  download an artifact first, then re-run." >&2
  exit 2
fi

echo ""
echo "$VERIFIED artifact(s) verified."
exit 0
