$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path $PSScriptRoot -Parent
bun (Join-Path $scriptsRoot "run-tests.ts")
