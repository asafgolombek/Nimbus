# Nimbus Roadmap

This document is the authoritative roadmap for Nimbus. [`README.md`](./README.md) carries a summary; this file contains acceptance criteria, inter-phase dependencies, and the reasoning behind sequencing decisions.

Phases are thematic, not calendar-bound. A phase begins when its dependencies are met and ends when its acceptance criteria pass — not at a quarter boundary. Phases may overlap when deliverables are independent.

> **Last updated:** 2026-04-20 — Phase 3 and Phase 3.5 complete on `main`; **Phase 4 (Presence)** is active. Phase 5+ roadmap refined with additional connector categories, cross-user conflict detection, biometric HITL, and enterprise DLP/isolation controls. Phase 5 and Phase 6 extended with data warehouse, orchestration, and BI connectors (personal-auth in Phase 5; SSO-gated in Phase 6).
 Per-connector OAuth vault keys landed. **WS1 (Local LLM + Multi-Agent) merged to `main`:** LLM provider layer (`OllamaProvider`, `LlamaCppProvider`, `LlmRouter`, `LlmRegistry`, `GpuArbiter`), `llm.*` IPC dispatcher, multi-agent infrastructure (`AgentCoordinator`, `runSubAgent`, V16/V17 schema migrations), and `engine.askStream` streaming. **WS2 (Voice Interface) merged to `main`:** Gateway-based voice service (`VoiceService`, `NativeTtsProvider`, `dispatchVoiceRpc`), `voice.*` IPC methods, `nimbus doctor` voice checks. **WS3 (Data Sovereignty) merged to `main`:** BLAKE3-chained audit log (`audit.verify`/`audit.exportAll`), portable encrypted backups (`nimbus data export/import`, BIP39 recovery seed, Argon2id envelope encryption), service-scoped GDPR deletion (`nimbus data delete`), and connector reindex depth control (`nimbus connector reindex`). **WS4 (Release Infrastructure) implemented:** Ed25519 signing plumbing + CI release workflow, `Updater` state machine with `nimbus update` CLI, `@nimbus-dev/sdk` frozen at v1.0.0 (Plugin API v1), opt-in encrypted LAN remote access (`lan-crypto`, `lan-pairing`, `lan-rate-limit`, `lan-server`, `lan-rpc`, `nimbus lan` CLI), V19 `lan_peers` migration. Pending: cert procurement, Gatekeeper/SmartScreen sign-off, mDNS host discovery (post-v0.1.0 point release). **WS5-A (App Shell Foundation) implemented:** React 19 + Tailwind v4 + Radix + Zustand + React Router v7 frontend scaffolding, Rust Tauri bridge with compile-time `ALLOWED_METHODS` allowlist, system tray + `Ctrl/Cmd+Shift+N` global-hotkey Quick Query popup, three-step onboarding wizard (Welcome → Connect → Syncing), first-run routing logic, CI coverage gate (≥80% lines / ≥75% branches on `packages/ui`). **WS5-B (System Tray & Dashboard) implemented:** System tray enhancements (health dot, pending-HITL badge, connectors menu), Dashboard page (metrics, connectors, audit feed), HITL consent dialogs (frameless popup, XSS-safe preview, deny-list autoFocus).

---

## Guiding Principles

Every roadmap decision is evaluated against the project's non-negotiables:

1. **Local-first** — machine is the source of truth; cloud is a connector
2. **HITL is structural** — consent gate is in the executor, not the prompt; cannot be bypassed or reasoned around
3. **No plaintext credentials** — Vault only; never in logs, IPC, or config
4. **MCP as connector standard** — the Engine never calls cloud APIs directly
5. **Platform equality** — Windows, macOS, and Linux are equally supported in every phase
6. **No feature creep across phases** — do not implement Phase N+1 features while Phase N is active
7. **Built for professionals** — every feature is evaluated through the lens of an on-call engineer, platform engineer, or security practitioner running systems in production; consumer-oriented affordances are out of scope

## Commercial Roadmap

Nimbus is open source (AGPL-3.0) for individual engineers. Commercial tiers fund continued development:

| Tier | Phase | Key additions |
|---|---|---|
| **Open Source** | Now | Full single-user Gateway, all connectors, CLI, local LLM, VS Code extension |
| **Team** | Phase 6 | Team Vault, shared index namespaces, LAN federation, multi-user HITL, SSO/OIDC |
| **Enterprise** | Phase 9 | SCIM provisioning, audit log shipping (SIEM), Helm/Docker, compliance tooling, SLA support |

Commercial license also available now for organizations that need to embed Nimbus in a product or require compliance guarantees before Phase 9 ships — contact the maintainers.

---

## Status Overview

| Phase | Theme | Status |
|---|---|---|
| Phase 1 | Foundation | ✅ Complete |
| Phase 2 | The Bridge | ✅ Complete |
| Phase 3 | Intelligence | ✅ Complete |
| Phase 3.5 | Observability & Developer Experience | ✅ Complete |
| Phase 4 | Presence | 🔵 Active |
| Phase 5 | The Extended Surface | Planned |
| Phase 6 | Team | Planned |
| Phase 7 | The Autonomous Agent | Planned |
| Phase 8 | Sovereign Mesh | Planned |
| Phase 9 | Enterprise | Planned |

---

## Phase 1 — Foundation ✅

**Goal:** Make the Gateway real and the security model provable.

### Delivered

- [x] Bun workspace monorepo with root `package.json` and `bunfig.toml`
- [x] CI: `pr-quality` job on PRs (Ubuntu); 3-platform matrix on push to `main`/`develop`
- [x] Nimbus Gateway process — JSON-RPC 2.0 IPC over domain socket (macOS/Linux) / named pipe (Windows)
- [x] Platform Abstraction Layer — `PlatformServices` interface + `win32`, `darwin`, `linux` implementations
- [x] Secure Vault — Windows DPAPI, macOS Keychain, Linux libsecret; `NimbusVault` interface
- [x] Local Filesystem MCP connector + SQLite metadata schema
- [x] HITL executor — `HITL_REQUIRED` frozen set; consent gate is structural, not prompt-based; audit log written before action
- [x] `nimbus` CLI: `start`, `stop`, `status`, `ask`, `search`, `vault`
- [x] Unit + integration test suite; coverage gates: Engine ≥85%, Vault ≥90%
- [x] `bun audit` + `trivy` + CodeQL security scanning in CI

### Acceptance Criteria (all met)

- `nimbus ask "find all markdown files modified this week"` executes end-to-end on Windows, macOS, and Linux
- Any destructive follow-up action triggers the HITL consent prompt before any tool call is dispatched
- Gateway cold-start time is under 100ms on all three platforms
- No credential value appears in IPC responses, logs, or stdout under any code path

---

## Phase 2 — The Bridge ✅

**Goal:** Connect every surface a developer works across — cloud storage, email, source control, communication, project tracking, and knowledge management — and unify them in the local index.

### Delivered

#### First-party MCP connectors (all with delta sync + index population)

- [x] **Google Drive** — file list, metadata, search; OAuth PKCE; `Changes` API delta; write (create/trash/move/rename) behind HITL
- [x] **Gmail** — message list, thread read, label list, draft create/send; OAuth PKCE
- [x] **Google Photos** — album list, media item metadata (not binary download); OAuth PKCE
- [x] **OneDrive** — files, folders, delete/move behind HITL; Microsoft Graph `delta` endpoint
- [x] **Outlook** — mail, calendar events, contacts; scope-gated tools (`tool-scope-policy.ts`); mail delta sync
- [x] **Microsoft Teams** — chats, channels, messages; post message behind HITL
- [x] **GitHub** — repos, PRs (open/closed/merged), issues, CI check runs; PAT auth
- [x] **GitLab** — projects, merge requests, issues, pipelines; PAT auth; self-hosted `gitlab.api_base` support
- [x] **Bitbucket** — repos, pull requests, pipelines; app-password auth
- [x] **Slack** — channels, DMs, threads, search; OAuth user token; post message/DM behind HITL
- [x] **Linear** — issues, projects, cycles, initiatives, members; API key; write behind HITL
- [x] **Jira** — issues, sprints, boards, epics, comments; API token; write behind HITL
- [x] **Notion** — pages, databases, database rows, comments; OAuth; write behind HITL
- [x] **Confluence** — spaces, pages, blog posts, inline comments; API token; write behind HITL
- [x] **Discord** (opt-in, off by default) — servers, channels, threads; bot token; read-only index

#### Infrastructure

- [x] OAuth PKCE utility — `portRange` config, `--port`/`--scopes` CLI flags, no-secret desktop PKCE; token written to Vault only
- [x] Per-provider rate limiter — token bucket per provider; `[sync.quotas]` config; `penalise()` on 429
- [x] Delta sync scheduler — `maxConcurrentSyncs` semaphore, `hasMore` immediate re-queue, `retentionDays` weekly prune, `catchUpOnRestart` config
- [x] Unified `item` schema (schema v5) — FTS5, `canonical_url` dedup with `duplicates` field, `pinned` column, `sync_state`, `sync_telemetry` tables
- [x] `person` table (schema v5) — GitHub, GitLab, Slack, Linear, Jira, Notion, Bitbucket, Microsoft, Discord handles
- [x] Cross-service people linker — Slack handle → GitHub login → Linear member → email resolves without a network call; `nimbus people` CLI + `people.*` IPC
- [x] Formal migration runner — `_schema_migrations` ledger, numbered append-only migrations, single-transaction per step
- [x] Lazy connector mesh — idle shutdown after 5 min; `registry.ensureRunning()` before dispatch; Google/Microsoft bundles
- [x] `nimbus connector` CLI: `auth`, `list`, `sync`, `pause`, `resume`, `status`, `remove`, `set-interval`
- [x] Engine context ranker + `searchLocalIndex`, `fetchMoreIndexResults`, `resolvePerson` agent tools
- [x] E2E test scenarios: cross-service query, identity resolution, HITL write ops, MCP connector contract
- [x] Security hardening: PKCE failure paths, OAuth vault scopes, audit payload safety, connector remove resilience
- [x] Coverage gates met: Engine ≥85%, Vault ≥90%, Sync scheduler ≥80%, Rate limiter ≥85%, People graph ≥80%
- [x] Linux headless installers (`.deb` + `.tar.gz`); Windows NSIS + macOS pkg sources

### Acceptance Criteria (all met)

- `nimbus ask "find everything I've touched across Drive, GitHub, Slack, and Linear this sprint"` returns merged, ranked results in under 200ms from the local index
- `nimbus ask "who is the most active reviewer on the payment-service repo and what are they working on in Linear?"` resolves the cross-service identity link without a network call
- Revoking a connector's auth (`nimbus connector remove google`) deletes all associated Vault entries and index rows atomically; no orphaned credentials
- All write operations through Slack, Linear, Jira, Notion, Confluence connectors trigger HITL before any outbound call

### Deferred from Phase 2 (by design)

| Topic | Resolved in |
|---|---|
| Full document content extraction (PDF/DOCX body text in FTS5) | Phase 3 — embedding pipeline + Filesystem connector v2 |
| Generic user-defined MCP connector (`nimbus connector add --mcp`) | Phase 3 — Extension Registry v1 (adds sandboxing + manifest verification) |
| Vault credential portability between machines | Phase 4 — `nimbus data export/import` |
| SQLite encryption at rest (SQLCipher) | Phase 4 — opt-in AES-256 via SQLCipher; key in OS Vault; `[db.encrypt] = true`; see Data Sovereignty section |
| Per-connector OAuth vault keys vs shared family key (`google.oauth`, `microsoft.oauth`) | Phase 3/4 consideration — shared key kept for simplicity; revisit if scope-collision UX proves painful |

---

## Phase 3 — Intelligence ✅

**Goal:** Make Nimbus semantically aware and proactively useful. Extend into CI/CD, cloud infrastructure, observability MCPs, workflows, watchers, extensions, and specialized agents.

**Status:** **Complete** on `main` (closed 2026-04). This section is the authoritative post-closure summary (the long-form Phase 3 plan doc was retired when the phase closed). **Phase 3.5** owns observability, conversational E2E harnesses, and remaining polish.

### Dependencies (met)

- Phase 2 unified metadata index
- Extension SDK + Registry v1 for safe third-party MCP / `nimbus connector add --mcp`

### Delivered

#### Semantic layer

- [x] **Embedding pipeline** — Bun worker; `@xenova/transformers` local default; `sqlite-vec` (`vec_items_384`); OpenAI opt-in; provider/model switch + resumable backfill; `MINIMUM_MODEL_VERSION` in `embedding/model.ts`
- [x] **Hybrid search** — BM25 + vector RRF; chunk dedupe / parent chunk context where implemented; `nimbus search --semantic`; quality gate: `packages/gateway/test/benchmark/search-quality.test.ts`
- [x] **RAG session memory** — per-session embedded chunks; IPC `session.*`; hourly prune; isolation tests in `session-memory-store.test.ts`

#### Extension ecosystem

- [x] **Extension Registry v1** — `nimbus.extension.json`; manifest **and** entry-point SHA-256 on startup; scaffold + install/list/enable/disable/remove; tarball / URL / local path; see `docs/contributors/extension-author-walkthrough.md`
- [ ] **Extension sandbox hardening** — full syscall/network isolation → **Phase 5** (process + scoped env today)
- [ ] **Extension Marketplace** — **Phase 4** (Tauri)

#### CI/CD and infrastructure MCP connectors

- [x] Jenkins, GitHub Actions, CircleCI, GitLab CI (pipelines/jobs + HITL)
- [x] AWS, Azure, GCP (CLI-backed tools + sync + HITL mutations)
- [x] **IaC** — Terraform / CloudFormation / Pulumi via MCP; sync heartbeat + **drift hints** (`nimbus status --drift`, `gateway.ping` `includeDrift`) — not full Terraform-state vs live reconciliation (later phase)
- [x] Kubernetes, Datadog, Grafana, Sentry, PagerDuty, New Relic

#### Automation and graph

- [x] **Workflows** — `workflow-runner` / store; `nimbus workflow`; script files `nimbus run`; dry-run / `--no-ttv` HITL safety
- [x] **Watchers** — post-sync evaluation; rate limiting + cycle detection; cron gating; startup catch-up; unit coverage in `watcher-engine.test.ts` / `watcher-store.test.ts`
- [x] **Relationship graph** — `graph_entity` / `graph_relation`; `traverseGraph`; indexed incident correlation substrate: `packages/gateway/test/e2e/scenarios/incident-correlation-indexed.e2e.test.ts`
- [x] **Filesystem intelligence (v2 scope shipped)** — `[[filesystem.roots]]`, `code_symbol`, git/deps metadata; semantic recall via shared embedding + hybrid search. Deeper vision (blame UX, multi-manifest parsers, etc.) → later phases

#### Agents and CLI

- [x] **DevOps** and **Research** agents — domain-tuned prompts and tool scoping in Gateway engine
- [x] **Session CLI** — TTY REPL (`nimbus` no args); headless bundle defaults to bundled MiniLM (`scripts/package-headless-bundle.ts`)

#### Security and quality

- [x] **Phase 3 HITL action ids** in `packages/gateway/src/engine/executor.ts` — exercised by `packages/gateway/test/e2e/scenarios/hitl-write-ops.test.ts`
- [x] **Coverage gates** — embedding ≥80%, workflow ≥80%, watcher ≥80%, extensions ≥85% (see root `package.json` + `.github/workflows/_test-suite.yml`)
- [x] **Three-platform CI** — push matrix in `.github/workflows/ci.yml`

### Intentionally incomplete (follow-ups)

| Topic | Where it lands |
|---|---|
| Full IaC drift (Terraform state vs live resource diff) | Later phase; hints only in Phase 3 |
| Proactive anomaly **user** notify (beyond log stub) | Phase 3.5+ |
| Deterministic TTY E2E for `nimbus ask` / anaphoric session turns | Phase 3.5 |
| Extension syscall sandbox | Phase 5 |

### Acceptance criteria (all met for Phase 3 closure)

- **Indexed** cross-service incident correlation (PagerDuty, GitHub PR, Jenkins, Slack, AWS-style alert) via search + graph — `incident-correlation-indexed.e2e.test.ts`; conversational `nimbus ask` on same data = manual smoke
- Contributor path documented — `docs/contributors/extension-author-walkthrough.md`
- Watcher fires within a sync cycle; downtime catch-up on restart — covered by watcher engine/store tests and gateway E2E where applicable
- `terraform plan` → HITL → `apply` — mock Terraform in `packages/mcp-connectors/iac/terraform-mock.integration.test.ts`
- `bun audit --audit-level high` clean for Phase 3 packages; `sqlite-vec` on all CI OS runners

---

## Phase 3.5 — Observability & Developer Experience ✅

**Goal:** Make Nimbus debuggable, composable, and trustworthy before the public `v0.1.0` release. Connectors, workflows, and the index are only as useful as your ability to see what they're doing, query them programmatically, and recover when things go wrong.

**Sequencing rationale:** Phase 3 delivers a large surface area of connectors and agentic capability. Phase 3.5 ensures that surface area is observable, configurable, and robust before it ships publicly. **Phase 3.5 remains a release prerequisite** — Phase 4 does not begin until the consolidated acceptance criteria in `docs/phase-3.5-plan.md` are verified on Windows, macOS, and Linux.

> **Status (2026-04-15):** Phase 3.5 is **✅ Complete**. All acceptance criteria have been verified on Windows, macOS, and Linux. `@nimbus-dev/client` is published to npm. The Starlight docs site is live. Phase 4 (Presence) is now active.

### Dependencies

- Phase 3 connector mesh and watcher system (health model builds on them)
- Phase 3 Extension Registry v1 (extension testing infrastructure builds on the SDK)

### Delivered on `main` (high level)

**Self-observability**

- [x] **`nimbus diag`** — snapshot over IPC; `--json`; `slow-queries` subcommand (`packages/cli/src/commands/diag.ts`, `packages/gateway/src/ipc/diagnostics-rpc.ts`)
- [x] **Metrics in diagnostics / status** — `diag.snapshot` carries index metrics (including query latency percentiles); `nimbus status --verbose` prints per-service item counts, total items, **p95** query latency, and per-connector health lines (`packages/cli/src/commands/status.ts`)
- [x] **Prometheus-compatible metrics endpoint** — localhost-only, off by default (`packages/gateway/src/ipc/metrics-server.ts`)
- [x] **Slow query logging** — ring buffer + SQLite persistence; surfaced via `nimbus diag slow-queries` (`packages/gateway/src/db/latency-ring-buffer.ts`, related DB tables)

**Connector health**

- [x] **Explicit health states** — persisted in `sync_state` (`healthy`, `degraded`, `error`, `rate_limited`, `unauthenticated`, `paused`); surfaced in IPC and **`nimbus connector list`** (`packages/gateway/src/connectors/health.ts`, CLI table)
- [x] **429 → `rate_limited`** — connectors throw `RateLimitError`; scheduler skips dispatch until retry window (`packages/gateway/src/sync/scheduler.ts`)
- [x] **Health history** — SQLite history + **`nimbus connector history <name>`** (`packages/gateway/src/connectors/health.ts`, `packages/cli/src/commands/connector.ts`)
- [x] **401/403 → `unauthenticated` + notification UX** — typed `UnauthenticatedError` from connectors; scheduler calls `transitionHealth` + one-shot CLI notification on auth loss (`packages/gateway/src/sync/scheduler.ts`); per-connector throws vary by connector implementation
- [x] **Agent caveat strings** — scoped `searchLocalIndex` / `fetchMoreIndexResults` attach **`connectorHealthCaveat`** when the `service` filter targets a non-healthy connector; unscoped `searchLocalIndex` may attach **`connectorHealthCaveats`** (capped list) for services present in the returned context window (`packages/gateway/src/engine/connector-health-caveat.ts`)

**Data layer**

- [x] **`nimbus query`** — structured filters, `--since` / `--until`, `--sql` read-only guard, `--json` / `--pretty` (`packages/cli/src/commands/query.ts`)
- [x] **Read-only local HTTP API** — `nimbus serve`; `GET /v1/items`, `/v1/items/:id`, `/v1/people`, `/v1/people/:id`, `/v1/connectors`, `/v1/audit`, `/v1/health` (`packages/gateway/src/ipc/http-server.ts`); item list filters share SQL with IPC via `packages/gateway/src/index/item-list-query.ts`
- [x] **`@nimbus-dev/client`** — typed IPC wrapper + `MockClient` (`packages/client/`); publish automation on tag `client-v*` (`.github/workflows/publish-client.yml`)
- [x] **Dual CJS + ESM publish shape** — `dist/index.js` (tsc ESM) + `dist/index.cjs` (bundled `require`); `exports` exposes both *[ ] first npm publish — manual sign-off (`client-v*` tag + `NPM_TOKEN`)*

**Configuration**

- [x] **`nimbus config`** — `get` / `set` / `list` / `validate` / `edit` (`packages/cli/src/commands/config.ts`); telemetry keys show file vs env where wired
- [x] **`nimbus profile`** — create / list / switch / delete (`packages/cli/src/commands/profile.ts`); Gateway profile support (`packages/gateway/src/config/profiles.ts`)
- [x] **`nimbus config list` env legend** — table lists `[telemetry]` keys with env sources; footer documents additional `NIMBUS_*` overrides (Gateway `config.ts` / `assemble.ts`)

**Data integrity & recovery**

- [x] **`nimbus db verify` / `repair` / snapshot / restore / prune / backups list`** — CLI + gateway `packages/gateway/src/db/*`
- [x] **Pre-migration backups + rollback tests** — backups under `<dataDir>/backups`; migration failure rollback covered in `packages/gateway/test/unit/db/migration-rollback.test.ts` (and FTS5 mismatch coverage in `verify.test.ts`)

**Telemetry**

- [x] **Opt-in pipeline** — `[telemetry]` TOML + env overrides, payload safety gate, `nimbus telemetry show` / `disable`, flush scheduler POST to configured endpoint (`packages/gateway/src/config/telemetry-toml.ts`, `packages/gateway/src/telemetry/*`, `packages/cli/src/commands/telemetry.ts`)
- [x] **Telemetry catalog (aggregate-only)** — flush + `telemetry.preview` include `connector_error_rate`, `sync_duration_p50_ms` (7d window), `connector_health_transitions`, `extension_installs_by_id`, `cold_start_ms` (Gateway assembly), plus latency percentiles; agent invocation histograms remain `0` until instrumented

**Documentation & extension testing**

- [x] **Starlight docs package** — `packages/docs/`; `bun run docs:build`; Pagefind search at build time; **internal links validated** on production build (`starlight-links-validator@0.23.0`, Astro 6 per Starlight peer range)
- [x] **`nimbus test` + `runContractTests`** — CLI runs manifest contract from `@nimbus-dev/sdk` before optional `bun test` (`packages/cli/src/commands/test.ts`, `packages/sdk/src/contract-tests.ts`)
- [x] **Docs hub (Phase 3.5 scope)** — Starlight site with getting started, connectors overview, query/HTTP, telemetry, client, architecture overview, FAQ, unreleased banner on home; deep per-connector pages → Phase 5+ content cadence
- [x] **Extension CI template (copy-paste)** — `docs/templates/nimbus-extension-ci.yml`; referenced from `docs/contributors/extension-author-walkthrough.md`

**Onboarding**

- [x] **`nimbus doctor`** — Bun minimum, Linux `secret-tool`, Gateway IPC + `config.validate`, `diag.snapshot` index total + per-connector health table; exit `0` / `1` / `2` for ok / warnings / hard failures (`packages/cli/src/commands/doctor.ts`)
- [x] **First-run / empty index guidance** — `nimbus start` prints next-step hints once (TTY, skip with `--no-wizard`); `nimbus ask` exits early with no connectors; Gateway `runAsk` returns onboarding text when the index has zero items

### Acceptance (all criteria met)

- [x] **`nimbus query` latency harness** — p95 < 500ms on 8k-row index; strict mode (`< 100ms`) gated by `NIMBUS_RUN_QUERY_BENCH=1`
- [x] **`bun audit --audit-level high` clean** — workspace audit passes at HIGH threshold
- [x] **`@nimbus-dev/client` published to npm** — `client-v*` tag + `NPM_TOKEN` workflow verified
- [x] **Docs editorial sign-off** — Starlight hub live; “getting started in under 10 minutes” verified on all three platforms

---

## Phase 4 — Presence 🔵

**Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations needed for a public `v0.1.0` release.

> Full implementation plan with task breakdown, file locations, and per-workstream acceptance criteria: [`docs/phase-4-plan.md`](./phase-4-plan.md)

> **Release gate:** `v0.1.0` is tagged only after all Phase 4 acceptance criteria pass on all three platforms. This phase owns the `v0.1.0` milestone.

### Dependencies

- **Phase 3.5 complete** — all Phase 3.5 acceptance criteria must pass before Phase 4 begins; the docs site, onboarding, and data integrity work are release prerequisites
- Phase 3 Extension Registry v1 (Marketplace panel depends on it)
- Phase 3 Watcher system (Watcher management UI depends on it)
- Phase 3 Workflow pipelines (pipeline editor depends on it)
- Phase 3.5 `@nimbus-dev/client` (VS Code extension depends on it)
- Phase 3.5 configuration profiles (Settings panel profile switcher depends on it)
- Code signing certificates provisioned before release build step

### Desktop Application (Tauri 2.0)

- [x] **App shell foundation (WS5-A)** — React 19 + Tailwind v4 + Radix + Zustand v5 + React Router v7 scaffolding; Rust Tauri 2.0 bridge with compile-time `ALLOWED_METHODS` allowlist (6 methods); system tray + `Ctrl/Cmd+Shift+N` Quick Query popup (frameless, 560×220, auto-close after stream); three-step onboarding wizard (Welcome → Connect → Syncing); first-run routing; macOS accessory mode; CI unit coverage gate (≥80% lines / ≥75% branches)
- [x] **System tray enhancements (WS5-B)** — aggregate-health icon (green → amber → red); pending-HITL badge; "Connectors ▸" submenu populated from `set_connectors_menu`; click navigates to Dashboard and flashes the matching tile
- [x] **Dashboard (WS5-B)** — `IndexMetricsStrip` (items · embeddings · p95 · size), `ConnectorGrid` with live `connector://health-changed` patches + empty state, `AuditFeed` (last 25); `useIpcQuery` polling hook pauses on hidden / disconnected
- [x] **HITL consent dialogs (WS5-B)** — dedicated frameless 480×360 always-on-top popup at `#/hitl-popup`; `StructuredPreview` renders details XSS-safely; destructive-action deny-list suppresses Approve `autoFocus`; Rust `pending_hitl` inbox + `consent://request`/`consent://resolved` classifier; diff view for file/code changes and optional edit-before-approve deferred to a later sub-project

#### WS5 Sub-project B acceptance

- Dashboard (metrics + connectors + audit) renders within 2 s against a populated Gateway.
- HITL popup opens within 1 s of `consent.request`; Approve / Reject → `consent.respond`.
- Tray icon reflects aggregate health (green → amber → red) via `tray://state-changed` events.
- Tray badge matches pending HITL count.
- `ALLOWED_METHODS` grew by exactly four read-side methods; no `vault.*` or `db.*` writes.
- `packages/ui` coverage ≥ 80 % lines / ≥ 75 % branches.
- [ ] **Extension Marketplace panel** — browse, install, update, disable, remove extensions; verified publisher badge; community ratings; changelog per version; auto-update toggle
- [ ] **Watcher management UI** — create, pause, delete watchers; condition builder; history of fired events
- [ ] **Workflow pipeline editor** — visual step list; run history; re-run failed steps; parameter override before run
- [ ] **Settings** — model selection (cloud vs local), sync intervals per connector, profile switcher, Vault key listing (no values shown), audit log viewer + export, data export/import, telemetry toggle

### Local LLM & Multi-Agent

- [x] **Local LLM support** — Ollama integration (model discovery, pull, load, unload via Gateway IPC); llama.cpp fallback (GGUF model files, no Ollama required); per-task model routing (fast local model for classification; remote for multi-step reasoning; configurable); fully air-gapped operation when a local model is loaded
- [x] **Multi-agent orchestration** — coordinator agent decomposes complex tasks into independent sub-tasks; sub-agents run in parallel in isolated tool scopes; all sub-agent write operations remain HITL-gated; coordinator cannot approve on behalf of the user *(loop-guard config stubs in place: `NIMBUS_MAX_AGENT_DEPTH` default 3, `NIMBUS_MAX_TOOL_CALLS_PER_SESSION` default 20; `agent.gasLimitReached` notification reserved)*

### Built-in Agent Workflows

First-party demonstrations of multi-agent orchestration and multi-connector context assembly that ship with Phase 4.

- [ ] **Meeting preparation** — `nimbus prep "<event title or time>"` resolves the calendar event, surfaces attendees via the people graph (recent PRs, open issues, Slack threads), and pulls related documents from Drive/OneDrive/Notion; output is a structured brief rendered in the TUI or Tauri UI; triggered on demand, not scheduled; no new connectors required — uses the full Phase 2 index

### VS Code Extension

- [ ] **VS Code extension** — `@nimbus-dev/client`-based IPC client (Node.js/TypeScript, separate from the Bun Gateway); connects to the running Gateway over domain socket / named pipe using the existing JSON-RPC 2.0 protocol; no new Gateway APIs required
  - Commands palette: `Nimbus: Ask`, `Nimbus: Search`, `Nimbus: Run Workflow`
  - Inline HITL consent UI — approval/rejection as a VS Code notification with structured diff preview
  - Status bar item: Gateway health + active profile name
  - Compatible with VS Code-fork hosts: Cursor, Windsurf, VSCodium, Gitpod
  - Published to Open VSX Registry and VS Code Marketplace
  - `packages/vscode-extension` workspace package; depends on `@nimbus-dev/client` only; never imports Gateway source

### Terminal Power Users

- [ ] **Rich TUI** (Ink-based) — builds on the Phase 3 Session CLI; pane layout: query input, result stream, connector health sidebar, active watcher list; keyboard navigation; SSH-safe; real-time inline HITL consent; `nimbus tui` command; also launchable from system tray

### Voice Interface

- [x] **Local STT** — `whisper-cli` subprocess called by the Gateway voice service; model: `whisper-base.en` (default) / user-selectable via config; audio never leaves the machine
- [x] **Voice queries** — `voice.transcribe` + `voice.speak` IPC methods; TTS via `NativeTtsProvider` (`say` on macOS, PowerShell SAPI on Windows, `espeak-ng`/`spd-say` on Linux)
- [x] **Wake word** (opt-in, disabled by default) — background loop in Gateway voice service; `voice.startWakeWord` / `voice.stopWakeWord` IPC

### Data Sovereignty

- [x] **Full export** — `nimbus data export --output nimbus-backup.tar.gz`: SQLite snapshot, vault credential manifest (re-encrypted with user passphrase + BIP39 recovery seed), BLAKE3 integrity hashes in manifest; `--no-index` flag to omit SQLite snapshot
- [x] **Full import** — `nimbus data import nimbus-backup.tar.gz`: verifies BLAKE3 hashes, decrypts manifest (passphrase or recovery seed), re-seals credentials into target machine's native Vault, restores index
- [x] **GDPR deletion** — `nimbus data delete --service <name>`: preflight shows counts; `--dry-run` for preview; `--yes` to confirm; removes all `item` rows and Vault entries for a service; writes `data.delete` audit entry
- [x] **Tamper-evident audit log** — each audit log row is BLAKE3-chained to the previous (V18 schema migration); `nimbus audit verify [--full] [--since <id>]` checks integrity incrementally or fully; `nimbus audit export --output <path>` exports chain
- [x] **Data minimization / connector reindex** — `nimbus connector reindex <name> [--depth <metadata_only|summary|full>]`: prunes body/embeddings at `metadata_only`, writes `data.minimization.prune` audit entry
- [ ] **SQLite encryption at rest (SQLCipher)** — opt-in AES-256 encryption of the local index; key derived from OS Vault (DPAPI/Keychain/libsecret — same trust boundary as credential storage); enabled via `[db.encrypt] = true`; resolves the Phase 2 deferral (OS filesystem encryption covers the baseline threat model; SQLCipher closes the gap for shared-machine and compliance scenarios)

### Automation & Graph Enhancements

These items resolve deferred decisions from Phase 3.

- [ ] **Graph-aware watcher conditions** — extend the watcher condition evaluator with `graph.*` condition types (`graph.has_relation`, `graph.path_exists`, `graph.neighbor_count`); uses `traverseGraph` from the Phase 3 relationship graph substrate; enables patterns like "alert when a PR author has no prior reviews" without per-watcher custom traversal code; new condition types are additive and backwards-compatible with existing Phase 3 watcher definitions
- [ ] **Workflow branching and conditionals** — extend the workflow DSL with `if` / `else` / `switch` step types; condition expressions can reference step outputs and index query results; independent branches execute in parallel where possible; DSL remains backwards-compatible with Phase 3 linear pipelines; dry-run and HITL safety apply to all branch variants
- [x] **Per-connector OAuth vault keys** — per-service keys implemented: `google_drive.oauth`, `google_gmail.oauth`, `google_photos.oauth` for Google; `onedrive.oauth`, `outlook.oauth`, `teams.oauth` for Microsoft; `nimbus connector auth` writes per-service key on each PKCE flow; Microsoft keys back-filled from `microsoft.oauth` on Gateway startup; legacy shared keys kept as fallback for Google until each service re-auths; eliminates scope-collision between Google connectors

### Remote Access

- [x] **Optional encrypted LAN remote access** — E2E encrypted (NaCl box via tweetnacl), no relay server; paired peers exchange X25519 public keys via a 120-bit base58 pairing code issued during a 5-minute window; read-only by default; write requires explicit `nimbus lan grant-write <peer-id>` on the host; `vault.*`, `updater.*`, `lan.*`, `profile.*` forbidden over LAN regardless of grant; disabled by default (`[lan] enabled = false`); mDNS host discovery deferred to a post-v0.1.0 point release

### Release Infrastructure

- [ ] Signed + notarized release binaries: macOS (Gatekeeper notarized), Windows (Authenticode signed), Linux (GPG-signed `.deb` + AppImage) — signing scripts + CI workflow in place; pending cert procurement and Gatekeeper/SmartScreen verification
- [x] Auto-update — Ed25519-signed binary manifest (`latest.json`); `Updater` state machine verifies signature before install; `nimbus update --check` / `nimbus update`; Gateway emits `updater.updateAvailable` on startup
- [x] Plugin API v1 — `@nimbus-dev/sdk` frozen at v1.0.0; `AuditLogger`, `HitlRequest`, `runContractTests` stable surface; `CHANGELOG.md` documents breaking-change policy

### Acceptance Criteria

- `v0.1.0` installers pass Gatekeeper (macOS) and SmartScreen (Windows) without user override required
- `nimbus ask "summarize everything that happened across my projects this week"` runs fully locally via Ollama — no API key, no network call — in under 30 seconds on a mid-range laptop
- Multi-agent orchestration: a task decomposed into 3 parallel sub-agents cannot bypass HITL on any write step — verified by automated test
- `nimbus data export` → wipe index and Vault → `nimbus data import` restores full functionality on a fresh machine with all connectors re-authenticated
- Five community extensions available in the Marketplace at `v0.1.0` launch *(seed plan: publish first-party connectors as community packages and engage early adopters via `docs/contributors/extension-author-walkthrough.md`)*
- VS Code extension installs from Open VSX and connects to a running Gateway without any manual configuration
- Voice query completes end-to-end (speech → Whisper.cpp transcription → Gateway → TTS playback) on all three platforms; audio never leaves the machine — verified by network inspection in CI

---

## Phase 5 — The Extended Surface

**Goal:** Fill every connector gap so that wherever a knowledge worker or developer spends time, their data is in the index. Mature the extension ecosystem. Establish Nimbus as a first-class data layer for CI/CD pipelines and external tooling.

### Dependencies

- Phase 3 Extension Registry v1 (new connectors should ship as community extensions where possible)
- Phase 3.5 `@nimbus-dev/client` and local HTTP API (CI/CD data layer depends on them)
- Phase 4 Plugin API v1 stable and documented

### New Connector Categories

#### Browser & Reading

- [ ] **Pocket / Readwise / Raindrop** — saved articles, highlights, reading lists, tags; read-only index
- [ ] **Browser history connector** — local browser extension (Chrome/Firefox/Safari) pushes visited URLs + page titles to Gateway over local HTTP; includes explicit support for local-only SQLite history indexing for Arc, Brave, and Vivaldi; no cloud relay; opt-in; history stored locally only
- [ ] **Web clipper** — browser extension saves a page into the Nimbus index with a tag; includes a browser "sidecar" UI (overlay) to show related local items without leaving the tab; surfaced in `nimbus search` alongside Drive files and emails
- [ ] **Obsidian vault connector** — indexes local Markdown vaults with frontmatter metadata, backlinks, and daily notes; uses `[[filesystem.roots]]` as the discovery mechanism; `obsidian_note` item type; backlinks surfaced in the relationship graph; append to daily note behind HITL; no network call required — fully local
- [ ] **Zotero / Mendeley** — index whitepapers, PDFs, and citations alongside technical docs; `research_paper` item type; read-only

#### Email via IMAP/SMTP

- [ ] **Generic IMAP connector** — any IMAP server (Fastmail, ProtonMail, self-hosted); credentials in Vault; `body_preview` indexing; `email.send` behind HITL via SMTP
- [ ] **Fastmail MCP connector** — JMAP native (faster and more efficient than IMAP)
- [ ] **ProtonMail MCP connector** — ProtonMail Bridge integration; local IMAP interface; read-only (E2EE precludes server-side access)
- [ ] **Apple Mail + macOS Calendar** — Apple Mail via local IMAP (no Bridge required); macOS Calendar via CalDAV (`caldav.apple.com`); macOS only; credentials in Vault; calendar events indexed as `event` items; mail indexed as `email` items with body preview; create/delete calendar event and draft send behind HITL

#### Meetings & Async Video

- [ ] **Zoom** — meeting metadata, recordings index, AI-generated transcripts (Zoom AI Companion); OAuth; read-only; `meeting.summary` and `meeting.transcript` item types; linked to calendar events via meeting URL
- [ ] **Google Meet** — meeting metadata and auto-generated transcripts via Google Workspace; OAuth (extends existing Google connector auth); read-only; indexed alongside Google Calendar events
- [ ] **Loom** — async video index: title, description, transcript, viewer stats; OAuth; read-only; `loom_video` item type

#### Finance & Expenses

- [ ] **Expensify** — expense reports, receipts, reimbursement status; read-only index; submit behind HITL
- [ ] **Ramp** — transactions, receipts, budgets, vendor spend; read-only index
- [ ] **Mercury** — business banking; balances, transactions, bills; read-only; wire/ACH behind HITL
- [ ] **Stripe** — invoices, payments, customers, disputes, subscription events; read-only; refund behind HITL

#### CRM & Sales

- [ ] **HubSpot** — contacts, companies, deals, activities, notes; OAuth; write behind HITL
- [ ] **Salesforce** — Lead, Contact, Account, Opportunity, Case; OAuth; write behind HITL
- [ ] **Pipedrive** — deals, persons, organisations, activities, notes; API key; write behind HITL

#### Support & Community

- [ ] **Zendesk / Intercom** — tickets, conversations, help articles; read-only index; correlate customer history with code/PR changes
- [ ] **Stack Overflow (Teams/Private)** — index internal knowledge base, questions, and answers; read-only

#### HR & Recruiting

- [ ] **Greenhouse** — jobs, candidates, applications, scorecards, offers; write (move stage, post feedback) behind HITL
- [ ] **Lever** — requisitions, candidates, feedback, interviews; write behind HITL
- [ ] **Workday** — time off, headcount, org chart, job postings; read-only where API access allows

#### Design & Creative

- [ ] **Figma** — files, frames, comments, version history, FigJam boards; OAuth; comment post behind HITL
- [ ] **Miro** — boards, cards, sticky notes, comments; OAuth; write behind HITL
- [ ] **Canva** — designs, folders, shared projects; OAuth; read-only index

#### Databases & Infrastructure

- [ ] **Local DB Schema Indexing** — index saved queries or schema documentation from local DB tools (pgAdmin, DBeaver, DataGrip); enables semantic recall of "that one SQL query I wrote last month"
- [ ] **Vercel / Netlify** — deployment status, preview URLs, project metadata; correlate deploys with PR/Slack history

#### Feature Flags

#### Feature Flags

- [ ] **LaunchDarkly** — flags, environments, targeting rules, flag evaluation history; API key; flag toggle behind HITL; `feature_flag` item type indexed with name, state, environments, last modified; critical for incident correlation ("was this flag enabled when the alert fired?")
- [ ] **Flagsmith** — flags, segments, environments; API key; read-only index + toggle behind HITL; self-hosted `flagsmith.api_base` support for on-premise deployments

#### GitOps & Deployment

- [ ] **ArgoCD** — applications, sync status, rollout history, health state, manifests; API token or kubeconfig; sync/rollback behind HITL; `gitops_app` item type indexed with repo, target revision, sync status, health; enables deployment correlation without Jenkins for k8s-first teams
- [ ] **Flux** — kustomizations, helm releases, sources, image automations; kubeconfig; reconcile behind HITL; read-only health and history index; complements ArgoCD coverage for teams mixing both

#### Data Warehouses, Orchestration & BI (Personal-Auth)

- [ ] **Databricks** (PAT) — workspaces, notebooks (metadata only), jobs, clusters, SQL warehouses; `data_pipeline` item type indexed with job name, status, triggering user, cluster id, started_at, duration; `job.trigger`, `job.cancel`, `cluster.restart` behind HITL
- [ ] **Metabase** (API key) — saved questions, dashboards, collections; `dashboard` item type; read-only index
- [ ] **Superset** (API key) — saved queries, dashboards, charts, datasets; `dashboard` item type; read-only index
- [ ] **Apache Airflow (OSS) / Prefect / Dagster** (API token) — DAGs/flows, tasks, task groups, run statuses, logs; `data_pipeline` item type; `orchestration.run.trigger` / `orchestration.run.cancel` behind HITL
- [ ] **Kibana / Elasticsearch** — saved searches, dashboards, Watcher alerts; `log_alarm` item type; read-only index; agent can query specific indices for error patterns during incident correlation
- [ ] **AWS CloudWatch Logs / GCP Cloud Logging** — log groups, alarms, metric filters, dashboards; `log_alarm` item type; `alarm.acknowledge` / `alarm.silence` behind HITL; agent fetches error-level logs for a service when a PagerDuty alert fires
- [ ] **BigQuery** (Application Default Credentials) — dataset / table / view schema metadata, column tags, recent expensive-query log; `data_model` item type; strictly no row data
- [ ] **AWS Athena** — catalog metadata, saved queries, recent queries; read-only
- [ ] **dbt Cloud** (API token) — projects, models, runs, tests, exposures; `data_model` item type indexed with model name, owner, tags, last-run status, upstream/downstream refs; `dbt.job.trigger` behind HITL

#### Security & Vulnerability Tooling

- [ ] **Snyk** — open source vulnerabilities, licence issues, container scan results, IaC misconfigs; API token; `vulnerability` item type indexed with severity, CVE ID, affected package, fix availability; enables CVE-to-repo-to-open-PR correlation queries from the local index
- [ ] **SonarQube / SonarCloud** — code quality issues, security hotspots, coverage, technical debt; API token; self-hosted `sonar.host_url` support; `code_issue` item type; read-only index
- [ ] **Semgrep** — SAST findings, rule matches, triage status; API token or CI output parsing; `sast_finding` item type indexed with rule ID, severity, file, line; read-only
- [ ] **Wiz** — cloud security posture findings, misconfigurations, toxic combinations, asset inventory; API token; read-only index; `cloud_finding` item type; enables "show me all critical Wiz findings for the services that paged last week" queries
- [ ] **SBOM / supply chain tracking** — ingests CycloneDX or SPDX SBOMs from CI artefacts or GitHub Dependency Graph; indexes component → repo → version relationships; enables queries like "which of my services ship lodash <4.17.21?" without touching each repo; no auth required beyond existing GitHub/GitLab connectors

### Nimbus as a CI/CD Data Layer

The local HTTP API and `@nimbus-dev/client` (Phase 3.5) unlock Nimbus as a data source for CI pipelines and external tooling. This section makes that story explicit with first-class integration points.

- [ ] **Published OpenAPI spec** — machine-readable OpenAPI 3.1 schema for all `GET /v1/*` endpoints; versioned at `/v1/openapi.json` and served by `nimbus serve`; prerequisite for the CI/CD action integrations below; enables auto-completion, contract testing, and third-party tooling without bespoke client code
- [ ] **Pre-deploy index check** — official GitHub Actions action (`nimbus-dev/query-action`) that queries the local index via the HTTP API for: active P1 incidents on the target service, failing CI runs on the target branch, open PRs with merge conflicts; can block or warn a deploy based on results
- [ ] **Post-deploy annotation** — GitHub Actions action that writes a deployment event into the Nimbus index so the agent can correlate future alerts against this specific deploy; no extra credentials required beyond the HTTP API
- [ ] **Pre-commit hook template** — `nimbus-dev/hooks` package providing a pre-commit hook that checks whether files being committed have related open Jira/Linear tickets, active incidents, or a failing pipeline on the current branch; reports findings without blocking (configurable to block)
- [ ] **`nimbus query` in CI** — documented pattern for using `nimbus query --json` inside CI pipelines (GitHub Actions, Jenkins, GitLab CI) to gate deployments, generate release notes from indexed PRs, or surface incident context in PR comments; requires Gateway running on a self-hosted runner or accessible over LAN
- [ ] **DORA Metrics** — compute the four key DORA metrics directly from already-indexed data with no new connectors required: *deployment frequency* (GitHub/GitLab releases + CI deploy runs), *lead time for changes* (PR open → merge → deploy correlation), *change failure rate* (deploy events correlated with PagerDuty/Datadog incidents within a configurable window), *mean time to restore* (incident open → resolve timestamps); exposed via `nimbus metrics dora [--service <name>] [--since 30d]` and the local HTTP API; renders in the Tauri dashboard alongside connector health

### Semantic Layer Enhancements

These items resolve deferred decisions from Phase 3.

- [ ] **Multi-model embedding** — add `vec_items_1536` virtual table for OpenAI `text-embedding-3-small` (and compatible) embeddings alongside the existing `vec_items_384` (`all-MiniLM-L6-v2`); `embedding_chunk.dims` and `embedding_chunk.model` are already recorded — schema is pre-positioned (Phase 3); per-item-type model routing: code symbols use local MiniLM by default; prose items use the configured model; `nimbus index reembed --model <id>` triggers selective backfill; multiple models can be active simultaneously with queries fan-out across matching vec tables and RRF-merged
- [ ] **Extension sandbox hardening** — enforce full syscall/network isolation for extension child processes: seccomp BPF filter on Linux, App Sandbox entitlements on macOS, AppContainer token on Windows; network access must be declared in `nimbus.extension.json` under a `permissions.network` key and enforced at the kernel level; replaces the Phase 3 honour-system env restriction; extensions without `permissions.network` run fully offline; contract tests in `@nimbus-dev/sdk` verify sandbox enforcement on all three platforms

### Extension Marketplace v2

- [ ] Community ratings and reviews per extension
- [ ] Verified publisher badges (GPG-signed manifest from a registered publisher)
- [ ] Extension monetization — paid extensions; license key enforcement via local validation; revenue sharing to publisher
- [ ] Auto-update with changelog preview; user approves each version bump
- [ ] Extension dependency resolution (one extension can depend on another)

### Acceptance Criteria

- A user with a Fastmail account can run `nimbus connector auth fastmail` and have their inbox indexed within 5 minutes using the IMAP connector
- A HubSpot deal update initiated by the agent triggers HITL before any outbound API call
- The `nimbus-dev/query-action` GitHub Actions action successfully queries a running Gateway's HTTP API and blocks a deploy when an active P1 incident is detected for the target service
- Browser history connector indexes visited pages locally; verified by network inspection in CI that no data leaves `localhost`
- A community extension published via the Marketplace can be installed, enabled, and used without the author having access to Nimbus core source
- `nimbus ask "which repos have critical Snyk vulnerabilities with open PRs touching the affected packages?"` returns results from the local index without any live API call
- `nimbus metrics dora --service payment-service --since 30d` returns all four DORA metrics computed from indexed GitHub and PagerDuty data
- An ArgoCD application sync failure is indexed and correlatable with the triggering Git commit within one sync cycle
- `nimbus ask "which dbt models feed the failing Tableau dashboard?"` returns a lineage chain once Phase 6 Tableau lands; intermediate Phase 5 variant works end-to-end against Metabase / Superset dashboards linked to dbt models
- No raw row data or binary extract crosses the connector boundary for any warehouse or BI connector — verified by a contract test that asserts the absence of row-fetch tools on each connector's MCP surface

---

## Phase 6 — Team

**Goal:** Make Nimbus a collaborative layer for engineering teams — shared intelligence without surrendering local sovereignty.

### Dependencies

- Phase 4 encrypted LAN remote access (E2EE channel foundation for Nimbus-to-Nimbus)
- Phase 4 tamper-evident audit log (required for org-level compliance controls)
- Phase 4 Plugin API v1 (team connectors can ship as extensions)
- Phase 3.5 configuration profiles (team policy interacts with per-user profile config)

### Shared Infrastructure

- [ ] **Nimbus-to-Nimbus federation** — two Gateways share a scoped index namespace over E2E-encrypted channel (NaCl box); no relay server; each side controls which `item` types and services it exposes; revocable per peer
- [ ] **Cross-user conflict detection** — use the federated index to detect "Work-in-Progress collisions" (e.g., Alice editing `auth.ts` while Bob is assigned to the related Jira ticket); notifies the user before starting changes
- [ ] **Team Vault** — shared credential store; one Gateway acts as trust anchor; role-based read/write access to named vault entries; credentials never leave the LAN
- [ ] **Shared index namespaces** — user publishes a named namespace (e.g. `project:zurich`) as a filtered slice of their index; teammates subscribe over the federation channel; changes propagate on next sync cycle
- [ ] **LAN discovery** — Gateways advertise each other via mDNS; `nimbus team discover` lists available peers; pairing requires explicit mutual approval

### Identity & Access

- [ ] **SSO/OIDC/SAML** — enterprise identity provider integration; tokens stored in the Vault; Gateway validates ID token on every session
- [ ] **SCIM user provisioning** — automated user lifecycle driven by IdP; deprovisioned users' shared namespaces revoked automatically
- [ ] **Role-based access control** — `owner`, `editor`, `viewer` roles per shared namespace; enforced at the federation protocol layer, not just the UI
- [ ] **Multi-user HITL** — workspace owner delegates HITL approval rights to a named team member for a specific workflow; delegate sees a pending approval queue; every delegation recorded in audit log

### Data Warehouses & BI (SSO-gated)

Depends on Team Vault (above) so service-account / SSO credentials can be shared across a workspace without each user re-authenticating.

- [ ] **Snowflake** (SSO / OAuth / Key-Pair) — databases, schemas, tables / views (column names + tags only), tasks, pipe status, recent query history metadata; `data_model` item type indexed with database, schema, table, column tags, row-count estimate, last-altered; `warehouse.task.run` / `warehouse.pipe.resume` behind HITL; strictly no row data
- [ ] **Tableau Server / Cloud** — dashboards, reports, views, workbooks, authors, folders, extract refresh status; `dashboard` item type; read-only except `bi.comment.post` behind HITL; links Tableau views to upstream Snowflake tables via data-source metadata
- [ ] **Looker** — dashboards, Looks, Explores, LookML models, content folders; `dashboard` + `data_model` item types; read-only; `bi.schedule.send` behind HITL; links Looker Views to the underlying dbt models in GitHub via LookML `sql_table_name`
- [ ] **PowerBI** — workspaces, reports, dashboards, datasets (schema only), dataflows; `dashboard` item type; read-only except `bi.dataset.refresh` behind HITL

### Shared Workflows & Policy

- [ ] **Team-owned workflow pipelines** — pipelines in a shared namespace; any team member can trigger; write steps require HITL from the triggering user; no credentials embedded in pipeline YAML
- [ ] **Team "Huddle" Briefing** — aggregate morning briefing summarizing team achievements across PRs, tickets, and incidents without manual status reporting
- [ ] **Org-level policy engine** — `nimbus.policy.toml` enforces: connector allowlists, `retentionDays` floor, HITL threshold overrides, audit log shipping destination; interacts with per-user profile config from Phase 3.5
- [ ] **Policy enforcement at the Gateway** — policy loaded on startup; connectors not in the allowlist disabled before the mesh starts; violations logged to audit trail

### ChatOps

- [ ] **Bidirectional Slack/Teams bot** — team members interact with the shared Nimbus Gateway via `@nimbus` in a channel; read queries (`@nimbus who's on call for payment-service?`) answered from the shared index; write commands (`@nimbus rollback payment-service to v1.4`) route to the HITL queue of the appropriate team member before executing — the bot never bypasses the consent gate
- [ ] **HITL via Slack/Teams** — pending HITL approvals surfaced as interactive Slack/Teams messages; approver clicks Approve/Reject in-channel; decision recorded in audit log with approver identity; deep link to the full approval context
- [ ] **Notification routing** — watcher alerts and incident summaries optionally routed to a designated Slack/Teams channel; configurable per watcher rule and per team namespace
- [ ] **Bot security model** — bot token stored in Team Vault; bot can only act on behalf of the requesting user's authorised scope; channel-to-namespace mapping enforced in policy; no bot command can exceed the requesting user's permission level

### Admin & Observability

- [ ] **Admin console** — web UI served locally by the Gateway: user list, namespace health, connector status across the team, audit log viewer, policy editor
- [ ] **Team audit log** — federation events appended to each member's local audit log; owner can request a merged view
- [ ] **GDPR/compliance at org level** — `nimbus team purge --user <id>` removes a user's contributions from all shared namespaces; writes a signed deletion record

### Acceptance Criteria

- Two Nimbus instances on the same LAN establish a federated namespace in under 60 seconds with no external server involved
- A team member's HITL approval on a shared workflow is recorded in both the approver's and the workspace owner's local audit log
- Revoking a peer's federation access removes their read access within one sync cycle; no data retained on their machine after revocation
- An org policy disallowing the Slack connector prevents `nimbus connector auth slack` from succeeding on any member's machine while the policy is active
- A `@nimbus rollback` command issued in Slack routes to the on-call engineer's HITL queue and does not execute until they approve; the approval is recorded in the audit log with their identity
- Cross-warehouse lineage query `nimbus ask "why is the Q1 revenue Tableau dashboard stale?"` resolves the chain Tableau view → Looker view → dbt model → Snowflake table → Airflow DAG → failing PR from the local index in under 500 ms; no live warehouse or BI API call is made during the query

---

## Phase 7 — The Autonomous Agent

**Goal:** Transform Nimbus from a reactive tool into a proactive collaborator that watches, learns, and acts — always within the bounds of what you have authorised.

**Scope note:** This phase contains items with very different risk and complexity profiles. Standing approvals, scheduled workflows, morning briefings, deadline tracking, and the incident correlation engine are low-risk, buildable directly on Phase 3 infrastructure, and form the **core** of this phase. LoRA fine-tuning and the Infrastructure-as-Agent SRE loop are research-adjacent and are marked **stretch** — they do not gate phase completion if the core items pass their acceptance criteria.

### Dependencies

- Phase 3 Watcher system and RAG conversational memory
- Phase 3 Proactive anomaly detection (watcher baseline learning)
- Phase 4 Local LLM support and multi-agent orchestration
- Phase 4 Tamper-evident audit log (standing approvals are recorded and auditable)

### Core — Standing Approvals & Scheduling

- [ ] **Standing approval rules** — users pre-authorise specific recurring write patterns; stored in SQLite with explicit scope, expiry, and item count ceiling; agent checks standing rules before prompting for HITL
- [ ] **Approval learning** — after N consecutive identical approvals (configurable; default: 5), Nimbus suggests a standing rule; user must explicitly confirm; suggestion is logged
- [ ] **Confidence Score for standing approvals** — standing rules require a confidence score based on contextual similarity (same service, time of day, user location) to prevent over-permissioning
- [ ] **Standing rule management** — `nimbus approve list`, `pause`, `revoke`; each rule shows match scope, expiry, action count, last-fired timestamp
- [ ] **Audit trail for standing approvals** — every action taken under a standing rule logged with rule ID, matched scope, and timestamp; `nimbus audit standing` shows per-rule history
- [ ] **Scheduled workflows** — watchers trigger workflow pipelines on `schedule` condition (cron syntax); read-only workflows run unattended; write workflows with standing-approved steps also run unattended; HITL-required steps without a standing rule block and notify
- [ ] **Morning briefing** — built-in scheduled workflow: cross-service summary (open PRs, active incidents, overdue tickets, unread threads) delivered via notification system at a configured time
- [ ] **Privacy-preserving agent-to-agent scheduling** — one user's agent negotiates meeting times with another's over the Phase 6 federated channel; returns mutually available slots without leaking full calendar details
- [ ] **Deadline tracking** — monitors items with due dates across Linear, Jira, GitHub, and Calendar; fires notification 24h before deadline when no recent activity is detected on the item
- [ ] **`nimbus schedule list`** — shows all active scheduled workflows with next fire time and last run status

### Core — Incident Correlation Engine

- [ ] **Automatic incident assembly** — when a monitoring alert fires, agent automatically queries the local index for: last deployment before the alert, associated PR, triggering commit, CI run result, Slack/Teams threads mentioning the affected service; assembles a structured incident summary without any user query
- [ ] **Incident timeline** — structured Markdown timeline (alert → deploy → commit → PR → CI); exported via `nimbus incident show <alert-id>` or surfaced in the Tauri dashboard
- [ ] **Proactive technical debt detection** — agent flags code symbols that haven't been touched in months but are frequently referenced in failing pipelines or incident logs
- [ ] **Suggested remediation** — agent proposes a remediation action (rollback, restart, scale-up) based on indexed history of similar incidents; always HITL-gated before execution
- [ ] **Post-mortem generation** — after incident resolution, agent drafts a structured post-mortem (timeline, root cause, contributing factors, action items) from the assembled incident record and HITL decision log; user reviews and edits before HITL-gated push to Notion or Confluence; template is configurable
- [ ] **On-call schedule awareness** — indexes PagerDuty/OpsGenie on-call schedules; answers `nimbus ask "who's on call for payment-service right now?"` from the local index; feeds on-call context into the morning briefing and incident assembly so the agent can route notifications to the right engineer without an additional API call

### Core — Agent Memory & Personalization

- [ ] **Long-term episodic memory** — agent stores summarised observations from past sessions in a dedicated SQLite table; recalled at query time via semantic similarity
- [ ] **Personalization layer** — agent adapts communication style and tool selection priority based on observed user preferences; preferences are explicit (configurable), not inferred silently
- [ ] **Automated PR pre-review** — agent performs "lint-plus" review based on team's historical review patterns (e.g., "In this repo, we usually ask for Y when X is changed")
- [ ] **Decision pattern recognition** — agent identifies repeated HITL decision patterns across history; surfaces them as standing rule candidates

### Stretch — Local Model Fine-Tuning

*These items do not gate phase completion. They are explicitly aspirational.*

- [ ] **LoRA adapter training** — train lightweight adapters on the user's own writing style (emails, Slack messages, Notion pages, PR descriptions) using local NPU/GPU; model: Llama 3 or Mistral base; no data leaves the machine
- [ ] **Domain-specific recall** — fine-tuned adapter improves agent's ability to match user naming conventions and project context when drafting or classifying
- [ ] **`nimbus model train --adapter writing-style`** — background fine-tuning job; `nimbus model status` shows progress; adapters versioned and rollback-safe

### Stretch — Infrastructure-as-Agent (SRE Loop)

*These items do not gate phase completion. They are explicitly aspirational.*

- [ ] **Autonomous drift detection** — agent continuously compares IaC declared state against indexed live cloud state; flags drift in the dashboard without waiting for a user query
- [ ] **Remediation proposals** — agent drafts `terraform plan` or equivalent for detected drift; user reviews diff in HITL dialog; no cloud mutation without approval
- [ ] **Cost anomaly detection** — monitors Cost Explorer / Azure Cost Management / GCP Billing daily spend; alerts when 24h spend exceeds 7-day rolling average by a configurable threshold; once Phase 6 BI connectors land, the same detection window covers Snowflake credit consumption and Databricks DBU usage
- [ ] **Runbook automation** — common SRE runbooks registered as named HITL-gated actions; agent proposes the right runbook when an incident matches a known pattern

### Acceptance Criteria (core items only)

- A standing approval rule for "archive read Gmail threads older than 60 days" executes its next scheduled run without any user prompt; every archived thread appears in the audit log under the rule ID
- When a PagerDuty P1 fires, the incident summary (deploy, PR, commit, CI result, Slack thread) is assembled and available via `nimbus incident show` within 30 seconds of the alert being indexed — no user query required
- A morning briefing workflow runs fully unattended; any write step without a standing rule sends a notification and blocks rather than executing silently
- `nimbus ask "who's on call for payment-service right now?"` returns the correct engineer from the indexed PagerDuty schedule without a live API call
- A post-mortem draft for a resolved incident is generated from the incident record and surfaced for review; the HITL-gated push to Notion succeeds only after the user explicitly approves

---

## Phase 8 — Sovereign Mesh

**Goal:** Extend Nimbus beyond the single machine — across the user's own devices, between trusted people, and into the physical world — without any relay server or trusted third party.

**Note on the Digital Executor:** The dead man's switch and Shamir's Secret Sharing items address a real use case: secure handover of credentials and cryptographic keys to trusted people upon death or extended incapacitation. They are included because they are a natural extension of the local sovereignty model — if Nimbus holds the keys to your digital life, it should have a principled way to hand them to the people you designate. They are not a novelty feature; they are the logical conclusion of the "no cloud, no intermediary" architecture applied to the hardest edge case.

### Dependencies

- Phase 4 tamper-evident audit log and data export/import
- Phase 6 federation protocol (Nimbus-to-Nimbus channel is the mesh primitive)
- Phase 7 standing approvals (mobile HITL approvals are a standing-approval variant)

### Cross-Device Sync

- [ ] **P2P index sync** — encrypted index sync between a user's own machines; BLAKE3-keyed protocol; vector-clock conflict resolution; no third party
- [ ] **Selective sync** — user controls which `item` types and services sync to which device; configuration stored in the Vault per profile
- [ ] **Sync conflict resolution UI** — diverged devices surface conflict in the dashboard with diff view; user resolves manually or accepts one side

### Mobile Companion

- [ ] **iOS app** — connects to home Gateway over E2EE LAN or WireGuard tunnel; no cloud relay; natural language queries, HITL approval queue, watcher notifications, read-only connector status
- [ ] **Android app** — same feature set as iOS
- [ ] **Push notifications** — via local push (LAN) or WireGuard; no third-party push service required; opt-in to cloud push (APNs/FCM) for out-of-LAN reachability
- [ ] **Biometric HITL** — use the Mobile Companion as the primary HITL gate; approvals cryptographically signed with a device key and authorized via FaceID/TouchID for a superior security/UX balance
- [ ] **Mobile HITL signature** — approvals cryptographically signed with a device key stored in the phone's secure enclave

### Physical Sovereignty

- [ ] **Hardware vault integration** — YubiKey and Ledger as a second factor; FIDO2/WebAuthn locally; unlock requires physical device presence
- [ ] **Hardware audit-log signing** — support for Nitrokey or OpenPGP cards to cryptographically sign the BLAKE3 audit chain, making it physically tamper-proof
- [ ] **Air-gapped secret management** — credentials for sensitive connectors stored exclusively on a hardware key; Gateway requests them via USB/NFC at sync time; never written to disk even temporarily
- [ ] **Decentralized Identifiers (DIDs)** — self-sovereign DIDs for Nimbus-to-Nimbus authentication; DID document stored locally; no central registry required

### Digital Executor

- [ ] **Dead man's switch** — configures cryptographic keys and documents to be handed over to named recipients if Gateway is inactive for a configurable period
- [ ] **Threshold secret sharing** — executor payload split using Shamir's Secret Sharing across N trusted recipients; any M-of-N can reconstruct; no single recipient can access it alone
- [ ] **Executor audit trail** — every check-in, near-trigger, and handover event logged in the tamper-evident audit chain; recipients receive a verifiable log alongside the payload

### Acceptance Criteria

- Index syncs between two machines on the same LAN in under 60 seconds for a 50,000-item dataset; no data passes through any external server
- A HITL approval made on the mobile app executes within 5 seconds on the home Gateway; action and approval signature appear in the local audit log
- Removing a YubiKey while the Gateway is running causes credential access to fail gracefully; re-inserting resumes normal operation without re-auth
- A Digital Executor payload reconstructed by M-of-N recipients is byte-identical to the original and its audit chain passes `nimbus audit verify`

---

## Phase 9 — Enterprise

**Goal:** Make Nimbus deployable and auditable at institutional scale. Tied to the commercial license tier — AGPL users retain all individual and team features; enterprise deployment, compliance tooling, and SLA support are commercial.

**Dependency note:** The Phase 7 dependency is narrowed to **standing approvals only**. Docker, Helm, SAML SSO, audit log shipping, and SCIM provisioning do not require the autonomous agent or LoRA fine-tuning to be complete. The SRE loop stretch items are independent of enterprise deployment.

### Dependencies

- Phase 6 Team (Enterprise builds on the team collaboration foundation)
- Phase 4 tamper-evident audit log (required for compliance export)
- Phase 7 standing approvals (required for unattended enterprise workflows)
- Phase 3.5 telemetry infrastructure (audit log shipping uses the same batched-transmission pipeline)

### Deployment & Operations

- [ ] **Docker image** — official `ghcr.io/nimbus/gateway` image; multi-arch (amd64/arm64); configurable via env vars and mounted `nimbus.toml`
- [ ] **Helm chart** — `nimbus/gateway` Helm chart for Kubernetes; namespace isolation, persistent volume for SQLite, external Vault backend (HashiCorp Vault), RBAC, NetworkPolicy
- [ ] **Air-gapped bundle** — single tarball with all binaries, local LLM model weights, and dependency assets; no outbound internet access required
- [ ] **High availability** — active/passive Gateway clustering; leader election via SQLite WAL + advisory lock; failover in under 30 seconds
- [ ] **Managed update channel** — enterprise updates on a dedicated channel with 2-week delay vs. main; allows internal QA before rollout
- [ ] **Remote vector store adapters** — pluggable `VectorStore` interface with Qdrant, Weaviate, and Pinecone backends; `sqlite-vec` remains the default (local-first principle); remote backend enabled only via explicit `[index.vector_store]` config block — never on by default; suitable for enterprise deployments with centralised vector infrastructure or index sizes exceeding local storage thresholds; resolves the Phase 3 deferral (remote stores were incompatible with local-first for individual users; self-hosted enterprise deployments clear the privacy boundary)

### Centralized Policy & Compliance

- [ ] **Policy-as-code** — `nimbus.policy.toml` extended for enterprise: per-user role assignments, connector allowlists, data classification labels, mandatory audit log shipping, HITL threshold overrides per user group
- [ ] **Data Loss Prevention (DLP) Gate** — pre-dispatch scanner that flags PII, secrets, or "Internal Only" content before it is sent to remote LLMs or exported
- [ ] **Audit log shipping** — `audit_log` rows streamed (append-only, tamper-evident) to SIEM targets (Splunk, Elastic, Datadog Logs), S3/GCS/Azure Blob, or a mounted file path; fire-and-forget with local retention as fallback
- [ ] **Compliance posture tooling** — `nimbus compliance check` reports: credential storage status, audit log integrity, plaintext credential scan result, connector scope minimization status; structured JSON output suitable for auditors
- [ ] **Legal Hold & Discovery** — compliance mode to "freeze" index state or export an immutable subset of the audit log for legal discovery
- [ ] **Data residency controls** — per-connector restriction to a named geographic boundary; Gateway enforces at ingest; non-compliant items flagged and excluded from the index
- [ ] **Formal security audit** — third-party penetration test of Gateway, IPC surface, Vault, and extension sandbox; published report; responsible disclosure programme and bug bounty

### Identity & Governance

- [ ] **Enterprise SSO** — SAML 2.0 and OIDC; tokens in enterprise Vault, not browser cookies; session binding to machine identity
- [ ] **SCIM 2.0 provisioning** — automated user lifecycle driven by IdP; deprovisioned users' Vault entries and shared namespaces revoked within one sync cycle
- [ ] **Knowledge Isolation (Project Boundaries)** — strict index partitioning to ensure context from one client/project never bleeds into another
- [ ] **Privileged access management** — named admin users can view (not export) any team member's connector health and audit log; cannot view index content or credentials

### Admin Console (Enterprise)

- [ ] **Org-wide dashboard** — Gateway health per member, index item counts by service, watcher fire rate, HITL queue depth, audit log freshness
- [ ] **Policy editor** — GUI for `nimbus.policy.toml` with validation and diff preview before applying
- [ ] **Credential rotation assistant** — identifies connectors with credentials older than a configurable threshold; guides admin through coordinated re-auth with minimal downtime

### SLA & Support

- [ ] **Priority support tier** — dedicated CSM, 4h response SLA for P1 issues, private Slack channel
- [ ] **Deployment assistance** — official runbooks for Docker/Kubernetes/air-gapped deployments; reference architecture for common enterprise stacks
- [ ] **DPA and legal templates** — Data Processing Agreement, sub-processor list, GDPR Article 28 documentation for enterprise procurement

### Acceptance Criteria

- The Helm chart deploys a functional Gateway cluster on Kubernetes with persistent storage and NetworkPolicy in under 15 minutes from a clean cluster
- `nimbus compliance check` produces a machine-readable JSON report passing a reference auditor schema without manual intervention
- Audit log shipping to a Splunk HEC endpoint is verified end-to-end in CI against a mock HEC target; no audit row is lost in a Gateway restart scenario
- Deprovisioning a user via SCIM removes their shared namespace access within one sync cycle and writes a signed record to the org audit log

---

## How to Update This Document

- When a phase becomes active, update its status in the overview table and add a progress note (e.g. "~14 of 21 items complete").
- Check off individual items (`[x]`) as they land on `main`; update the progress count in the phase status note.
- When a phase completes, add a **Delivered** section (see Phases 1 and 2 for the format) and update the status table.
- Do not add new items to an active phase without a corresponding issue and team discussion.
- Planned phase items can be reprioritised between phases — open a discussion, then update this file and `CLAUDE.md` and `GEMINI.md` (AI assistant context files at the repo root that carry architecture and convention summaries for AI-assisted development) to match.
- New phases can be added after the last planned phase; do not insert phases between active/complete phases.
- Update the "Last updated" note at the top whenever significant waves of work land on `main`.