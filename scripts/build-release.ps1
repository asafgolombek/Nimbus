$ErrorActionPreference = "Stop"
bun (Join-Path $PSScriptRoot "build-release.ts")
