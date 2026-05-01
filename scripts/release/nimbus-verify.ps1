<#
.SYNOPSIS
  Verify GPG signature and SHA-256 hashes for a Nimbus release.

.DESCRIPTION
  Cross-platform PowerShell mirror of scripts/release/nimbus-verify.sh.
  Requires: gpg (Gpg4win on Windows), curl. Uses .NET Get-FileHash for SHA-256.
  See docs/verify-release-integrity.md for the full walkthrough.

.PARAMETER Version
  Download SHA256SUMS + .asc for <ver> from the GitHub Release and verify
  artifacts in cwd matching the manifest.

.PARAMETER Keyserver
  Keyserver to fetch the public key from (default: keys.openpgp.org).

.PARAMETER Fingerprint
  Override the trusted fingerprint set. Comma-separated for multi-fingerprint
  rotation periods.

.PARAMETER NoFetch
  Offline mode: don't download SHA256SUMS / key. Use what's in cwd / keyring.
  This is the "check-only" mode.

.NOTES
  Exit codes:
    0  every present artifact verified
    1  at least one verification failed
    2  usage error / missing prerequisite
#>
[CmdletBinding()]
param(
  [string]$Version = "",
  [string]$Keyserver = "keys.openpgp.org",
  [string]$Fingerprint = "",
  [switch]$NoFetch
)

$ErrorActionPreference = "Stop"

# ---- Configuration ---------------------------------------------------------
# TRUSTED_FINGERPRINTS placeholder. Real values land when prerequisites §3 completes.
$TrustedFingerprints = @(
  "0000000000000000000000000000000000000000"
)
$GithubRepo = "asafgolombek/Nimbus"

if ($env:NIMBUS_VERIFY_FINGERPRINT_OVERRIDE) {
  $TrustedFingerprints = @($env:NIMBUS_VERIFY_FINGERPRINT_OVERRIDE)
}
if ($Fingerprint) {
  $TrustedFingerprints = $Fingerprint.Split(",") | ForEach-Object { $_.Trim() }
}

# ---- Prereqs ---------------------------------------------------------------
function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "nimbus-verify: required tool '$name' not found on PATH. Install Gpg4win (Windows) or gnupg (macOS/Linux)." -ErrorAction Continue
    exit 2
  }
}
Require-Command gpg
if (-not $NoFetch) { Require-Command curl }

# ---- Locate SHA256SUMS + .asc ----------------------------------------------
if ($Version -and -not $NoFetch) {
  $base = "https://github.com/$GithubRepo/releases/download/v$Version"
  Write-Host "Downloading SHA256SUMS + SHA256SUMS.asc for v$Version..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS"     -OutFile "SHA256SUMS"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.asc" -OutFile "SHA256SUMS.asc"
  } catch {
    Write-Error "nimbus-verify: download failed — $_" -ErrorAction Continue
    exit 2
  }
}

if (-not (Test-Path "SHA256SUMS")) {
  Write-Error "nimbus-verify: SHA256SUMS not found in cwd. Use -Version <ver> to fetch, or cd to the right folder." -ErrorAction Continue
  exit 2
}
if (-not (Test-Path "SHA256SUMS.asc")) {
  Write-Error "nimbus-verify: SHA256SUMS.asc not found in cwd." -ErrorAction Continue
  exit 2
}

# ---- Ensure key in keyring -------------------------------------------------
$ImportedFp = $null
foreach ($fp in $TrustedFingerprints) {
  & gpg --list-keys $fp 2>$null 1>$null
  if ($LASTEXITCODE -eq 0) { $ImportedFp = $fp; break }
}

if (-not $ImportedFp) {
  if ($NoFetch) {
    Write-Error "nimbus-verify: no trusted key in keyring and -NoFetch prevents fetch. Expected: $($TrustedFingerprints -join ', ')" -ErrorAction Continue
    exit 2
  }
  foreach ($fp in $TrustedFingerprints) {
    Write-Host "Importing key $fp from $Keyserver..."
    & gpg --keyserver $Keyserver --recv-keys $fp 2>$null
    if ($LASTEXITCODE -eq 0) { $ImportedFp = $fp; break }
  }
  if (-not $ImportedFp) {
    Write-Error "nimbus-verify: could not retrieve any trusted key from $Keyserver" -ErrorAction Continue
    exit 2
  }
}

Write-Host ""
Write-Host "Imported/found GPG fingerprint: $ImportedFp"
Write-Host ""
Write-Host "Cross-check this fingerprint against ALL FOUR sources before trusting it:"
Write-Host "  1. docs/SECURITY.md in the Nimbus repo"
Write-Host "  2. README.md 'Verify any download' section"
Write-Host "  3. docs/release/SIGNING-KEY.asc (ASCII-armored public key block)"
Write-Host "  4. The same fingerprint on $Keyserver"
Write-Host ""

# ---- gpg --verify ----------------------------------------------------------
$verifyOut = & gpg --status-fd 1 --verify SHA256SUMS.asc SHA256SUMS 2>&1 | Out-String
$validsig = [regex]::Match($verifyOut, '\[GNUPG:\] VALIDSIG (\S+)')
if (-not $validsig.Success) {
  Write-Host "❌ SHA256SUMS.asc: GPG signature verification FAILED" -ErrorAction Continue
  Write-Host $verifyOut
  exit 1
}
$sigFp = $validsig.Groups[1].Value

if ($TrustedFingerprints -notcontains $sigFp) {
  Write-Host "❌ SHA256SUMS.asc: signed by UNTRUSTED fingerprint $sigFp"
  Write-Host "   trusted fingerprints: $($TrustedFingerprints -join ', ')"
  exit 1
}

if ($verifyOut -match '\[GNUPG:\] (EXPKEYSIG|REVKEYSIG)') {
  Write-Host "❌ SHA256SUMS.asc: key expired or revoked"
  exit 1
}

Write-Host "✅ SHA256SUMS.asc: signature OK (fingerprint $sigFp)"
Write-Host ""

# ---- Hash verification -----------------------------------------------------
$manifest = Get-Content "SHA256SUMS" -ErrorAction Stop
$verified = 0
$failed = 0

foreach ($line in $manifest) {
  if (-not $line.Trim()) { continue }
  # Format: <64hex>  <filename>  (GNU sha256sum binary mode, two-space separator)
  #         <64hex> *<filename> (GNU sha256sum text mode, space + asterisk on Windows)
  if ($line -match '^([0-9a-f]{64})\s+\*?(.+)$') {
    $expectedHash = $matches[1].ToLower()
    $fname = $matches[2].Trim()
    if (-not (Test-Path -LiteralPath $fname)) {
      # Missing file: analogous to sha256sum --ignore-missing.
      continue
    }
    $actual = (Get-FileHash -Algorithm SHA256 -Path $fname).Hash.ToLower()
    if ($actual -eq $expectedHash) {
      Write-Host "✅ Verified $fname : signature OK, hash OK"
      $verified += 1
    } else {
      Write-Host "❌ $fname : hash MISMATCH (expected $expectedHash, got $actual)"
      $failed += 1
    }
  }
}

if ($failed -gt 0) {
  exit 1
}

if ($verified -eq 0) {
  Write-Error "nimbus-verify: no artifacts from the manifest were present in cwd — nothing to verify. Download an artifact first, then re-run." -ErrorAction Continue
  exit 2
}

Write-Host ""
Write-Host "$verified artifact(s) verified."
exit 0
