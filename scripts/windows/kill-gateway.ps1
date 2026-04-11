$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path $PSScriptRoot -Parent
bun (Join-Path $scriptsRoot "kill-gateway.ts")
