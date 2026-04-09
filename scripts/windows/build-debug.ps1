$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path $PSScriptRoot -Parent
bun (Join-Path $scriptsRoot "build-debug.ts")
