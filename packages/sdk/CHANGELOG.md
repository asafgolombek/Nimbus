# @nimbus-dev/sdk — Changelog

## 1.0.0 — 2026-04-19 — Plugin API v1 (stable)

First stable release. The following surface is frozen under semver — breaking changes require a major-version bump.

### Stable exports

| Export | Kind | Purpose |
|---|---|---|
| `ExtensionManifest` | type | Extension manifest shape |
| `NimbusItem` | type | Canonical item shape returned by connectors |
| `NimbusExtensionServer` | class | MCP server scaffolding for extensions |
| `MockGateway` | class | In-process Gateway stub for extension tests |
| `runContractTests` | function | Validates an extension against the v1 contract |
| `ExtensionContractError` | class | Thrown by `runContractTests` on violation |
| `AuditLogger` | type | Interface for scoped audit-log writes (new in v1) |
| `AuditEmit` | type | Function shape the Gateway injects (new in v1) |
| `createScopedAuditLogger` | function | Constructs a scoped logger (new in v1) |
| `HitlRequest` | type | Shape returned by a tool to request consent (new in v1) |
| `isHitlRequest` | function | Runtime type guard (new in v1) |

### Stability guarantee

- Removing any of the above exports requires a major version bump to v2.
- Adding a new required field to any v1 type requires a major version bump.
- Adding optional fields, new exports, or relaxing constraints is a minor bump.

### Out of scope for v1 (deferred)

- `NimbusTool`, `NimbusToolHandler`, `McpServerBuilder`, `ItemSchema`, `PersonSchema` — deferred until a real extension-author use case appears.
