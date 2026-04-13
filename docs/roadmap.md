# Nimbus Roadmap

This document is the authoritative roadmap for Nimbus. [`README.md`](./README.md) carries a summary; this file contains acceptance criteria, inter-phase dependencies, and the reasoning behind sequencing decisions.

Phases are thematic, not calendar-bound. A phase begins when its dependencies are met and ends when its acceptance criteria pass — not at a quarter boundary. Phases may overlap when deliverables are independent.

> **Last updated:** reflects `main` as of Phase 3 (active). Update the Phase 3 progress note as waves land on `main`.

---

## Guiding Principles

Every roadmap decision is evaluated against the project's non-negotiables:

1. **Local-first** — machine is the source of truth; cloud is a connector
2. **HITL is structural** — consent gate is in the executor, not the prompt; cannot be bypassed or reasoned around
3. **No plaintext credentials** — Vault only; never in logs, IPC, or config
4. **MCP as connector standard** — the Engine never calls cloud APIs directly
5. **Platform equality** — Windows, macOS, and Linux are equally supported in every phase
6. **No feature creep across phases** — do not implement Phase N+1 features while Phase N is active

---

## Status Overview

| Phase | Theme | Status |
|---|---|---|
| Phase 1 | Foundation | ✅ Complete |
| Phase 2 | The Bridge | ✅ Complete |
| Phase 3 | Intelligence | 🔵 Active |
| Phase 3.5 | Observability & Developer Experience | Planned |
| Phase 4 | Presence | Planned |
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
| SQLite encryption at rest (SQLCipher) | Post-Phase 4 — OS filesystem encryption (BitLocker/FileVault/LUKS) covers the threat model; revisit if a formal security audit identifies a gap |
| Per-connector OAuth vault keys vs shared family key (`google.oauth`, `microsoft.oauth`) | Phase 3/4 consideration — shared key kept for simplicity; revisit if scope-collision UX proves painful |

---

## Phase 3 — Intelligence

**Goal:** Make Nimbus semantically aware and proactively useful. Extend into CI/CD, cloud infrastructure, and agentic automation.

**Status:** Active — Phase 2 complete; Wave 1–3b deliverables (semantic layer, extensions core, CI/CD + cloud + observability MCPs, workflows, watchers, partial filesystem v2) are on `main`. Remaining work: IaC drift indexing, full proactive anomaly loop, deeper AWS/Azure/GCP surface area, full filesystem v2 vision, DevOps and Research agents. **Progress: ~14 of 21 items complete** — update this note as items land on `main`.

### Dependencies

- Phase 2 unified metadata index (embedding pipeline needs populated items)
- Extension SDK scaffold stable before Registry v1 ships
- IaC write operations depend on IaC read/index from Phase 3 foundation items

### Semantic Layer

- [x] **Embedding pipeline** — chunk items at sync time → local embed via `@xenova/transformers` (no API key); store vectors in `sqlite-vec`; model: `all-MiniLM-L6-v2` (default) / OpenAI opt-in
- [x] **Hybrid search** — BM25 full-text (FTS5) + vector cosine similarity; RRF fusion reranking; exposed as `nimbus search --semantic`
- [x] **RAG conversational memory** — session context stored as embedded chunks; recalled at query time; scoped per-project

### Extension Ecosystem

- [x] **Extension Registry v1** (core) — `@nimbus-dev/sdk` public API; manifest schema v1 (`nimbus.extension.json`); `nimbus scaffold extension`; install/list/enable/disable/remove; manifest hash verification on startup
- [ ] **Extension sandbox hardening** — full syscall/network isolation beyond scoped env injection (risk register)
- [ ] **Extension Marketplace** — browse/discover/update UX (Phase 4 desktop)

### CI/CD & Infrastructure Connectors

- [x] **Jenkins MCP connector** — jobs, builds, stages, artefacts, failure logs
- [x] **GitHub Actions MCP connector** — workflow runs, job steps, artefact metadata
- [x] **CircleCI MCP connector** — pipelines, workflows, jobs
- [x] **GitLab CI MCP connector** — pipelines, jobs, artefacts (extends GitLab connector)
- [x] **AWS MCP connector** — AWS CLI–backed tools; sync indexes Lambda (paginated); ECS/CloudWatch/S3/Cost Explorer breadth expandable behind same `aws` service id
- [x] **Azure MCP connector** — App Service + AKS pool scale via `az` CLI; sync indexes current subscription snapshot
- [x] **GCP MCP connector** — Cloud Run + GKE workload restart via `gcloud`/kubectl; sync requires `gcp.project_id` in vault
- [ ] **IaC awareness (full)** — index Terraform state / Pulumi stack metadata into `iac_resource`; drift compare vs indexed live cloud (depends on fresh cloud sync)
- [x] **IaC write operations** (MCP) — Terraform plan/apply/destroy, CloudFormation deploy, Pulumi preview/up; HITL on destructive applies; audit before execution
- [x] **Kubernetes connector** — workloads via `kubectl`; kubeconfig path in vault; read tools + HITL mutations (`rollout restart`, `pod delete`, `deployment scale`)
- [x] **Datadog MCP connector** — monitors/incidents API; sync indexes monitors
- [x] **Grafana MCP connector** — HTTP API read tools; sync indexes dashboards (search API)
- [x] **Sentry MCP connector** — project/issue-oriented read tools; sync indexes projects
- [x] **PagerDuty MCP connector** — incidents, alerts, escalation policies, on-call schedules; acknowledge/resolve behind HITL
- [x] **New Relic MCP connector** — REST v2 applications + alert violations; sync indexes APM applications

### Workflow Automation

- [x] **Workflow pipelines** — named, saved multi-step workflows; YAML format shared with script files; HITL per write step; `nimbus workflow` CLI
- [x] **Watcher system** — SQLite-backed definitions; post-sync evaluation; `nimbus watch` CLI
  - Condition types: `email_match`, `file_changed`, `file_not_changed`, `deploy_failed`, `alert_fired`, `pr_merged`, `schedule`
  - Actions: `notify`, `run_workflow`, `ask_agent`
- [ ] **Proactive anomaly detection (full)** — baseline learning wired through watcher post-sync; stub exists (`watcher/anomaly-detector.ts`)

### Knowledge Graph & Filesystem Intelligence

- [x] **Local relationship graph** — entity/relation tables; populated on sync; graph tools in Gateway
- [ ] **Filesystem connector v2** (complete vision):
  - [x] Partial: git commit + `package.json` dependency + regex `code_symbol` indexing for configured `[[filesystem.roots]]` (`filesystem-v2-sync.ts`)
  - [ ] Full: blame/branch UX, deep semantic code index, PR cross-links, multi-manifest parsers (`go.mod`, `Cargo.toml`, …), vulnerability flagging

### Interaction Layer

- [x] **Session CLI** — `nimbus` with no arguments launches the interactive REPL when stdin/stdout are TTYs; session memory via `nimbus session` / `--session`; Gateway holds context while running
- [x] **Script files** — `nimbus run <path>` executes a YAML script as a single session; mandatory preview phase; no-TTY safety; convergence with workflow pipelines

### Agent Specialization

- [ ] **DevOps agent** — domain-tuned system prompt; pre-registered tool set scoped to CI/CD, infrastructure, and incident connectors; dedicated memory scope (deployment history, alert patterns)
- [ ] **Research agent** — optimized for document synthesis and cross-service knowledge retrieval; pre-registered tool set scoped to Drive, Notion, Confluence, email; long-context RAG recall

### Acceptance Criteria

- `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, GitHub PR, Jenkins build, CloudWatch error spike, and Slack incident thread — sourced entirely from the local index — in a single response
- A community developer can publish a working Nimbus extension in under one working day using `nimbus scaffold extension` and `MockGateway` from the SDK
- Watcher fires within one sync cycle of its condition becoming true; missed conditions during Gateway downtime are evaluated on next restart
- `terraform plan` → HITL → `apply` flow is tested end-to-end in CI against a mock Terraform binary

---

## Phase 3.5 — Observability & Developer Experience

**Goal:** Make Nimbus debuggable, composable, and trustworthy before the public `v0.1.0` release. Connectors, workflows, and the index are only as useful as your ability to see what they're doing, query them programmatically, and recover when things go wrong.

**Sequencing rationale:** Phase 3 delivers a large surface area of connectors and agentic capability. Phase 3.5 ensures that surface area is observable, configurable, and robust before it ships publicly. Without this phase, `v0.1.0` launches with no onboarding story, no programmatic query interface, no connector degradation visibility, and no database recovery path. **Phase 3.5 is a release prerequisite — Phase 4 does not begin until all acceptance criteria here pass.**

### Dependencies

- Phase 3 connector mesh and watcher system (health model builds on them)
- Phase 3 Extension Registry v1 (extension testing infrastructure builds on the SDK)

### Nimbus Self-Observability

- [ ] **Index metrics** — `nimbus status --verbose` reports: index item count per service, index size on disk, embedding coverage %, last successful sync per connector, p50/p95 query latency over the last 24h
- [ ] **Prometheus-compatible metrics endpoint** — read-only local HTTP endpoint (`localhost` only, configurable port, off by default); exposes the same metrics as `nimbus status --verbose` in Prometheus text format; enables local Grafana dashboards, shell scripts, and custom tooling without IPC client setup
- [ ] **Slow query log** — queries that hit the network or exceed a configurable latency threshold are logged to a dedicated table; surfaced via `nimbus diag slow-queries`
- [ ] **`nimbus diag`** — diagnostic snapshot command: running connectors, connector health states, index stats, pending HITL queue depth, active watchers, last 10 audit log entries; outputs human-readable and `--json` formats

### Connector Health Degradation Model

Today the roadmap describes the happy path for every connector. This section defines how Nimbus behaves and communicates when connectors degrade — including what the agent tells the user when results may be incomplete.

- [ ] **Explicit connector health states** — each connector tracks one of: `healthy`, `degraded`, `error`, `rate_limited`, `unauthenticated`, `paused`; state persisted in `sync_state` and surfaced in `nimbus connector list` and `nimbus status`
- [ ] **Rate-limit awareness** — 429 responses transition the connector to `rate_limited` with a calculated retry-after timestamp; the scheduler respects the window and does not retry early; `nimbus connector list` shows time until retry
- [ ] **Silent token expiry detection** — 401/403 responses transition the connector to `unauthenticated` rather than logging a generic error; user is notified via the notification system with a direct `nimbus connector auth <name>` prompt
- [ ] **Degraded-state query behaviour** — when a connector is `degraded` or `error`, agent responses that draw on its data include an explicit caveat: *"GitHub connector is currently degraded — results may be incomplete (last synced: 3h ago)"*
- [ ] **Automatic retry with exponential backoff** — transient errors (5xx, network timeout) trigger exponential backoff with jitter; max backoff configurable per connector; backoff state visible in `nimbus connector status <name>`
- [ ] **Health history** — last 7 days of connector health transitions stored in SQLite; `nimbus connector history <name>` shows the timeline; useful for diagnosing flaky connectors

### Data Layer API

- [ ] **`nimbus query` CLI** — structured query interface over the local index; filter flags: `--service`, `--type`, `--since`, `--until`, `--limit`; `--sql` flag accepts read-only SQLite SELECT statements against the public index schema (non-SELECT statements rejected); `--json` by default; `--pretty` for human-readable table output
  - Example: `nimbus query --service github --type pr --since 7d --json | jq '.[] | select(.ci_status == "failing")'`
- [ ] **Read-only local HTTP API** — localhost-only HTTP server (off by default; `nimbus serve --port 7474`); REST endpoints: `GET /v1/items`, `GET /v1/items/:id`, `GET /v1/people`, `GET /v1/connectors`, `GET /v1/audit`; no auth required (localhost-only); enables Raycast extensions, Alfred workflows, custom dashboards, and CI pipeline integrations without IPC setup
- [ ] **Official TypeScript client library (`@nimbus-dev/client`)** — MIT-licensed npm package; thin typed wrapper over the JSON-RPC IPC protocol; covers `agent.invoke`, `query.*`, `connector.*`, `audit.*`, `people.*`; includes `MockClient` for testing scripts without a running Gateway; VS Code extension (Phase 4) depends on this package

### Configuration Management

- [ ] **`nimbus config` CLI** — first-class configuration management without hand-editing TOML:
  - `nimbus config get <key>` / `set <key> <value>` / `list` / `validate` / `edit`
  - `list` shows source of each value: default / file / env override
  - `validate` parses and validates `nimbus.toml` against the schema and reports all errors before applying
- [ ] **Configuration schema versioning** — `nimbus.toml` carries a `schema_version` field; Gateway validates on startup, rejects unknown fields with a clear error, and prints migration hints when an older schema is detected
- [ ] **Configuration profiles** — named profiles (e.g. `work`, `personal`) selectable via `--profile` flag or `NIMBUS_PROFILE` env var; each profile has its own connector set, sync intervals, and model selection; profiles share the Vault but credentials are profile-scoped by key prefix (e.g. `work.google.oauth.*`)
  - `nimbus profile create <name>`, `list`, `switch <name>`
  - Active profile shown in `nimbus status`
- [ ] **Environment variable overrides** — any `nimbus.toml` key overridable via `NIMBUS_<SECTION>_<KEY>`; `nimbus config list` shows which values are env-overridden; useful for CI and container deployments

### Data Integrity & Disaster Recovery

- [ ] **`nimbus db verify`** — scans the SQLite index for: corrupted rows, broken FTS5 index consistency, vec table / metadata table rowid mismatches, orphaned sync tokens, schema version mismatch; exits non-zero on any finding; suitable for use in health checks and CI
- [ ] **`nimbus db repair`** — attempts recovery from a corrupt index: rebuilds FTS5 index, removes rows with unrecoverable corruption, re-queues affected connectors for full resync; writes a repair report to the audit log; requires confirmation before modifying data
- [ ] **Automatic pre-migration backup** — before any schema migration runs, the Gateway writes a compressed SQLite snapshot to `<dataDir>/backups/pre-migration-<version>-<timestamp>.db.gz`; kept for 30 days; `nimbus db backups list` shows available snapshots
- [ ] **Migration rollback** — if a migration fails mid-run, the Gateway automatically restores from the pre-migration backup and exits with a clear error; the failed migration is marked `failed` in `_schema_migrations` so it can be retried after a fix; no partially-migrated schema persists
- [ ] **Index snapshot scheduling** — `nimbus db snapshot` for manual snapshots; `[db.snapshots]` config enables automatic snapshots on a schedule (default: daily, keep last 7); stored separately from pre-migration backups; `nimbus db restore <snapshot>` restores with confirmation prompt
- [ ] **Disk space monitoring** — Gateway warns via notification and `nimbus status` when index + snapshot storage exceeds a configurable threshold (default: 80% of available disk); `nimbus db prune` removes snapshots and index rows beyond `retentionDays`

### Opt-In Telemetry

- [ ] **Telemetry infrastructure** — disabled by default; enabled via `nimbus config set telemetry.enabled true` or an explicit opt-in prompt during first-run onboarding; no data collected or transmitted until explicitly enabled
- [ ] **Collected data — aggregate counters only, no content, no credentials:**
  - Connector error rates and health state transition counts per connector type (not per account)
  - Query latency histograms (p50/p95/p99) for index queries and agent invocations
  - Sync duration histograms per connector type
  - Gateway cold-start duration
  - Extension install/uninstall counts per extension id
  - Nimbus version and platform (for understanding adoption distribution)
- [ ] **`nimbus telemetry show`** — prints the exact payload that would be sent on the next flush; inspectable before and after enabling; no surprises
- [ ] **`nimbus telemetry disable`** — immediately stops collection and transmission; deletes locally buffered data
- [ ] **Transmission** — batched, compressed, HTTPS only, at most once per hour; telemetry server source is open-source; endpoint published in docs

### Documentation Site

The docs site is a Phase 3.5 release prerequisite — a new user installing `v0.1.0` must be able to find getting-started guidance, connector references, and SDK docs without reading raw Markdown in the repository.

- [ ] **Getting started guide** — install → authenticate one connector → run first query; covers all three platforms; completable in under 10 minutes
- [ ] **Connector reference** — one page per connector: auth method, required credentials, indexed item types, available tools, HITL-required tools, known limitations and rate limits
- [ ] **CLI reference** — auto-generated from command definitions; covers every `nimbus` subcommand with flags, examples, and exit codes
- [ ] **SDK reference** — `@nimbus-dev/sdk` API docs auto-generated from TypeScript types + JSDoc; `MockGateway` usage guide; end-to-end "build your first extension" tutorial
- [ ] **`@nimbus-dev/client` reference** — API docs for the TypeScript client library; usage examples for common patterns (query the index, invoke the agent, handle HITL from a script)
- [ ] **Architecture overview** — condensed version of `architecture.md` for contributors who want context without reading the full doc
- [ ] **FAQ** — covers: "why is my connector showing degraded?", "how do I reset a connector's auth?", "what data does Nimbus store locally?", "how do I uninstall completely?", "what is HITL?"
- [ ] **Search** — full-text search across all docs pages; static index generated at build time; no external service
- [ ] **Versioning** — docs versioned alongside releases; `v0.1.0` docs frozen at release; `main` docs show unreleased changes with a banner

### Extension Testing Infrastructure

- [ ] **`nimbus test` command** — runs an extension's test suite inside a sandboxed environment mirroring the real Gateway: same env injection, same manifest validation, same HITL enforcement; `bun test` compatible; exits non-zero on failure
- [ ] **Connector contract tests** — `@nimbus-dev/sdk` ships a `runContractTests(server)` helper that verifies an extension's tool surface against the connector tool contract: `list`, `get`, `search` must be present and return typed `NimbusItem` arrays; write tools declared in `hitlRequired` must be present
- [ ] **Official CI template** — `.github/workflows/nimbus-extension-ci.yml` template published in docs and the SDK repo; covers `bun install`, `bun run build`, `nimbus test`, contract tests, `bun audit`; extension authors copy it to get automated testing without manual setup

### Onboarding

- [ ] **First-run wizard (CLI)** — `nimbus start` on a fresh install detects no configuration and launches an interactive setup: platform check, connector selection, OAuth flow, initial sync, first query suggestion
- [ ] **Empty state guidance** — `nimbus ask` with no connected connectors returns a helpful prompt listing connectors to authenticate and how, rather than a generic "no results" message
- [ ] **`nimbus doctor`** — checks the full environment: Bun version, keystore availability, IPC socket permissions, connected connectors and their health, index population status, disk space; prints a pass/warn/fail report; first thing to run when something seems wrong

### Acceptance Criteria

- `nimbus status --verbose` reports per-connector health state, index item counts, and p95 query latency on all three platforms
- A connector receiving a 429 enters `rate_limited` state; `nimbus connector list` shows the retry-after time; the scheduler does not attempt another sync until that window passes
- `nimbus query --service github --type pr --since 7d --json` returns a valid JSON array of PR items from the local index in under 100ms on a 50k-item dataset
- The local HTTP API (`nimbus serve`) returns a `GET /v1/items` response matching the same data as `nimbus query` for equivalent filters
- `nimbus db verify` detects a manually introduced FTS5 rowid mismatch and exits non-zero; `nimbus db repair` resolves it and re-queues the affected connector
- A failed migration restores from the pre-migration backup automatically; the Gateway exits with an actionable error message; no partially-migrated schema remains
- `nimbus telemetry show` displays the exact payload with no content or credential fields present, before and after enabling
- The docs site passes a link checker with zero broken internal links; the getting-started guide is completable in under 10 minutes on a clean machine on all three platforms
- A community extension scaffolded with `nimbus scaffold extension` passes `nimbus test` and the contract tests out of the box before any custom logic is added
- `nimbus doctor` detects a missing keystore session on Linux headless and prints a clear remediation step

---

## Phase 4 — Presence

**Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations needed for a public `v0.1.0` release.

### Dependencies

- **Phase 3.5 complete** — all Phase 3.5 acceptance criteria must pass before Phase 4 begins; the docs site, onboarding, and data integrity work are release prerequisites
- Phase 3 Extension Registry v1 (Marketplace panel depends on it)
- Phase 3 Watcher system (Watcher management UI depends on it)
- Phase 3 Workflow pipelines (pipeline editor depends on it)
- Phase 3.5 `@nimbus-dev/client` (VS Code extension depends on it)
- Phase 3.5 configuration profiles (Settings panel profile switcher depends on it)
- Code signing certificates provisioned before release build step

### Desktop Application (Tauri 2.0)

- [ ] **System tray** — quick-query popup (hotkey-activatable); connector health dot with degradation state colour; badge for pending HITL actions
- [ ] **Dashboard** — connector sync status with health state badges, index item counts, recent agent actions, audit log feed; degradation reason shown in connector tooltip
- [ ] **HITL consent dialogs** — structured action preview; diff view for file/code changes; approve/reject with optional edit before approve
- [ ] **Extension Marketplace panel** — browse, install, update, disable, remove extensions; verified publisher badge; community ratings; changelog per version; auto-update toggle
- [ ] **Watcher management UI** — create, pause, delete watchers; condition builder; history of fired events
- [ ] **Workflow pipeline editor** — visual step list; run history; re-run failed steps; parameter override before run
- [ ] **Settings** — model selection (cloud vs local), sync intervals per connector, profile switcher, Vault key listing (no values shown), audit log viewer + export, data export/import, telemetry toggle

### Local LLM & Multi-Agent

- [ ] **Local LLM support** — Ollama integration (model discovery, pull, load, unload via Gateway IPC); llama.cpp fallback (GGUF model files, no Ollama required); per-task model routing (fast local model for classification; remote for multi-step reasoning; configurable); fully air-gapped operation when a local model is loaded
- [ ] **Multi-agent orchestration** — coordinator agent decomposes complex tasks into independent sub-tasks; sub-agents run in parallel in isolated tool scopes; all sub-agent write operations remain HITL-gated; coordinator cannot approve on behalf of the user

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

- [ ] **Local STT** — Whisper.cpp bundled in the desktop app; model: `whisper-base.en` (default) / user-selectable; audio never leaves the machine
- [ ] **Voice queries** — push-to-talk in desktop app; result summary spoken via local TTS (`pyttsx3` on Linux, `say` on macOS, SAPI on Windows)
- [ ] **Wake word** (opt-in, disabled by default)

### Data Sovereignty

- [ ] **Full export** — `nimbus data export --output nimbus-backup.tar.gz`: SQLite snapshot, vault credential manifest (re-encrypted with user passphrase), watcher definitions, workflow pipelines, extension list, active profile configs
- [ ] **Full import** — `nimbus data import nimbus-backup.tar.gz`: decrypts manifest, re-seals credentials into target machine's native Vault, restores index, re-registers extensions, restores profiles
- [ ] **GDPR deletion** — `nimbus data delete --service <name>`: removes all index rows and Vault entries for a service; writes a signed deletion record to the audit log
- [ ] **Tamper-evident audit log** — each audit log row is BLAKE3-chained to the previous; log export includes the chain; `nimbus audit verify` checks integrity

### Release Infrastructure

- [ ] Signed + notarized release binaries: macOS (Gatekeeper notarized), Windows (Authenticode signed), Linux (GPG-signed `.deb` + AppImage)
- [ ] Auto-update via self-hosted `tauri-update-server`; update checked on Gateway startup; user approves before applying
- [ ] Plugin API v1 — third-party connector registration stable and documented; breaking changes require a major version bump
- [ ] Optional encrypted LAN remote access — E2E encrypted (NaCl box), no relay server; read-only by default; write requires separate HITL approval on the host machine

### Acceptance Criteria

- `v0.1.0` installers pass Gatekeeper (macOS) and SmartScreen (Windows) without user override required
- `nimbus ask "summarize everything that happened across my projects this week"` runs fully locally via Ollama — no API key, no network call — in under 30 seconds on a mid-range laptop
- Multi-agent orchestration: a task decomposed into 3 parallel sub-agents cannot bypass HITL on any write step — verified by automated test
- `nimbus data export` → wipe index and Vault → `nimbus data import` restores full functionality on a fresh machine with all connectors re-authenticated
- Five community extensions available in the Marketplace at `v0.1.0` launch
- VS Code extension installs from Open VSX and connects to a running Gateway without any manual configuration

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
- [ ] **Browser history connector** — local browser extension (Chrome/Firefox/Safari) pushes visited URLs + page titles to Gateway over local HTTP; no cloud relay; opt-in; history stored locally only
- [ ] **Web clipper** — browser extension saves a page into the Nimbus index with a tag; surfaced in `nimbus search` alongside Drive files and emails

#### Email via IMAP/SMTP

- [ ] **Generic IMAP connector** — any IMAP server (Fastmail, ProtonMail, self-hosted); credentials in Vault; `body_preview` indexing; `email.send` behind HITL via SMTP
- [ ] **Fastmail MCP connector** — JMAP native (faster and more efficient than IMAP)
- [ ] **ProtonMail MCP connector** — ProtonMail Bridge integration; local IMAP interface; read-only (E2EE precludes server-side access)

#### Finance & Expenses

- [ ] **Expensify** — expense reports, receipts, reimbursement status; read-only index; submit behind HITL
- [ ] **Ramp** — transactions, receipts, budgets, vendor spend; read-only index
- [ ] **Mercury** — business banking; balances, transactions, bills; read-only; wire/ACH behind HITL
- [ ] **Stripe** — invoices, payments, customers, disputes, subscription events; read-only; refund behind HITL

#### CRM & Sales

- [ ] **HubSpot** — contacts, companies, deals, activities, notes; OAuth; write behind HITL
- [ ] **Salesforce** — Lead, Contact, Account, Opportunity, Case; OAuth; write behind HITL
- [ ] **Pipedrive** — deals, persons, organisations, activities, notes; API key; write behind HITL

#### HR & Recruiting

- [ ] **Greenhouse** — jobs, candidates, applications, scorecards, offers; write (move stage, post feedback) behind HITL
- [ ] **Lever** — requisitions, candidates, feedback, interviews; write behind HITL
- [ ] **Workday** — time off, headcount, org chart, job postings; read-only where API access allows

#### Design & Creative

- [ ] **Figma** — files, frames, comments, version history, FigJam boards; OAuth; comment post behind HITL
- [ ] **Miro** — boards, cards, sticky notes, comments; OAuth; write behind HITL
- [ ] **Canva** — designs, folders, shared projects; OAuth; read-only index

### Nimbus as a CI/CD Data Layer

The local HTTP API and `@nimbus-dev/client` (Phase 3.5) unlock Nimbus as a data source for CI pipelines and external tooling. This section makes that story explicit with first-class integration points.

- [ ] **Pre-deploy index check** — official GitHub Actions action (`nimbus-dev/query-action`) that queries the local index via the HTTP API for: active P1 incidents on the target service, failing CI runs on the target branch, open PRs with merge conflicts; can block or warn a deploy based on results
- [ ] **Post-deploy annotation** — GitHub Actions action that writes a deployment event into the Nimbus index so the agent can correlate future alerts against this specific deploy; no extra credentials required beyond the HTTP API
- [ ] **Pre-commit hook template** — `nimbus-dev/hooks` package providing a pre-commit hook that checks whether files being committed have related open Jira/Linear tickets, active incidents, or a failing pipeline on the current branch; reports findings without blocking (configurable to block)
- [ ] **`nimbus query` in CI** — documented pattern for using `nimbus query --json` inside CI pipelines (GitHub Actions, Jenkins, GitLab CI) to gate deployments, generate release notes from indexed PRs, or surface incident context in PR comments; requires Gateway running on a self-hosted runner or accessible over LAN

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
- [ ] **Team Vault** — shared credential store; one Gateway acts as trust anchor; role-based read/write access to named vault entries; credentials never leave the LAN
- [ ] **Shared index namespaces** — user publishes a named namespace (e.g. `project:zurich`) as a filtered slice of their index; teammates subscribe over the federation channel; changes propagate on next sync cycle
- [ ] **LAN discovery** — Gateways advertise each other via mDNS; `nimbus team discover` lists available peers; pairing requires explicit mutual approval

### Identity & Access

- [ ] **SSO/OIDC/SAML** — enterprise identity provider integration; tokens stored in the Vault; Gateway validates ID token on every session
- [ ] **SCIM user provisioning** — automated user lifecycle driven by IdP; deprovisioned users' shared namespaces revoked automatically
- [ ] **Role-based access control** — `owner`, `editor`, `viewer` roles per shared namespace; enforced at the federation protocol layer, not just the UI
- [ ] **Multi-user HITL** — workspace owner delegates HITL approval rights to a named team member for a specific workflow; delegate sees a pending approval queue; every delegation recorded in audit log

### Shared Workflows & Policy

- [ ] **Team-owned workflow pipelines** — pipelines in a shared namespace; any team member can trigger; write steps require HITL from the triggering user; no credentials embedded in pipeline YAML
- [ ] **Org-level policy engine** — `nimbus.policy.toml` enforces: connector allowlists, `retentionDays` floor, HITL threshold overrides, audit log shipping destination; interacts with per-user profile config from Phase 3.5
- [ ] **Policy enforcement at the Gateway** — policy loaded on startup; connectors not in the allowlist disabled before the mesh starts; violations logged to audit trail

### Admin & Observability

- [ ] **Admin console** — web UI served locally by the Gateway: user list, namespace health, connector status across the team, audit log viewer, policy editor
- [ ] **Team audit log** — federation events appended to each member's local audit log; owner can request a merged view
- [ ] **GDPR/compliance at org level** — `nimbus team purge --user <id>` removes a user's contributions from all shared namespaces; writes a signed deletion record

### Acceptance Criteria

- Two Nimbus instances on the same LAN establish a federated namespace in under 60 seconds with no external server involved
- A team member's HITL approval on a shared workflow is recorded in both the approver's and the workspace owner's local audit log
- Revoking a peer's federation access removes their read access within one sync cycle; no data retained on their machine after revocation
- An org policy disallowing the Slack connector prevents `nimbus connector auth slack` from succeeding on any member's machine while the policy is active

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
- [ ] **Standing rule management** — `nimbus approve list`, `pause`, `revoke`; each rule shows match scope, expiry, action count, last-fired timestamp
- [ ] **Audit trail for standing approvals** — every action taken under a standing rule logged with rule ID, matched scope, and timestamp; `nimbus audit standing` shows per-rule history
- [ ] **Scheduled workflows** — watchers trigger workflow pipelines on `schedule` condition (cron syntax); read-only workflows run unattended; write workflows with standing-approved steps also run unattended; HITL-required steps without a standing rule block and notify
- [ ] **Morning briefing** — built-in scheduled workflow: cross-service summary (open PRs, active incidents, overdue tickets, unread threads) delivered via notification system at a configured time
- [ ] **Deadline tracking** — monitors items with due dates across Linear, Jira, GitHub, and Calendar; fires notification 24h before deadline when no recent activity is detected on the item
- [ ] **`nimbus schedule list`** — shows all active scheduled workflows with next fire time and last run status

### Core — Incident Correlation Engine

- [ ] **Automatic incident assembly** — when a monitoring alert fires, agent automatically queries the local index for: last deployment before the alert, associated PR, triggering commit, CI run result, Slack/Teams threads mentioning the affected service; assembles a structured incident summary without any user query
- [ ] **Incident timeline** — structured Markdown timeline (alert → deploy → commit → PR → CI); exported via `nimbus incident show <alert-id>` or surfaced in the Tauri dashboard
- [ ] **Suggested remediation** — agent proposes a remediation action (rollback, restart, scale-up) based on indexed history of similar incidents; always HITL-gated before execution

### Core — Agent Memory & Personalization

- [ ] **Long-term episodic memory** — agent stores summarised observations from past sessions in a dedicated SQLite table; recalled at query time via semantic similarity
- [ ] **Personalization layer** — agent adapts communication style and tool selection priority based on observed user preferences; preferences are explicit (configurable), not inferred silently
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
- [ ] **Cost anomaly detection** — monitors Cost Explorer / Azure Cost Management / GCP Billing daily spend; alerts when 24h spend exceeds 7-day rolling average by a configurable threshold
- [ ] **Runbook automation** — common SRE runbooks registered as named HITL-gated actions; agent proposes the right runbook when an incident matches a known pattern

### Acceptance Criteria (core items only)

- A standing approval rule for "archive read Gmail threads older than 60 days" executes its next scheduled run without any user prompt; every archived thread appears in the audit log under the rule ID
- When a PagerDuty P1 fires, the incident summary (deploy, PR, commit, CI result, Slack thread) is assembled and available via `nimbus incident show` within 30 seconds of the alert being indexed — no user query required
- A morning briefing workflow runs fully unattended; any write step without a standing rule sends a notification and blocks rather than executing silently

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
- [ ] **Mobile HITL** — approvals cryptographically signed with a device key stored in the phone's secure enclave

### Physical Sovereignty

- [ ] **Hardware vault integration** — YubiKey and Ledger as a second factor; FIDO2/WebAuthn locally; unlock requires physical device presence
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

### Centralized Policy & Compliance

- [ ] **Policy-as-code** — `nimbus.policy.toml` extended for enterprise: per-user role assignments, connector allowlists, data classification labels, mandatory audit log shipping, HITL threshold overrides per user group
- [ ] **Audit log shipping** — `audit_log` rows streamed (append-only, tamper-evident) to SIEM targets (Splunk, Elastic, Datadog Logs), S3/GCS/Azure Blob, or a mounted file path; fire-and-forget with local retention as fallback
- [ ] **Compliance posture tooling** — `nimbus compliance check` reports: credential storage status, audit log integrity, plaintext credential scan result, connector scope minimization status; structured JSON output suitable for auditors
- [ ] **Data residency controls** — per-connector restriction to a named geographic boundary; Gateway enforces at ingest; non-compliant items flagged and excluded from the index
- [ ] **Formal security audit** — third-party penetration test of Gateway, IPC surface, Vault, and extension sandbox; published report; responsible disclosure programme and bug bounty

### Identity & Governance

- [ ] **Enterprise SSO** — SAML 2.0 and OIDC; tokens in enterprise Vault, not browser cookies; session binding to machine identity
- [ ] **SCIM 2.0 provisioning** — automated user lifecycle driven by IdP; deprovisioned users' Vault entries and shared namespaces revoked within one sync cycle
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