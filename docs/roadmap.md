# Nimbus Roadmap

This document is the authoritative roadmap for Nimbus. [`README.md`](./README.md) carries a summary; this file contains acceptance criteria, inter-phase dependencies, and the reasoning behind sequencing decisions.

Phases are thematic, not calendar-bound. A phase begins when its dependencies are met and ends when its acceptance criteria pass — not at a quarter boundary. Phases may overlap when deliverables are independent.

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
| Phase 1 | Foundation | **Complete** |
| Phase 2 | The Bridge | **Complete** |
| Phase 3 | Intelligence | **Active** |
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

**Status:** Active — Phase 2 complete as of April 2026.

### Dependencies

- Phase 2 unified metadata index (embedding pipeline needs populated items)
- Extension SDK scaffold stable before Registry v1 ships
- IaC write operations depend on IaC read/index from Phase 3 foundation items

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

- [ ] **Workflow pipelines** — named, saved multi-step workflows stored in `~/.config/nimbus/workflows/`; same YAML format and execution engine as script files; all write steps individually HITL-gated; pipelines are shareable (no credentials embedded); `nimbus workflow save <path> --name <name>` promotes a script file into a saved pipeline
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

### Interaction Layer

- [ ] **Session CLI** — `nimbus` with no arguments launches an interactive session; conversation history maintained in the Gateway across turns using the RAG conversational memory foundation; context-aware follow-up queries understood without re-specifying prior results; HITL consent rendered as inline conversation turns; session state persists across CLI reconnects if the Gateway is still running
- [ ] **Script files** — `nimbus run <path>` executes a YAML script as a single session with shared context across steps:
  - Format: `steps` array of natural language instructions; optional per-step `label` and `continue-on-error`
  - **Preview phase (mandatory):** engine analyses all steps, identifies every action requiring HITL approval, presents a structured plan summary; user must confirm before step 1 runs
  - **No-TTY safety:** if no interactive terminal is attached and the script contains HITL-required steps, the Gateway aborts before executing any step; read-only scripts run without a TTY — safe for automation and CI
  - **Convergence with workflow pipelines:** `nimbus run <path>` and `nimbus workflow run <name>` share the same execution engine

### Agent Specialization

- [ ] **DevOps agent** — domain-tuned system prompt; pre-registered tool set scoped to CI/CD, infrastructure, and incident connectors; dedicated memory scope (deployment history, alert patterns)
- [ ] **Research agent** — optimized for document synthesis and cross-service knowledge retrieval; pre-registered tool set scoped to Drive, Notion, Confluence, email; long-context RAG recall

### Acceptance Criteria

- `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, GitHub PR, Jenkins build, CloudWatch error spike, and Slack incident thread — sourced entirely from the local index — in a single response
- A community developer can publish a working Nimbus extension in under one working day using `nimbus scaffold extension` and `MockGateway` from the SDK
- Watcher fires within one sync cycle of its condition becoming true; missed conditions during Gateway downtime are evaluated on next restart
- `terraform plan` → HITL → `apply` flow is tested end-to-end in CI against a mock Terraform binary

---

## Phase 4 — Presence

**Goal:** Give Nimbus a face, a local AI backbone that requires no cloud API key, and the trust foundations needed for a public `v0.1.0` release.

### Dependencies

- Phase 3 Extension Registry v1 (Marketplace panel depends on it)
- Phase 3 Watcher system (Watcher management UI depends on it)
- Phase 3 Workflow pipelines (pipeline editor depends on it)
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

- [ ] **Rich TUI** (Ink-based) — builds on the Phase 3 Session CLI; full pane layout:
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

## Phase 5 — The Extended Surface

**Goal:** Fill every connector gap so that wherever a knowledge worker or developer spends time, their data is in the index. Mature the extension ecosystem so the community can build what the core team cannot.

### Dependencies

- Phase 3 Extension Registry v1 (new connectors should ship as community extensions where possible, not core connectors)
- Phase 4 Plugin API v1 stable and documented

### New Connector Categories

#### Browser & Reading

- [ ] **Pocket / Readwise / Raindrop** MCP connectors — saved articles, highlights, reading lists, tags; read-only index
- [ ] **Browser history connector** — via a local browser extension (Chrome/Firefox/Safari) that pushes visited URLs + page titles to the Gateway over local HTTP; no cloud relay; opt-in; history stored locally only
- [ ] **Web clipper** — browser extension that lets users save a page directly into the Nimbus index with a tag; surfaced in `nimbus search` alongside Drive files and emails

#### Email via IMAP/SMTP

- [ ] **Generic IMAP connector** — any IMAP server (Fastmail, ProtonMail, self-hosted); credentials in Vault; full-text `body_preview` indexing; `email.send` behind HITL via SMTP
- [ ] **Fastmail MCP connector** — JMAP native (faster and more efficient than IMAP for Fastmail accounts)
- [ ] **ProtonMail MCP connector** — ProtonMail Bridge integration; local IMAP interface; read-only index (ProtonMail E2EE precludes server-side access)

#### Finance & Expenses

- [ ] **Expensify MCP connector** — expense reports, receipts, reimbursement status; read-only index; submit expense behind HITL
- [ ] **Ramp MCP connector** — transactions, receipts, budgets, vendor spend; read-only index
- [ ] **Mercury MCP connector** — business banking; account balances, transactions, bills; read-only index; wire/ACH transfer behind HITL
- [ ] **Stripe MCP connector** — invoices, payments, customers, disputes, subscription events; read-only index; refund behind HITL

#### CRM & Sales

- [ ] **HubSpot MCP connector** — contacts, companies, deals, activities, notes, emails; OAuth; write (create contact, update deal) behind HITL
- [ ] **Salesforce MCP connector** — objects (Lead, Contact, Account, Opportunity, Case), activities, files; OAuth; write behind HITL
- [ ] **Pipedrive MCP connector** — deals, persons, organisations, activities, notes; API key; write behind HITL

#### HR & Recruiting

- [ ] **Greenhouse MCP connector** — jobs, candidates, applications, scorecards, offers; API key; write (move stage, post feedback) behind HITL
- [ ] **Lever MCP connector** — requisitions, candidates, feedback, interviews; API key; write behind HITL
- [ ] **Workday MCP connector** — time off, headcount, org chart, job postings (read-only where API access allows); OAuth

#### Design & Creative

- [ ] **Figma MCP connector** — files, frames, comments, version history, FigJam boards; OAuth; `figma_comment_post` behind HITL
- [ ] **Miro MCP connector** — boards, cards, sticky notes, comments; OAuth; write (create card, add comment) behind HITL
- [ ] **Canva MCP connector** — designs, folders, shared projects; OAuth; read-only index

### Extension Marketplace v2

- [ ] Community ratings and reviews per extension
- [ ] Verified publisher badges (GPG-signed manifest from a registered publisher)
- [ ] Extension monetization infrastructure — paid extensions; license key enforcement via local validation; revenue sharing to publisher
- [ ] Auto-update with changelog preview; user approves each version bump
- [ ] Extension dependency resolution (one extension can depend on another)

### Acceptance Criteria

- A user with a Fastmail account can run `nimbus connector auth fastmail` and have their inbox indexed within 5 minutes using the generic IMAP connector
- A HubSpot deal update initiated by the agent triggers HITL before any outbound API call
- A community extension published via the Marketplace can be installed, enabled, and used without the author having access to Nimbus core source
- Browser history connector indexes visited pages locally with zero data leaving the machine; the browser extension communicates only with `localhost`

---

## Phase 6 — Team

**Goal:** Make Nimbus a collaborative layer for engineering teams and organisations — shared intelligence without surrendering local sovereignty.

### Dependencies

- Phase 4 encrypted LAN remote access (provides the E2EE channel foundation for Nimbus-to-Nimbus)
- Phase 4 tamper-evident audit log (required for org-level compliance controls)
- Phase 4 Plugin API v1 (team connectors can ship as extensions)

### Shared Infrastructure

- [ ] **Nimbus-to-Nimbus federation** — two Gateways share a scoped index namespace over an E2E-encrypted channel (NaCl box); no relay server; each side controls exactly which `item` types and services it exposes; revocable per peer
- [ ] **Team Vault** — shared credential store for a small team; one designated Gateway acts as the trust anchor; role-based read/write access to named vault entries; no SaaS backend; credentials never leave the LAN
- [ ] **Shared index namespaces** — a user publishes a named namespace (e.g. `project:zurich`) containing a filtered slice of their index; teammates subscribe over the federation channel; changes propagate on the next sync cycle
- [ ] **LAN discovery** — Gateways on the same network advertise each other via mDNS; `nimbus team discover` lists available peers; pairing requires explicit mutual approval

### Identity & Access

- [ ] **SSO/OIDC/SAML** — enterprise identity provider integration; tokens stored in the Vault, not the browser; Gateway validates ID token on every session
- [ ] **SCIM user provisioning** — automated user lifecycle (create, suspend, deprovision) driven by the IdP; deprovisioned users' shared namespaces are revoked automatically
- [ ] **Role-based access control** — `owner`, `editor`, `viewer` roles per shared namespace; enforced at the federation protocol layer, not just the UI
- [ ] **Multi-user HITL** — a workspace owner can delegate HITL approval rights to a named team member for a specific workflow; the delegate sees a pending approval queue; every delegation is recorded in the audit log

### Shared Workflows & Policy

- [ ] **Team-owned workflow pipelines** — pipelines stored in a shared namespace; any team member can trigger; write steps require HITL from the triggering user (not the owner); no credentials embedded in the pipeline YAML
- [ ] **Org-level policy engine** — a `nimbus.policy.toml` file (managed by the team owner) enforces: connector allowlists, `retentionDays` floor, HITL threshold overrides, audit log shipping destination
- [ ] **Policy enforcement at the Gateway** — policy is loaded on startup; connectors not in the allowlist are disabled before the mesh starts; policy violations are logged to the audit trail

### Admin & Observability

- [ ] **Admin console** — web UI (served locally by the Gateway on demand) for team owners: user list, namespace health, connector status across the team, audit log viewer, policy editor
- [ ] **Team audit log** — federation events (peer connect/disconnect, namespace subscribe/revoke, shared HITL approvals) are appended to each member's local audit log; the owner can request a merged view
- [ ] **GDPR/compliance at org level** — `nimbus team purge --user <id>` removes a user's contributions from all shared namespaces and writes a signed deletion record; data residency controls configurable in policy

### Acceptance Criteria

- Two Nimbus instances on the same LAN can establish a federated namespace in under 60 seconds with no external server involved
- A team member's HITL approval on a shared workflow is recorded in both the approver's and the workspace owner's local audit log
- Revoking a peer's federation access removes their read access to the shared namespace within one sync cycle; no data is retained on their machine after revocation
- An org policy that disallows the Slack connector prevents `nimbus connector auth slack` from succeeding on any member's machine while the policy is active

---

## Phase 7 — The Autonomous Agent

**Goal:** Transform Nimbus from a reactive tool you query into a proactive collaborator that watches, learns, and acts — always within the bounds of what you have authorised.

### Dependencies

- Phase 3 Watcher system and RAG conversational memory
- Phase 3 Proactive anomaly detection (watcher baseline learning)
- Phase 4 Local LLM support and multi-agent orchestration
- Phase 4 Tamper-evident audit log (standing approvals are recorded and auditable)

### Standing Approvals

- [ ] **Standing approval rules** — users pre-authorise specific recurring write patterns (e.g. "always archive Gmail threads older than 90 days matching this label"); stored in SQLite with an explicit scope, expiry, and item count ceiling; agent checks standing rules before prompting for HITL
- [ ] **Approval learning** — after a user approves the same agent action N consecutive times (configurable; default: 5), Nimbus suggests creating a standing rule; user must explicitly confirm; suggestion is logged
- [ ] **Standing rule management** — `nimbus approve list`, `pause`, `revoke`; each rule shows its match scope, expiry, action count, and last-fired timestamp
- [ ] **Audit trail for standing approvals** — every agent action taken under a standing rule is logged with the rule ID, matched scope, and timestamp; `nimbus audit standing` shows a per-rule history

### Schedule-Driven Agentic Tasks

- [ ] **Scheduled workflows** — watchers can trigger workflow pipelines on a `schedule` condition (cron syntax); read-only workflows run unattended; write workflows with standing-approved steps also run unattended; any HITL-required step without a standing rule blocks and notifies
- [ ] **Morning briefing** — built-in scheduled workflow: every morning at a configured time, the agent assembles a cross-service summary (open PRs, active incidents, overdue tickets, unread threads) and delivers it via the notification system
- [ ] **Deadline tracking** — agent monitors items with due dates across Linear, Jira, GitHub, and Calendar; fires a notification when a deadline is 24h away and no recent activity is detected on the item
- [ ] `nimbus schedule list` — shows all active scheduled workflows with their next fire time and last run status

### Incident Correlation Engine

- [ ] **Automatic incident assembly** — when a monitoring alert fires (PagerDuty, Datadog, etc.), the agent automatically queries the local index for: last deployment before the alert, associated PR, triggering commit, CI run result, and any Slack/Teams threads mentioning the affected service; assembles a structured incident summary without any user query
- [ ] **Incident timeline** — structured Markdown timeline from alert → deploy → commit → PR → CI; exported via `nimbus incident show <alert-id>` or surfaced in the Tauri dashboard
- [ ] **Suggested remediation** — agent proposes a remediation action (rollback, restart, scale-up) based on the indexed history of similar incidents; action is always HITL-gated before execution

### Agent Memory & Personalization

- [ ] **Long-term episodic memory** — agent stores summarised observations from past sessions (decisions made, patterns noticed, approvals granted) in a dedicated SQLite table; recalled at query time via semantic similarity
- [ ] **Personalization layer** — agent adapts communication style, response verbosity, and tool selection priority based on observed user preferences; preferences are explicit (configurable) not inferred silently
- [ ] **Decision pattern recognition** — agent identifies repeated decision patterns across HITL history (e.g. "user always chooses Archive over Delete for Notion pages"); surfaces them as standing rule candidates

### Local Model Fine-Tuning

- [ ] **LoRA adapter training** — train lightweight adapters on the user's own writing style (emails, Slack messages, Notion pages, PR descriptions) using the local NPU/GPU; model: Llama 3 or Mistral base; no data leaves the machine
- [ ] **Domain-specific recall** — fine-tuned adapter improves the agent's ability to match the user's naming conventions, jargon, and project context when drafting text or classifying intent
- [ ] `nimbus model train --adapter writing-style` — triggers a background fine-tuning job; `nimbus model status` shows progress; adapters are versioned and rollback-safe

### Infrastructure-as-Agent (SRE Loop)

- [ ] **Autonomous drift detection** — agent continuously compares IaC declared state (Terraform/Pulumi) against indexed live cloud state; flags drift in the dashboard without waiting for a user query
- [ ] **Remediation proposals** — for detected drift, agent drafts a `terraform plan` or equivalent remediation; user reviews the diff in the HITL dialog and approves or rejects; no cloud mutation without explicit approval
- [ ] **Cost anomaly detection** — agent monitors Cost Explorer / Azure Cost Management / GCP Billing daily spend; alerts when a 24h spend exceeds the 7-day rolling average by a configurable threshold
- [ ] **Runbook automation** — common SRE runbooks (pod restart, cache flush, feature flag toggle) can be registered as named HITL-gated actions; agent can propose the right runbook when an incident matches a known pattern

### Acceptance Criteria

- A standing approval rule for "archive read Gmail threads older than 60 days" executes its next scheduled run without any user prompt; every archived thread appears in the audit log under the rule ID
- When a PagerDuty P1 fires, the incident summary (deploy, PR, commit, CI result, Slack thread) is assembled and available via `nimbus incident show` within 30 seconds of the alert being indexed — no user query required
- A LoRA adapter trained on 500 of the user's Slack messages measurably improves intent classification accuracy on held-out messages (≥5% F1 improvement over base model)
- Drift detected between Terraform state and live AWS is surfaced in the dashboard within one sync cycle; the agent-proposed `terraform plan` matches the actual drift

---

## Phase 8 — Sovereign Mesh

**Goal:** Extend Nimbus beyond the single machine — across the user's own devices, between trusted people, and into the physical world — without introducing any relay server or trusted third party.

### Dependencies

- Phase 4 tamper-evident audit log and data export/import
- Phase 6 federation protocol (Nimbus-to-Nimbus channel is the mesh primitive)
- Phase 7 standing approvals (mobile HITL approvals are a standing-approval variant)

### Cross-Device Sync

- [ ] **P2P index sync** — encrypted index sync between a user's own machines (laptop ↔ desktop ↔ home server); BLAKE3-keyed protocol; vector-clock conflict resolution; no third party
- [ ] **Selective sync** — user controls which `item` types and services sync to which device (e.g. work laptop gets GitHub + Jira; home desktop gets Drive + Gmail); configuration stored in the Vault
- [ ] **Sync conflict resolution UI** — when two devices diverge (offline edits), the agent surfaces the conflict in the dashboard with a diff view; user resolves manually or accepts one side

### Mobile Companion

- [ ] **iOS app** — connects to the home Gateway over E2EE LAN or WireGuard tunnel; no cloud relay; supports: natural language queries against the local index, HITL approval queue, watcher notifications, read-only connector status
- [ ] **Android app** — same feature set as iOS
- [ ] **Push notifications** — watcher alerts and pending HITL approvals delivered via local push (LAN) or WireGuard; no third-party push service required; opt-in to cloud push (APNs/FCM) for out-of-LAN reachability
- [ ] **Mobile HITL** — agent write operations requiring approval can be reviewed and approved from the mobile app; approval is cryptographically signed with a device key stored in the phone's secure enclave

### Physical Sovereignty

- [ ] **Hardware vault integration** — YubiKey and Ledger as a second factor for the Nimbus Vault; unlock requires physical device presence; FIDO2/WebAuthn locally
- [ ] **Air-gapped secret management** — credentials for the most sensitive connectors can be stored exclusively on a hardware key; the Gateway requests them via local USB/NFC at sync time; never written to disk in plaintext even temporarily
- [ ] **Decentralized Identifiers (DIDs)** — replace provider-issued OAuth identities with self-sovereign DIDs for Nimbus-to-Nimbus authentication; DID document stored locally; no central registry required

### Digital Executor

- [ ] **Dead man's switch** — user configures a set of cryptographic keys and documents to be handed over to named recipients if the user's Gateway is inactive for a configurable period
- [ ] **Threshold secret sharing** — executor payload is split using Shamir's Secret Sharing across N trusted recipients; any M-of-N can reconstruct it; no single recipient can access it alone
- [ ] **Executor audit trail** — every check-in, near-trigger, and handover event is logged in the tamper-evident audit chain; recipients receive a verifiable log alongside the payload

### Acceptance Criteria

- A user's index syncs between two machines on the same LAN in under 60 seconds for a 50,000-item dataset; no data passes through any external server
- A HITL approval made on the mobile app executes within 5 seconds on the home Gateway; the action and approval signature appear in the local audit log
- Removing a YubiKey while the Gateway is running causes credential access to fail gracefully (not crash); re-inserting the key resumes normal operation without re-auth
- A Digital Executor payload reconstructed by M-of-N recipients is byte-identical to the original and its audit chain passes `nimbus audit verify`

---

## Phase 9 — Enterprise

**Goal:** Make Nimbus deployable and auditable at institutional scale for security-conscious organisations. This phase is explicitly tied to the commercial license tier — AGPL users retain all individual and team features; enterprise deployment, compliance tooling, and SLA support are commercial.

### Dependencies

- Phase 6 Team (Enterprise builds on the team collaboration foundation)
- Phase 4 tamper-evident audit log (required for compliance export)
- Phase 7 Autonomous Agent (enterprise use cases for SRE loop and standing approvals)

### Deployment & Operations

- [ ] **Docker image** — official `ghcr.io/nimbus/gateway` image; multi-arch (amd64/arm64); configurable via env vars and mounted `nimbus.toml`
- [ ] **Helm chart** — `nimbus/gateway` Helm chart for Kubernetes; supports: namespace isolation, persistent volume for SQLite, external Vault backend (HashiCorp Vault), RBAC, NetworkPolicy
- [ ] **Air-gapped bundle** — single tarball containing all binaries, local LLM model weights, and dependency assets; deployable with no outbound internet access
- [ ] **High availability** — active/passive Gateway clustering for teams; leader election via SQLite WAL + advisory lock; failover in under 30 seconds
- [ ] **Managed update channel** — enterprise customers receive updates on a dedicated channel with a 2-week delay vs. main; allows internal QA before rollout

### Centralized Policy & Compliance

- [ ] **Policy-as-code** — `nimbus.policy.toml` extended for enterprise: per-user role assignments, connector allowlists, data classification labels, mandatory audit log shipping, HITL threshold overrides per user group
- [ ] **Audit log shipping** — `audit_log` rows streamed (append-only, tamper-evident) to: SIEM targets (Splunk, Elastic, Datadog Logs), S3/GCS/Azure Blob, or a mounted file path; shipping is fire-and-forget with local retention as fallback
- [ ] **Compliance posture tooling** — `nimbus compliance check` reports: credential storage status, audit log integrity, last-known plaintext credential scan result, connector scope minimization status; outputs a structured JSON report suitable for auditor review
- [ ] **Data residency controls** — per-connector configuration to restrict index data to a named geographic boundary (e.g. EU-only); Gateway enforces at ingest; non-compliant items are flagged and excluded from the index
- [ ] **Formal security audit** — third-party penetration test of the Gateway, IPC surface, Vault implementation, and extension sandbox; published report; responsible disclosure programme and bug bounty

### Identity & Governance

- [ ] **Enterprise SSO** — SAML 2.0 and OIDC identity provider integration; tokens stored in the enterprise Vault, not browser cookies; session binding to machine identity
- [ ] **SCIM 2.0 provisioning** — automated user lifecycle driven by the IdP; deprovisioned users' Vault entries and shared namespaces are revoked within one sync cycle
- [ ] **Privileged access management** — named admin users can view (but not export) any team member's connector health and audit log; cannot view index content or credentials

### Admin Console (Enterprise)

- [ ] **Org-wide dashboard** — web UI showing: Gateway health per member, index item counts by service, watcher fire rate, HITL queue depth, audit log freshness
- [ ] **Policy editor** — GUI for editing `nimbus.policy.toml` with validation and diff preview before applying
- [ ] **Credential rotation assistant** — identifies connectors using credentials older than a configurable threshold; guides the admin through a coordinated re-auth workflow that minimises downtime

### SLA & Support

- [ ] **Priority support tier** — dedicated CSM, 4h response SLA for P1 issues, private Slack channel
- [ ] **Deployment assistance** — official runbooks for Docker/Kubernetes/air-gapped deployments; reference architecture for common enterprise stacks
- [ ] **DPA and legal templates** — Data Processing Agreement, sub-processor list, GDPR Article 28 documentation for enterprise procurement

### Acceptance Criteria

- The Helm chart deploys a functional Gateway cluster on Kubernetes with persistent storage and NetworkPolicy in under 15 minutes from a clean cluster
- `nimbus compliance check` produces a machine-readable JSON report that passes a reference auditor schema without manual intervention
- Audit log shipping to a Splunk HEC endpoint is verified end-to-end in CI against a mock HEC target; no audit row is lost in a Gateway restart scenario
- Deprovisioning a user via SCIM removes their shared namespace access within one sync cycle and writes a signed record to the org audit log

---

## How to Update This Document

- When a phase becomes active, update its status in the overview table.
- Check off individual items (`[x]`) as they are merged to `main`.
- When a phase completes, add a **Delivered** section (see Phase 1 and 2 for the format) and update the status table.
- Do not add new items to an active phase without a corresponding issue and team discussion.
- Planned phase items can be reprioritised between phases — open a discussion, update this file, update `CLAUDE.md` and `GEMINI.md` to match.
- New phases can be added after the last planned phase; do not insert phases between active/complete phases.
