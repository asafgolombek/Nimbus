# Nimbus — Claude Code Context

## Project Overview

Nimbus is a **local-first AI agent framework** — a headless Bun Gateway process that maintains a private SQLite index of the user's data across cloud services (Google Drive, Gmail, Google Photos, OneDrive, Outlook, Microsoft Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord opt-in, Jenkins, GitHub Actions, CircleCI, GitLab CI, PagerDuty, Kubernetes, AWS, Azure, GCP, IaC CLIs, Grafana, Sentry, New Relic, Datadog, optional `[[filesystem.roots]]` indexing, and the local filesystem via first-party MCP connectors) and executes multi-step agentic workflows on their behalf. Clients (CLI and Tauri 2.0 desktop app) communicate with the Gateway exclusively over JSON-RPC 2.0 IPC.

**Runtime:** Bun v1.2+ / TypeScript 6.x strict
**Linter:** Biome
**License:** AGPL-3.0 (gateway/cli/mcp-connectors) + MIT (sdk)
**Status:** Phase 3.5 ✅ Complete; **Phase 4** — Presence 🔵 Active (WS1–4 ✅ · WS5-A ✅ · WS5-B ✅ · WS5-C ✅)

**Gemini CLI:** [`GEMINI.md`](./GEMINI.md) mirrors this file for the same repository — update both when changing commands, roadmap rows, or non-negotiables.

---

## Non-Negotiables

These constraints are architectural, not preferences. Do not suggest changes that violate them:

| # | Constraint | Implementation |
|---|---|---|
| 1 | **Local-first** | Machine is the source of truth; cloud is a connector |
| 2 | **HITL is structural** | Consent gate is in the executor, not the prompt; cannot be bypassed or configured away |
| 3 | **No plaintext credentials** | Vault only (DPAPI/Keychain/libsecret); never in logs/IPC/config |
| 4 | **MCP as connector standard** | Engine never calls cloud APIs directly |
| 5 | **Platform equality** | Windows/macOS/Linux are equally supported; PRs gate on Ubuntu (`pr-quality`); pushes run the full 3-OS matrix |
| 6 | **AGPL-3.0 core / MIT SDK** | Dual license is intentional; do not change license fields |
| 7 | **No `any`** | Use `unknown` for external data; TypeScript strict mode is non-negotiable |

---

## Key File Locations

| File | Purpose |
|---|---|
| `packages/gateway/src/engine/executor.ts` | HITL gate — `HITL_REQUIRED` frozen set; most security-critical file |
| `packages/gateway/src/platform/index.ts` | PAL — `createPlatformServices()` dispatch |
| `packages/gateway/src/platform/win32.ts` | Windows platform implementation |
| `packages/gateway/src/platform/darwin.ts` | macOS platform implementation |
| `packages/gateway/src/platform/linux.ts` | Linux platform implementation |
| `packages/gateway/src/vault/index.ts` | `NimbusVault` interface |
| `packages/gateway/src/auth/google-access-token.ts` | Google per-service OAuth token resolution — `resolveGoogleOAuthVaultKey()`, `anyGoogleOAuthVaultPresent()` |
| `packages/gateway/src/auth/oauth-vault-tokens.ts` | Generic OAuth token storage/refresh helpers — `getValidVaultOAuthAccessToken()`, `microsoftOAuthAccessFromConfig()` |
| `packages/gateway/src/connectors/` | MCP connector mesh (`lazy-mesh.ts` — Phase 3 bundle spawns AWS/Azure/GCP/IaC/observability MCPs when vault keys exist) |
| `packages/gateway/src/connectors/health.ts` | Connector health state machine — `transitionHealth()`, `ConnectorHealthSnapshot` |
| `packages/gateway/src/connectors/connector-vault.ts` | Per-service OAuth vault key helpers — `perServiceOAuthVaultKey()`, `writePerServiceOAuthKey()`, `migrateToPerServiceOAuthKeys()` (Phase 4) |
| `packages/gateway/src/connectors/connector-secrets-manifest.ts` | `CONNECTOR_VAULT_SECRET_KEYS` — per-connector PAT/API-key vault manifest; `clearConnectorVaultSecretKeys()` |
| `packages/gateway/src/connectors/remove-intent.ts` | Connector removal — cascade vault + index cleanup via `executeRemoveIntent()` |
| `packages/gateway/src/sync/connectivity.ts` | Network connectivity probe — guards the sync scheduler against consuming backoff on offline events |
| `packages/gateway/src/db/verify.ts` | `nimbus db verify` — non-destructive index integrity checks (integrity_check, FTS5, vec rowid, FK, schema version) |
| `packages/gateway/src/db/repair.ts` | `nimbus db repair` — targeted recovery actions; writes audit log entry |
| `packages/gateway/src/db/health.ts` | Disk space monitoring — polling + reactive `SQLITE_FULL` path; `DiskFullError` |
| `packages/gateway/src/db/snapshot.ts` | Manual and scheduled snapshot management |
| `packages/gateway/src/db/metrics.ts` | `IndexMetrics` — item counts, embedding coverage, query latency percentiles |
| `packages/gateway/src/db/latency-ring-buffer.ts` | In-memory ring buffer for query latency samples; async batch flush to `query_latency_log` |
| `packages/gateway/src/db/write.ts` | Central DB write wrapper — catches `SQLITE_FULL`, re-throws `DiskFullError` |
| `packages/gateway/src/telemetry/collector.ts` | Opt-in telemetry — aggregate counters only, no content, configurable endpoint |
| `packages/gateway/src/config/profiles.ts` | Named configuration profiles (`work`, `personal`); Vault key prefixing |
| `packages/gateway/src/llm/types.ts` | LLM provider interfaces — `LlmProvider`, `LlmTaskType`, `LlmModelInfo`, `LlmGenerateOptions/Result` |
| `packages/gateway/src/llm/gpu-arbiter.ts` | `GpuArbiter` — single-slot GPU VRAM mutex with activity-aware timeout |
| `packages/gateway/src/llm/ollama-provider.ts` | `OllamaProvider` — Ollama HTTP API wrapper (batch + streaming) |
| `packages/gateway/src/llm/llamacpp-provider.ts` | `LlamaCppProvider` — llama-server HTTP API wrapper |
| `packages/gateway/src/llm/router.ts` | `LlmRouter` — task-to-provider routing, air-gap enforcement, local/remote preference |
| `packages/gateway/src/llm/registry.ts` | `LlmRegistry` — model discovery, `llm_models` DB sync, availability checks |
| `packages/gateway/src/ipc/llm-rpc.ts` | `dispatchLlmRpc` — `llm.listModels` / `llm.getStatus` IPC handlers |
| `packages/gateway/src/voice/service.ts` | `VoiceService` — STT (`whisper-cli`), TTS, wake-word loop |
| `packages/gateway/src/voice/tts.ts` | `NativeTtsProvider` — `say` (macOS), PowerShell SAPI (Windows), `espeak-ng`/`spd-say` (Linux) |
| `packages/gateway/src/ipc/voice-rpc.ts` | `dispatchVoiceRpc` — `voice.*` IPC handlers |
| `packages/gateway/src/engine/coordinator.ts` | `AgentCoordinator` — multi-agent sub-task orchestration, depth + tool-call guards |
| `packages/gateway/src/engine/sub-agent.ts` | `runSubAgent` — single sub-task executor with `sub_task_results` DB lifecycle |
| `packages/gateway/src/index/llm-models-v16-sql.ts` | V16 migration SQL — `llm_models` table + `sync_state.context_window_tokens` |
| `packages/gateway/src/index/sub-task-results-v17-sql.ts` | V17 migration SQL — `sub_task_results` table for multi-agent persistence |
| `packages/gateway/src/ipc/http-server.ts` | Read-only local HTTP API (`localhost` only, `SQLITE_OPEN_READONLY` connection) |
| `packages/gateway/src/ipc/metrics-server.ts` | Prometheus-compatible metrics endpoint (`localhost` only, off by default) |
| `packages/gateway/src/ipc/lan-crypto.ts` | NaCl box keypair generation, `sealBoxFrame` / `openBoxFrame` for LAN E2E encryption |
| `packages/gateway/src/ipc/lan-pairing.ts` | `PairingWindow` — single-use base58 pairing code with 5-minute expiry |
| `packages/gateway/src/ipc/lan-rate-limit.ts` | `LanRateLimiter` — per-IP sliding-window failure tracking and lockout |
| `packages/gateway/src/ipc/lan-rpc.ts` | `LanError`, `checkLanMethodAllowed` — forbidden-method and write-grant enforcement for LAN peers |
| `packages/gateway/src/ipc/lan-server.ts` | `LanServer` — `Bun.listen` TCP server; length-framed, NaCl box encrypted RPC after pairing handshake |
| `packages/gateway/src/ipc/updater-rpc.ts` | `dispatchUpdaterRpc` — `updater.getStatus`, `updater.checkNow`, `updater.applyUpdate`, `updater.rollback` |
| `packages/gateway/src/updater/updater.ts` | `Updater` state machine — manifest fetch, semver compare, download, Ed25519 verify, install |
| `packages/gateway/src/updater/manifest-fetcher.ts` | `fetchUpdateManifest` — typed manifest fetch with `AbortController` timeout |
| `packages/gateway/src/updater/signature-verifier.ts` | `verifyBinarySignature` — Ed25519 over SHA-256 of binary |
| `packages/gateway/src/updater/public-key.ts` | Embedded Ed25519 updater public key; `NIMBUS_DEV_UPDATER_PUBLIC_KEY` override for tests |
| `packages/gateway/src/index/lan-peers-v19-sql.ts` | V19 migration SQL — `lan_peers` table |
| `packages/gateway/src/ipc/` | JSON-RPC 2.0 IPC server |
| `packages/cli/src/index.ts` | CLI entry point |
| `packages/cli/src/ipc-client/` | IPC client + consent channel |
| `packages/cli/src/commands/query.ts` | `nimbus query` — structured index query with `--sql` guard |
| `packages/cli/src/commands/config.ts` | `nimbus config get/set/list/validate/edit` |
| `packages/cli/src/commands/profile.ts` | `nimbus profile create/list/switch/delete` |
| `packages/cli/src/commands/diag.ts` | `nimbus diag` — full diagnostic snapshot; `slow-queries` subcommand |
| `packages/cli/src/commands/doctor.ts` | `nimbus doctor` — environment health checks, actionable remediation output |
| `packages/cli/src/commands/telemetry.ts` | `nimbus telemetry show/disable` |
| `packages/sdk/src/index.ts` | `@nimbus-dev/sdk` public API |
| `packages/client/src/index.ts` | `@nimbus-dev/client` public API — `NimbusClient`, `MockClient` |
| `packages/ui/src/ipc/client.ts` | `NimbusIpcClient` singleton, `createIpcClient()`, `parseError()` — includes credential redaction (5 forbidden keys) |
| `packages/ui/src/ipc/types.ts` | Shared IPC types — `ConnectionState`, `DiagSnapshot`, `ConnectorSummary`, `ProfileListResult`, `TelemetryStatus`, `RouterDecision`/`RouterStatusResult`, `LlmModelInfo`/`LlmListModelsResult`, `LlmAvailabilityResult`, `LlmPullStartedResult`/`LlmPullProgressPayload`/`LlmPullTerminalPayload`, error types |
| `packages/ui/src/store/index.ts` | `useNimbusStore` — Zustand v5 store with `persist` middleware; 11 slices composed; `partialize` whitelist excludes secrets |
| `packages/ui/src/store/partialize.ts` | `persistPartialize` — 5-key whitelist + 5-key forbidden deep-scrub for Zustand persist |
| `packages/ui/src/providers/GatewayConnectionProvider.tsx` | `onConnectionState` mirror + first-run routing logic |
| `packages/ui/src/App.tsx` | `createBrowserRouter` — all UI routes including nested `/settings/*` |
| `packages/ui/src/pages/QuickQuery.tsx` | Quick Query popup page — stream + auto-close |
| `packages/ui/src/pages/Onboarding.tsx` | Onboarding wizard frame + step pills |
| `packages/ui/src/pages/Dashboard.tsx` | Dashboard page (metrics strip + connector grid + audit feed) |
| `packages/ui/src/pages/HitlPopup.tsx` | HITL popup page hosted inside the `hitl-popup` Tauri window |
| `packages/ui/src/pages/Settings.tsx` | Settings layout — `SettingsSidebar` + `<Outlet />` for nested panel routes |
| `packages/ui/src/pages/settings/ProfilesPanel.tsx` | Profiles panel — list, create, switch, delete with typed-name confirm guard |
| `packages/ui/src/pages/settings/TelemetryPanel.tsx` | Telemetry panel — toggle, counter cards, payload sample expander |
| `packages/ui/src/pages/settings/ConnectorsPanel.tsx` | Connectors panel — interval editor (60 s min inline-validated), depth selector, enable toggle, `connector.configChanged` reconcile, Dashboard deep-link highlight |
| `packages/ui/src/pages/settings/connectors/interval-parts.ts` | Interval input parser/formatter shared by `ConnectorsPanel` |
| `packages/ui/src/pages/settings/ModelPanel.tsx` | Model panel — `RouterStatus` cards, per-task default pickers, load/unload row actions, `PullDialog` launcher, re-attaches to in-flight pull via persisted `activePullId` |
| `packages/ui/src/components/settings/model/RouterStatus.tsx` | Per-task router decision cards driven by `llm.getRouterStatus`; emits `llm.setDefault` |
| `packages/ui/src/components/settings/model/PullDialog.tsx` | Streaming model pull dialog — provider radio filtered by `llm.getStatus`, 15 s stall detection via `setTimeout`, cancel via `llm.cancelPull` |
| `packages/ui/src/components/hitl/HitlPopupPage.tsx` | Head-of-queue consent dialog; Approve / Reject → `consent.respond` |
| `packages/ui/src/components/hitl/StructuredPreview.tsx` | Recursive, XSS-safe preview of `consent.request` details |
| `packages/ui/src/components/chrome/Sidebar.tsx` | Labelled sidebar nav with pending-HITL badge |
| `packages/ui/src/components/chrome/PageHeader.tsx` | Page title + profile/health pill |
| `packages/ui/src/components/dashboard/ConnectorTile.tsx` | Single connector card with health dot + degradation tooltip |
| `packages/ui/src/components/settings/SettingsSidebar.tsx` | Settings secondary nav — 7 panel entries with `NavLink` active styling |
| `packages/ui/src/components/settings/PanelHeader.tsx` | Shared panel title + description + optional live-status pill |
| `packages/ui/src/components/settings/PanelError.tsx` | Error state with optional Retry button |
| `packages/ui/src/components/settings/StaleChip.tsx` | Offline / stale indicator chip |
| `packages/ui/src/components/settings/PanelComingSoon.tsx` | Placeholder for panels not yet implemented |
| `packages/ui/src/hooks/useIpcQuery.ts` | Typed polling hook (pauses on hidden / disconnected) |
| `packages/ui/src/hooks/useIpcSubscription.ts` | Typed Tauri event listener hook |
| `packages/ui/src/hooks/useConfirm.tsx` | Inline confirm dialog hook — supports typed-name confirmation |
| `packages/ui/src/lib/restart.ts` | `restartApp()` — invokes Tauri `plugin:app\|restart`; fallback to `location.reload()` |
| `packages/ui/src/store/slices/dashboard.ts` | Dashboard store slice (metrics / connectors / audit / highlight) |
| `packages/ui/src/store/slices/hitl.ts` | HITL pending-request FIFO queue |
| `packages/ui/src/store/slices/settings.ts` | Settings slice — `activePanel` navigation state |
| `packages/ui/src/store/slices/profile.ts` | Profile slice — list, active, `lastFetchAt`, `actionInFlight`; persisted |
| `packages/ui/src/store/slices/telemetry.ts` | Telemetry slice — `TelemetryStatus` + `telemetryActionInFlight`; transient |
| `packages/ui/src/store/slices/connectors.ts` | Connectors slice — `PersistedConnectorRow[]` (persisted) + transient `perServiceInFlight` + `highlightService` + `patchConnectorRow` |
| `packages/ui/src/store/slices/model.ts` | Model slice — `installedModels` + `activePullId` (persisted) + transient `routerStatus`, `pullProgress`, `pullStalled`, `loadedKeys` |
| `packages/ui/src-tauri/src/hitl_popup.rs` | HITL popup window lifecycle — spawn / focus / close |
| `docs/manual-smoke-ws5b.md` | WS5-B manual smoke checklist |
| `docs/manual-smoke-ws5c.md` | WS5-C manual smoke checklist |
| `packages/ui/src/pages/settings/DataPanel.tsx` | Data panel — Export/Import/Delete wizard launcher with preflight stats |
| `packages/ui/src/components/settings/data/ExportWizard.tsx` | Export wizard — passphrase gate, zxcvbn, overwrite confirm, progress, seed display |
| `packages/ui/src/components/settings/data/ImportWizard.tsx` | Import wizard — passphrase + recovery-seed auth, version-compat error handling |
| `packages/ui/src/components/settings/data/DeleteServiceDialog.tsx` | Delete service dialog — preflight preview, typed-name confirm, `data.delete` call |
| `packages/ui/src/store/slices/data.ts` | Data store slice — exportFlow / importFlow / deleteFlow state machines + markDisconnected |
| `packages/ui/src-tauri/src/gateway_bridge.rs` | Rust IPC bridge — `ALLOWED_METHODS` (38), `NO_TIMEOUT_METHODS` (4), `GLOBAL_BROADCAST_METHODS` (`profile.switched`), `rpc_call`, reconnect loop |
| `packages/ui/src-tauri/src/tray.rs` | System tray icon, menu, state forwarding |
| `packages/ui/src-tauri/src/quick_query.rs` | Quick Query window lifecycle — spawn/focus, focus-loss close |
| `packages/ui/src-tauri/src/lib.rs` | Tauri app entry — plugins, tray init, global shortcut, macOS accessory mode |
| `packages/ui/src-tauri/capabilities/default.json` | Tauri capability set — windows, permissions |
| `docs/manual-smoke-ws5a.md` | WS5-A manual smoke checklist |
| `docs/architecture.md` | Full subsystem design — read before modifying any subsystem |
| `docs/mission.md` | Project principles — read before adding features |
| `docs/roadmap.md` | Phases, acceptance criteria, Phase 3 delivered summary |

---

## Development Workflow

**Worktree directory:** `.worktrees/` (project-local, git-ignored)

When setting up isolated workspaces for feature branches, use `.worktrees/<branch-name>`.

---

## Commands

```bash
# Install all dependencies
bun install

# Type check all packages
bun run typecheck

# Lint (Biome — format + lint)
bun run lint
bun run lint:fix

# Run all unit tests
bun test

# Run with coverage
bun run test:coverage

# Coverage gates (enforced in CI)
bun run test:coverage:engine       # ≥85% threshold (engine)
bun run test:coverage:vault        # ≥90% threshold (vault)
bun run test:coverage:embedding    # ≥80% threshold (embedding)
bun run test:coverage:workflow     # ≥80% threshold (workflow runner + store)
bun run test:coverage:watcher      # ≥80% threshold (watcher engine + store + anomaly stub)
bun run test:coverage:extensions   # ≥85% threshold (extension registry + manifest + verify)
# Phase 3.5 coverage gates
bun run test:coverage:db           # ≥85% threshold (verify, repair, snapshot, health, metrics, latency buffer)
bun run test:coverage:health       # ≥85% threshold (connectors/health.ts)
bun run test:coverage:config       # ≥80% threshold (config loader, profiles, env overrides)
bun run test:coverage:client       # ≥80% threshold (@nimbus-dev/client)
bun run test:coverage:telemetry    # ≥85% threshold (telemetry collector — payload safety gate)
bun run test:coverage:doctor       # ≥80% threshold (nimbus doctor checks)
# Phase 4 WS4 coverage gates
bun run test:coverage:updater      # ≥80% threshold (updater state machine + manifest fetcher)
bun run test:coverage:lan          # ≥80% threshold (lan-crypto, lan-pairing, lan-rate-limit, lan-rpc, lan-server)

# Phase 4 WS5-A UI coverage gate (Vitest — separate runner)
cd packages/ui && bunx vitest run --coverage  # ≥80% lines / ≥75% branches

# Integration tests
bun run test:integration

# E2E CLI tests
bun run test:e2e:cli

# UI component tests (Vitest — separate from bun test)
cd packages/ui && bunx vitest run
cd packages/ui && bunx vitest run --coverage  # with branch/line coverage report

# Build all packages
bun run build

# Clean all build outputs
bun run clean

# Security audit
bun audit --audit-level high
bun run audit:high                 # same as above (root script)

# Headless binary bundle + Linux .deb / tarball (after compiling gateway + CLI to dist/)
# Optional: set NIMBUS_EMBEDDING_MODEL_DIR to pre-downloaded MiniLM weights (or pass --embedding-model-dir) to embed them in the bundle output
bun run package:headless
bun run package:installers:linux -- --version 0.1.0

# Phase 3.5 CLI commands (reference — not bun scripts)
# nimbus query --service github --type pr --since 7d --json
# nimbus query --sql "SELECT title FROM items WHERE pinned = 1" --pretty
# nimbus config get <key> / set <key> <value> / list / validate / edit
# nimbus profile create <name> / list / switch <name> / delete <name>
# nimbus diag [--json]
# nimbus diag slow-queries [--limit N] [--since <duration>]
# nimbus doctor
# nimbus db verify
# nimbus db repair [--yes]
# nimbus db snapshot
# nimbus db restore <snapshot>
# nimbus db snapshots list / backups list
# nimbus db prune [--yes]
# nimbus telemetry show
# nimbus telemetry disable
# nimbus serve [--port 7474]
# nimbus docs [topic]
# nimbus connector history <name>
# nimbus connector reindex <name> [--depth <metadata_only|summary|full>]

# Phase 4 WS3 — Data Sovereignty
# nimbus data export --output <path.tar.gz> --passphrase <pw> [--no-index]
# nimbus data import <path.tar.gz> [--passphrase <pw> | --recovery-seed <mnemonic>]
# nimbus data delete --service <name> [--dry-run] [--yes]
# nimbus audit verify [--full] [--since <id>]
# nimbus audit export --output <path.json>

# Phase 4 WS4 — Release Infrastructure
# nimbus update --check              # check for update; exit 1 if available, 0 if current
# nimbus update [--yes]              # download, verify Ed25519 signature, invoke platform installer
# nimbus lan enable [--allow-pairing]  # start LAN server; open 5-min pairing window (optional)
# nimbus lan disable                 # stop LAN server
# nimbus lan pair <host-ip> <code>   # exchange X25519 keys with a host using pairing code
# nimbus lan status                  # show LAN server state and paired peers
# nimbus lan list-peers              # list paired peers with id, direction, write-allowed
# nimbus lan grant-write <peer-id>   # allow peer to call write/HITL methods
# nimbus lan revoke-write <peer-id>  # remove write grant
# nimbus lan remove-peer <peer-id>   # unpair a peer

# Phase 4 env-var overrides (multi-agent loop guards)
# NIMBUS_MAX_AGENT_DEPTH=3          max sub-agent recursion depth (1–10; default 3)
# NIMBUS_MAX_TOOL_CALLS_PER_SESSION=20  hard cap on tool calls per session (1–200; default 20)
# Exceeding either fires agent.gasLimitReached and halts new decomposition.

# Phase 4 WS4 env-var overrides
# NIMBUS_UPDATER_URL=<url>           override update manifest URL (default: official endpoint)
# NIMBUS_UPDATER_DISABLE=true        disable auto-update checks entirely
# NIMBUS_LAN_PORT=<port>             override LAN TCP listen port (default: 7475)
# NIMBUS_DEV_UPDATER_PUBLIC_KEY=<base64>  override embedded Ed25519 public key (tests only)

# Docs site (packages/docs)
bun run docs:build                     # from repo root (workspace filter)
cd packages/docs && bunx astro build   # build static docs site
cd packages/docs && bunx astro dev     # local dev server

# Extension author CI template (copy into extension repo `.github/workflows/`)
# docs/templates/nimbus-extension-ci.yml

# Publish @nimbus-dev/client (triggered by git tag client-v*)
# git tag client-v0.1.0 && git push origin client-v0.1.0
```

---

## Architecture Summary

```
[CLI]  [Tauri UI]
  |         |
  └────┬────┘
       │ JSON-RPC 2.0 IPC
       │ (domain socket / named pipe)
       ▼
[Gateway Process]
  ├── Engine (Mastra)
  │     ├── Intent Router (LLM classification)
  │     ├── Task Planner (step decomposition)
  │     ├── HITL Consent Gate  ←── structural, frozen whitelist
  │     └── Tool Executor      ←── dispatches to MCP connectors only
  ├── Platform Abstraction Layer (PAL)
  │     ├── win32.ts   (Named Pipe, DPAPI, Registry autostart)
  │     ├── darwin.ts  (Unix Socket, Keychain, LaunchAgents)
  │     └── linux.ts   (Unix Socket, libsecret, systemd/XDG)
  ├── Secure Vault  (NimbusVault interface → PAL implementation)
  ├── Local Index   (bun:sqlite metadata + sqlite-vec embeddings)
  ├── Connector Mesh (MCPClient → MCP server processes)
  └── Extension Registry (sandboxed child processes, SHA-256 verified)
```

---

## Package Dependency Rules

```
gateway    ← no imports from cli or ui
cli        ← IPC-only communication with gateway (no source imports)
ui         ← IPC-only communication with gateway (no source imports)
sdk        ← no imports from gateway, cli, or ui
mcp-connectors/*  ← depend on @nimbus-dev/sdk only
```

Circular dependencies are forbidden. The CLI and UI never import Gateway TypeScript.

---

## Testing Philosophy

A system that orchestrates real actions against real data cannot rely on developer confidence. Every behavioral contract is verified by automated tests on all three platforms.

- **HITL tests** prove the gate fires for every action type in the whitelist, before the connector is called
- **Vault tests** prove no secret value is exposed through any interface
- **Integration tests** use real SQLite, real Bun subprocesses, fresh temp dirs per test — no mocks at the DB layer
- **E2E CLI tests** use a real Gateway subprocess + mock MCP servers (wire protocol, no real cloud calls)
- **Coverage gates** are enforced in CI: Engine ≥85%, Vault ≥90%, Embedding ≥80%, plus scheduler, rate limiter, and people thresholds (see `.github/workflows/_test-suite.yml`)

---

## Roadmap Context

> Full roadmap with acceptance criteria and inter-quarter dependencies: [`docs/roadmap.md`](./docs/roadmap.md)

| Phase | Theme | Status |
|---|---|---|
| Phase 1 | Foundation — Gateway, PAL, Vault, filesystem connector, HITL, CLI, CI | ✅ Complete |
| Phase 2 | The Bridge — 15 MCP connectors, unified index, people graph, context ranker, installers | ✅ Complete |
| Phase 3 | Intelligence — Semantic layer, extensions, CI/CD + cloud MCPs, workflows, watchers | ✅ Complete |
| Phase 3.5 | Observability — Connector health model, `nimbus query` / `diag` / `doctor` / `db`, config profiles, `@nimbus-dev/client`, telemetry, docs site | ✅ Complete |
| Phase 4 | Presence — Tauri UI, VS Code ext, local LLM (Ollama), multi-agent, data portability | 🔵 Active |
| Phase 5 | The Extended Surface — browser/reading, IMAP, finance, CRM, HR, design connectors; Marketplace v2 | Planned |
| Phase 6 | Team — federation, Team Vault, shared namespaces, SSO/SCIM, multi-user HITL, org policy | Planned |
| Phase 7 | The Autonomous Agent — standing approvals, scheduled tasks, incident correlation, fine-tuning, SRE loop | Planned |
| Phase 8 | Sovereign Mesh — P2P sync, mobile companion, hardware vault, DIDs, Digital Executor | Planned |
| Phase 9 | Enterprise — Docker/Helm, SIEM, compliance, SCIM, admin console, security audit, SLA | Planned |

When implementing, focus only on the current phase. Do not add Phase N+1 features in Phase N code.

---

## Subsystems (monorepo)

- `packages/gateway` — Engine, MCP mesh, Vault, local index, IPC
- `packages/cli` — Terminal client
- `packages/ui` — Tauri 2.0 + React (desktop)
- `packages/sdk` — `@nimbus-dev/sdk` for extensions (MIT)
- `packages/mcp-connectors/*` — First-party MCP servers (AGPL)

**PAL:** All OS-specific logic lives under `packages/gateway/src/platform/` and is accessed via `PlatformServices` — never import `win32` / `darwin` / `linux` from business logic.

**Prerequisites:** Bun v1.2+; Rust for building the Tauri UI (`packages/ui/src-tauri`).
