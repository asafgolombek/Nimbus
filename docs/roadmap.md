# Nimbus Roadmap — 2026

This document is the authoritative detailed roadmap for Nimbus. The `readme.md` roadmap section is a summary; this file contains acceptance criteria, inter-quarter dependencies, and the reasoning behind sequencing decisions.

---

## Guiding Principles

Every roadmap decision is evaluated against the project's non-negotiables:

1. **Local-first** — machine is the source of truth; cloud is a connector
2. **HITL is structural** — consent gate is in the executor, not the prompt; cannot be bypassed or reasoned around
3. **No plaintext credentials** — Vault only; never in logs, IPC, or config
4. **MCP as connector standard** — the Engine never calls cloud APIs directly
5. **Platform equality** — Windows, macOS, and Linux are equally supported in every quarter
6. **No feature creep across quarters** — do not implement Q(n+1) features while Q(n) is active

---

## Status Overview

| Quarter | Theme | Status | Release Target |
|---|---|---|---|
| Q1 2026 | Foundation | **Complete** | — |
| Q2 2026 | The Bridge | Planned | End of June 2026 |
| Q3 2026 | Intelligence | Planned | End of September 2026 |
| Q4 2026 | Presence | Planned | End of December 2026 — `v0.1.0` |

---

## Q1 2026 — Foundation ✅

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

## Q2 2026 — The Bridge

**Goal:** Connect every surface a developer works across — cloud storage, email, source control, communication, project tracking, and knowledge management — and unify them in the local index.

### Dependencies

- Q1 complete (Gateway IPC, Vault, MCP connector mesh, delta sync foundation)
- OAuth PKCE flow implemented as a reusable Gateway utility (not per-connector)
- `MCPClient` supports multiplexed connections before adding multiple connectors

### Connector Deliverables

#### Cloud Storage & Email
- [ ] **Google Drive MCP connector** — file list, metadata, download, search; OAuth PKCE; delta sync via `Changes` API
- [ ] **Gmail MCP connector** — message list, thread read, label list, draft create; OAuth PKCE
- [ ] **Google Photos MCP connector** — album list, media item metadata (not binary download by default)
- [ ] **OneDrive MCP connector** — files, folders, delta sync via Microsoft Graph `delta` endpoint
- [ ] **Outlook MCP connector** — mail, calendar events, contacts; Microsoft Graph; first-party app registration

#### Source Control & Code Review
- [ ] **GitHub MCP connector** — repos, PRs (open/closed/merged), issues, CI check runs, review comments; PAT or OAuth
- [ ] **GitLab MCP connector** — projects, merge requests, issues, pipelines, CI jobs
- [ ] **Bitbucket MCP connector** — repos, pull requests, pipelines, issues

#### Communication
- [ ] **Slack MCP connector** — messages, channels, threads, DMs, user list, search; OAuth user token; read-only index + write (post message) behind HITL
- [ ] **Microsoft Teams MCP connector** — chats, channels, meetings, files; Microsoft Graph; read + write behind HITL
- [ ] **Discord MCP connector** (opt-in, off by default) — servers, channels, threads; bot token; read-only index

#### Project & Issue Tracking
- [ ] **Linear MCP connector** — issues, projects, cycles, roadmap, comments, members; API key auth; write (create issue, update status) behind HITL
- [ ] **Jira MCP connector** — issues, sprints, boards, epics, comments, attachments metadata; API token; write behind HITL

#### Knowledge Bases
- [ ] **Notion MCP connector** — pages, databases, database rows, comments, linked mentions; OAuth; write behind HITL
- [ ] **Confluence MCP connector** — spaces, pages, blog posts, inline comments; API token; write behind HITL

### Infrastructure Deliverables

- [ ] **Delta sync scheduler** — per-connector configurable intervals; exponential backoff on failure; sync state persisted in SQLite
- [ ] **Unified metadata schema** — common `item` table across all services with `service`, `type`, `external_id`, `title`, `body_preview`, `modified_at`, `author_id` columns; FTS5 full-text index
- [ ] **Cross-service people graph** — `person` table links Slack handle → GitHub login → Linear member → email address → Outlook contact; populated during sync; used by the agent for identity resolution
- [ ] `nimbus connector` CLI: `auth`, `list`, `sync`, `pause`, `status`, `remove`
- [ ] E2E CLI test suite — mock MCP servers implementing the wire protocol; no real cloud calls in CI

### Acceptance Criteria

- `nimbus ask "find everything I've touched across Drive, GitHub, Slack, and Linear this sprint"` returns merged, ranked results in under 200ms from the local index
- `nimbus ask "who is the most active reviewer on the payment-service repo and what are they working on in Linear?"` resolves the cross-service identity link without a network call
- Revoking a connector's auth (`nimbus connector remove google`) deletes all associated Vault entries and index rows atomically; no orphaned credentials
- All write operations through Slack, Linear, Jira, Notion, Confluence connectors trigger HITL before any outbound call

---

## Q3 2026 — Intelligence

**Goal:** Make Nimbus semantically aware and proactively useful. Extend into CI/CD, cloud infrastructure, and agentic automation.

### Dependencies

- Q2 unified metadata index in place (embedding pipeline needs populated items)
- Extension SDK scaffold stable before Registry v1 ships
- IaC write operations depend on IaC read/index from Q3 foundation items

### Semantic Layer

- [ ] **Embedding pipeline** — chunk items at sync time → local embed via `@xenova/transformers` (no API key); store vectors in `sqlite-vec`; model: `all-MiniLM-L6-v2` (default) / OpenAI opt-in
- [ ] **Hybrid search** — BM25 full-text (FTS5) + vector cosine similarity; RRF fusion reranking; exposed as `nimbus search --semantic`
- [ ] **RAG conversational memory** — session context stored as embedded chunks; recalled at query time; scoped per-project

### Extension Ecosystem

- [ ] **Extension Registry v1** — `@nimbus-dev/sdk` public API stable; manifest schema v1 (`nimbus.extension.json`); `nimbus scaffold extension` generates a working MCP server
- [ ] Extension manifest hash verification on every Gateway startup (tampered extension → disabled)
- [ ] `nimbus extension install/list/disable/enable/remove` CLI commands
- [ ] Extension sandbox: child processes receive only their declared service credentials via env injection; cannot reach Vault or IPC socket

### CI/CD & Infrastructure Connectors

- [ ] **Jenkins MCP connector** — jobs, builds, stages, artefacts, failure logs
- [ ] **GitHub Actions MCP connector** — workflow runs, job steps, artefact metadata
- [ ] **CircleCI MCP connector** — pipelines, workflows, jobs
- [ ] **GitLab CI MCP connector** — pipelines, jobs, artefacts (extends GitLab connector)
- [ ] **AWS MCP connector** — CloudWatch logs/metrics, ECS services, Lambda functions/invocations, EC2 instances, S3 bucket metadata, Cost Explorer daily spend
- [ ] **Azure MCP connector** — Azure Monitor alerts, App Service deployments, AKS cluster state
- [ ] **GCP MCP connector** — Cloud Run revisions, GKE workloads, Cloud Monitoring alerts
- [ ] **IaC awareness** — index Terraform state files (local + remote backend), CloudFormation stacks, Pulumi outputs; detect config drift between indexed state and live infrastructure
- [ ] **IaC write operations** — `terraform plan` → diff shown in HITL prompt → `apply` on approval; rollback path recorded in audit log
- [ ] **Kubernetes connector** — pod status, events, recent restarts, rollout history; kubectl-compatible cluster config; read-only by default, `rollout restart` behind HITL
- [ ] **Datadog MCP connector** — monitors, dashboards, incidents, service catalog
- [ ] **Grafana MCP connector** — alerts, dashboards, datasource metadata
- [ ] **Sentry MCP connector** — issues, events, releases, performance metrics
- [ ] **PagerDuty MCP connector** — incidents, alerts, escalation policies, on-call schedules; acknowledge/resolve behind HITL
- [ ] **New Relic MCP connector** — APM metrics, alerts, deployments

### Workflow Automation

- [ ] **Workflow pipelines** — multi-step workflows defined in natural language or YAML; versioned as files in `~/.config/nimbus/workflows/`; each step is a typed tool call; all write steps individually HITL-gated; pipelines are shareable (no credentials embedded)
- [ ] `nimbus workflow run <name>`, `list`, `edit`, `delete`, `history`
- [ ] **Watcher system** — SQLite-backed event loop; watchers evaluate conditions on each sync cycle; fire notifications or trigger workflow pipelines
  - Condition types: `email_match`, `file_changed`, `file_not_changed`, `deploy_failed`, `alert_fired`, `pr_merged`, `schedule`
  - Actions: `notify`, `run_workflow`, `ask_agent`
- [ ] `nimbus watch create`, `list`, `pause`, `delete`
- [ ] Proactive anomaly detection — watcher engine learns baseline patterns per connector; surfaces anomalies without explicit trigger definitions

### Knowledge Graph & Filesystem Intelligence

- [ ] **Local relationship graph** — SQLite tables: `entity`, `relation`, `relation_type`; populated during sync; entities include people, projects, documents, incidents, PRs, deployments; queryable via natural language → graph traversal
- [ ] **Filesystem connector v2**:
  - Git-aware: indexes commit history, file blame, branch/tag list; generates diff summaries on `git push` events
  - Semantic code search: indexes function signatures, class names, exported symbols; links to GitHub PR history
  - Dependency graph: parses `package.json`, `go.mod`, `Cargo.toml`, `requirements.txt`; flags known-vulnerable versions

### Agent Specialization

- [ ] **DevOps agent** — domain-tuned system prompt; pre-registered tool set scoped to CI/CD, infrastructure, and incident connectors; dedicated memory scope (deployment history, alert patterns)
- [ ] **Research agent** — optimized for document synthesis and cross-service knowledge retrieval; pre-registered tool set scoped to Drive, Notion, Confluence, email; long-context RAG recall

### Acceptance Criteria

- `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, GitHub PR, Jenkins build, CloudWatch error spike, and Slack incident thread — sourced entirely from the local index — in a single response
- A community developer can publish a working Nimbus extension in under one working day using `nimbus scaffold extension` and `MockGateway` from the SDK
- Watcher fires within one sync cycle of its condition becoming true; missed conditions during Gateway downtime are evaluated on next restart
- `terraform plan` → HITL → `apply` flow is tested end-to-end in CI against a mock Terraform binary

---

## Q4 2026 — Presence

**Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations needed for a public `v0.1.0` release.

### Dependencies

- Q3 Extension Registry v1 (Marketplace panel depends on it)
- Q3 Watcher system (Watcher management UI depends on it)
- Q3 Workflow pipelines (pipeline editor depends on it)
- Code signing certificates provisioned before release build step

### Desktop Application (Tauri 2.0)

- [ ] **System tray** — quick-query popup (hotkey-activatable); connector health dot; badge for pending HITL actions
- [ ] **Dashboard** — connector sync status, index item counts, recent agent actions, audit log feed
- [ ] **HITL consent dialogs** — structured action preview; diff view for file/code changes; approve/reject with optional edit before approve
- [ ] **Extension Marketplace panel** — browse, install, update, disable, remove extensions; verified publisher badge; community ratings; changelog per version; auto-update toggle
- [ ] **Watcher management UI** — create, pause, delete watchers; condition builder; history of fired events
- [ ] **Workflow pipeline editor** — visual step list; run history; re-run failed steps; parameter override before run
- [ ] **Settings** — model selection (cloud vs local), sync intervals per connector, Vault key listing (no values shown), audit log viewer + export, data export/import

### Local LLM & Multi-Agent

- [ ] **Local LLM support**:
  - Ollama integration: model discovery, pull, load, unload via Gateway IPC
  - llama.cpp fallback (GGUF model files, no Ollama required)
  - Per-task model routing: fast local model for intent classification and routing; remote model for multi-step reasoning (configurable)
  - Fully air-gapped operation: all features functional with no internet connection when a local model is loaded
- [ ] **Multi-agent orchestration**:
  - Coordinator agent decomposes complex tasks into independent sub-tasks
  - Sub-agents run in parallel; coordinator aggregates results
  - Each sub-agent operates in an isolated tool scope
  - All write operations from sub-agents remain HITL-gated; the coordinator cannot approve on behalf of the user

### Terminal Power Users

- [ ] **Rich TUI** (Ink-based):
  - Pane layout: query input, result stream, connector health sidebar, active watcher list
  - Keyboard navigation; no mouse required; works fully over SSH
  - Real-time HITL consent prompts inline (no separate process)
  - `nimbus tui` command; also launchable from system tray

### Voice Interface

- [ ] **Local STT** — Whisper.cpp bundled in the desktop app; model: `whisper-base.en` (default) / user-selectable; audio never leaves the machine
- [ ] **Voice queries** — push-to-talk in desktop app; result summary spoken via local TTS (platform: `pyttsx3` on Linux, `say` on macOS, SAPI on Windows)
- [ ] Wake word support (opt-in, disabled by default)

### Data Sovereignty

- [ ] **Full export** — `nimbus data export --output nimbus-backup.tar.gz`: SQLite snapshot (metadata index), vault credential manifest (re-encrypted with a user-provided passphrase), watcher definitions, workflow pipelines, extension list
- [ ] **Full import** — `nimbus data import nimbus-backup.tar.gz`: decrypts manifest, re-seals credentials into the target machine's native Vault, restores index, re-registers extensions
- [ ] **GDPR deletion** — `nimbus data delete --service <name>`: removes all index rows and Vault entries for a service; writes a signed deletion record to the audit log
- [ ] **Tamper-evident audit log** — each audit log row is BLAKE3-chained to the previous; log export includes the chain; `nimbus audit verify` checks integrity

### Release Infrastructure

- [ ] Signed + notarized release binaries: macOS (Gatekeeper notarized), Windows (Authenticode signed), Linux (GPG-signed `.deb` + AppImage)
- [ ] Auto-update via self-hosted `tauri-update-server`; update checked on Gateway startup; user approves before applying
- [ ] Plugin API v1 — third-party connector registration stable and documented; breaking changes require a major version bump
- [ ] Optional encrypted LAN remote access — E2E encrypted (NaCl box), no relay server; scoped to read-only by default; write requires separate HITL approval on the host machine

### Acceptance Criteria

- `v0.1.0` installers pass Gatekeeper (macOS) and SmartScreen (Windows) without user override required
- `nimbus ask "summarize everything that happened across my projects this week"` runs fully locally via Ollama — no API key, no network call — and completes in under 30 seconds on a mid-range laptop
- Multi-agent orchestration: a task decomposed into 3 parallel sub-agents cannot bypass HITL on any of its write steps — verified by automated test
- `nimbus data export` → wipe index and Vault → `nimbus data import` restores full functionality with all connectors re-authenticated on a fresh machine
- Five community extensions available in the Marketplace at `v0.1.0` launch

---

## Post-2026 Vision

Items below are intentionally unscheduled. They inform architectural decisions made in 2026 but are not committed roadmap items.

| Area | Direction |
|---|---|
| **Mobile companion** | iOS/Android app connects to home Gateway over E2E-encrypted LAN or WireGuard tunnel; read queries + HITL approval from phone; no cloud relay |
| **Cross-device P2P sync** | Encrypted index sync between user's own machines; BLAKE3-keyed protocol; vector-clock conflict resolution; no third party |
| **Team Vault** | Shared credential store for a small team; Gateway acts as local trust anchor; role-based access; no SaaS backend |
| **SSO integration** | SAML/OIDC for enterprise identity; tokens stored in Vault, not browser |
| **Formal security audit** | Third-party penetration test + published report; bug bounty program |
| **Fine-tuning pipeline** | LoRA adapters trained on user's own writing style and workflow patterns; run locally |
| **Nimbus-to-Nimbus federation** | Two users each running a Gateway share a scoped index over an E2E-encrypted channel; no central server |
| **Extension monetization** | Paid extensions; revenue sharing; license key enforcement via local validation |
| **Extension Marketplace v2** | Ratings, verified publisher badges, auto-updates, community reviews, paid tier |

---

## How to Update This Document

- When a quarter begins, move its items from "Planned" to "In Progress" in the status table.
- Check boxes off as individual items are merged to `main`.
- When a quarter closes, update the status table and add a "Delivered" section mirroring Q1's format.
- Do not add new items to an in-progress quarter without a corresponding issue and team discussion.
- Post-2026 items can be promoted to a quarter once two prior items in the same area have shipped.
