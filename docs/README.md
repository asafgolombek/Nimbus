<div align="center">

# ☁️ Nimbus

### The Local-First Digital Lieutenant.

*Autonomous AI orchestration across your cloud services, repositories, pipelines, and infrastructure — on your terms, from your machine.*

[![Built with Bun](https://img.shields.io/badge/runtime-Bun_1.2+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript_6.x-3178C6?logo=typescript)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/platforms-Windows_%7C_macOS_%7C_Linux-blue)]()
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](../LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-Alpha-orange)]()

</div>

---

Nimbus is an open-source, local-first AI agent framework that bridges the gap between your machine and the services you connect. A headless **Nimbus Gateway** runs as a background process, maintaining a private local index of metadata across **shipped** first-party connectors — Google Drive, Gmail, Google Photos, OneDrive, Outlook, Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, and the local filesystem — with more surfaces (CI/CD hosts, cloud control planes, observability tools, semantic search) on the **[roadmap](./roadmap.md)** for later quarters. The Nimbus agent — powered by [Mastra](https://mastra.ai) and a configurable model provider — reasons over this index and executes multi-step workflows on your behalf. Every destructive or outgoing action is gated by an explicit Human-in-the-Loop consent step.

Your data never passes through a Nimbus server. There is no Nimbus server.

---

## Why Nimbus?

### 🔒 Security by Architecture, Not Policy

Credentials are stored in your OS's native keystore — Windows DPAPI, macOS Keychain, Linux Secret Service. The code has no path to write them anywhere else. The Human-in-the-Loop consent gate is implemented in the executor, not in the prompt — a model cannot reason around a function call that does not exist. Third-party extensions run in sandboxed child processes and cannot access the Vault or other connectors' credentials.

### ⚡ Fast Enough to Be Useful

Most queries never touch the network. Nimbus maintains a local SQLite metadata index, so searching across 50,000 indexed items across five services takes under 100ms. The runtime is [Bun](https://bun.sh) — native TypeScript, sub-100ms Gateway startup, built-in SQLite.

| Operation | Nimbus (local index) | Typical SaaS |
|---|---|---|
| Search across all services | ~20–80ms | 1,500–4,000ms |
| List recent files from 3 services | ~5ms | 3× API round trips |
| Semantic recall (embeddings) | ~50–200ms | Remote embed + search |
| Gateway cold start | ~80ms | Always-on cloud |

### 🌍 True Cross-Platform

Windows, macOS, and Linux are equally supported — not "also works on." Every pull request runs a fast **PR quality** job on Ubuntu (typecheck, Biome, build, tests, Vitest, Rust fmt/clippy for Tauri); pushes to `main`/`develop` run the **full three-platform matrix** in parallel. Platform-specific code (IPC transport, secrets, autostart, notifications) is isolated behind a typed abstraction layer. A feature that works on macOS and "probably works" on Windows is a bug.

### 🧩 Extensible by Design

A first-class extension system lets third-party developers publish new connectors as npm packages. Install one command, and the agent gains a new capability. The local Extension Marketplace in the Tauri app makes community connectors discoverable without leaving the UI.

### 🧠 Agent-Grade Reasoning

Nimbus understands intent, decomposes multi-step tasks, executes them across services, and streams structured results. Ask it in plain English — it plans, confirms where necessary, and acts.

### 🔧 DevOps Intelligence — Not Another Dashboard

Pull requests, issues, and messages already land in the local index from the shipped source-control and comms connectors. The **[roadmap](./roadmap.md)** extends that story to CI/CD hosts, Kubernetes, cloud accounts, and observability tools so you can ask cross-layer questions in one place. When those connectors ship, write operations — merging a PR, triggering a build, applying a plan, acknowledging an alert — will go through the same consent-gated executor as every other Nimbus action: the agent proposes; you approve.

---

## 2026 Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | [Bun v1.2+](https://bun.sh) | Native TypeScript, fast startup, built-in SQLite, FFI for native bindings |
| **Language** | TypeScript 6.x strict mode | Type safety, IDE tooling, Mastra-native |
| **Agent Framework** | [Mastra](https://mastra.ai) | Structured agents, tool registration, workflow orchestration, observability |
| **Integration Protocol** | [Model Context Protocol](https://modelcontextprotocol.io) | Vendor-neutral connector standard; first-class Mastra support |
| **Local Database** | `bun:sqlite` + [sqlite-vec](https://github.com/asg017/sqlite-vec) | Zero-dependency metadata index + vector search |
| **Secrets — Windows** | Windows DPAPI (`CryptProtectData`) | Key derived from user account; fails on other accounts/machines |
| **Secrets — macOS** | Keychain Services | Locked on screen lock; requires app entitlement |
| **Secrets — Linux** | Secret Service API via `libsecret` | GNOME Keyring / KWallet integration |
| **IPC Protocol** | JSON-RPC 2.0 over Domain Socket / Named Pipe | Language-agnostic, local-only, no TCP surface |
| **CLI** | Bun + [@clack/prompts](https://github.com/natemoo-re/clack) | Interactive terminal UX; consent channel for HITL |
| **Desktop UI** | [Tauri 2.0](https://tauri.app) + React 19 | ~5MB native shell; WebView2 (Win) / WKWebView (mac) / WebKitGTK (Linux) |
| **LLM** | Anthropic Claude (default) / configurable | Pluggable via Mastra model abstraction |
| **Embeddings** | `@xenova/transformers` (local) / OpenAI (opt-in) | Local-first; no API key required for basic RAG |
| **Extension SDK** | `@nimbus-dev/sdk` (first-party npm package) | Typed scaffolding, `MockGateway` for testing, manifest validation. Licensed MIT so extension authors aren't burdened by AGPL. |
| **Testing — Gateway/CLI** | `bun test` | In-toolchain, zero config, fastest feedback loop |
| **Testing — UI** | Vitest + `@testing-library/react` | Integrates with Vite/Tauri transform pipeline; jsdom support |
| **Testing — E2E Desktop** | Playwright + Tauri WebDriver | Only tool with cross-platform native app automation |
| **Security Scanning** | `bun audit` + `trivy` + CodeQL | Dependency and static analysis on PRs; Dependabot for updates |
| **CI** | GitHub Actions | **PR:** Ubuntu-only `pr-quality` (build + tests + Vitest + Rust checks). **Push:** full matrix on `ubuntu-22.04`, `macos-14`, `windows-2022` |
| **Release** | `bun build --compile` + code signing | Single binary per platform; signed + notarized on macOS |

---

## Quick Start

### Prerequisites

- **From source:** [Bun v1.2+](https://bun.sh/docs/installation) on your machine.
- **Pre-built binaries:** No Bun install required — releases are self-contained executables produced with `bun build --compile`.
- **Connectors (when enabled):** Google Cloud project with Drive, Gmail, Photos APIs; Azure app registration with Microsoft Graph (OneDrive / Outlook).

---

### Where to run commands

| What you are doing | Working directory |
|---|---|
| **Clone + install + build** (from source) | Repository **root** — the folder that contains the root `package.json` (the `nimbus` directory after `git clone`). |
| **`nimbus` CLI** | Any directory, once the CLI binary is on your `PATH` (or you invoke it with a full path). |

---

### Option A — Pre-built binaries (no Git checkout)

1. Open **[GitHub Releases](https://github.com/your-org/nimbus/releases)** for this repository (replace `your-org` with the real org or fork).
2. Download the files for your OS from the latest **v**`*.*.*` release:

   | Asset | Purpose |
   |---|---|
   | `nimbus-gateway-linux-x64`, `nimbus-gateway-macos-x64`, `nimbus-gateway-windows-x64.exe` | Headless Gateway process |
   | `nimbus-cli-linux-x64`, `nimbus-cli-macos-x64`, `nimbus-cli-windows-x64.exe` | `nimbus` terminal command |

3. **Linux / macOS:** `chmod +x nimbus-gateway-* nimbus-cli-*` (or only the files you use).
4. Optionally rename the CLI binary to `nimbus` and add its directory to your `PATH`.
5. Binaries embed a Bun runtime — you do **not** need to install Bun separately to **run** them.

---

### Option B — Build from source (contributors & local dev)

From a terminal, use the **repository root** only:

```bash
git clone https://github.com/your-org/nimbus.git
cd nimbus
```

Install dependencies with **`bun install`** (Bun’s built-in command). Do **not** run `bun run install` — that looks for a `"install"` script in `package.json`, which this repo does not define, and will fail with `Script not found "install"`.

```bash
bun install
bun run build
```

After a successful build:

| OS | CLI (Gateway is built to repo `dist/` as well) |
|---|---|
| Windows | `packages\cli\dist\nimbus.exe` (or `nimbus` if Bun emitted the name without `.exe`) |
| macOS / Linux | `./packages/cli/dist/nimbus` |

You can add `packages/cli/dist` to your `PATH`, symlink the binary as `nimbus`, or call it with a full path. The workspace does not currently register the CLI into root `node_modules/.bin` unless you depend on `@nimbus/cli` from another package, so **`nimbus` alone may not resolve** until you put the built binary on `PATH`.

---

### Start the Gateway

Examples below use `nimbus` as if the CLI is on your `PATH`; substitute `./packages/cli/dist/nimbus` (or the downloaded `nimbus-cli-*` binary) if needed.

```bash
nimbus start          # Start the Gateway as a background process
nimbus status         # Verify it's running and list connector health
```

---

### Publishing releases (maintainers)

Releases are automated from **annotated version tags**; assets are uploaded to **GitHub Releases** (no separate download server required).

1. Merge work to the branch you release from (e.g. `main`).
2. Create and push a tag matching `vMAJOR.MINOR.PATCH` (optionally with a prerelease suffix, e.g. `v0.1.0-rc.1`):

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. The **[Release workflow](../.github/workflows/release.yml)** runs on that tag: it compiles the **Gateway** and **CLI** for Linux, macOS (x64), and Windows, then **creates a GitHub Release** and attaches the binaries. Anyone can download them from the Releases page without cloning the repo.
4. **Code signing** (optional, recommended for production): configure the repository secrets referenced in the workflow (macOS certificate + notarization, Windows certificate) and complete the TODO `codesign` / `signtool` steps when ready.

Future milestones may add classic installers (`.msi`, `.dmg`, `.deb`, AppImage) and a hosted update feed; today’s pipeline ships **single-file executables** per platform.

---

### Authenticate a Service

```bash
nimbus connector auth google      # Opens browser for OAuth PKCE flow
nimbus connector auth microsoft
nimbus connector list             # Shows all connectors + sync status
```

### Query

```bash
# Document and communication queries
nimbus ask "Find all PDFs I received by email last month that I haven't opened"
nimbus search --service google_drive --type pdf --since 30d
nimbus sync all

# Developer queries (indexed services only — CI/cloud depth is Q3+ on the roadmap)
nimbus ask "Which of my open PRs mention payment-service?"
nimbus ask "What Linear issues am I assigned this week?"
nimbus ask "Summarize recent threads in #engineering from Slack"
```

### Authenticate developer & collaboration services

```bash
nimbus connector auth github         # GitHub PAT — stored in OS keystore
nimbus connector auth gitlab         # GitLab PAT
nimbus connector auth linear         # Linear API key
nimbus connector auth jira           # Jira API token + site URL
nimbus connector auth notion         # Notion OAuth
nimbus connector auth confluence     # Confluence API token + site URL
nimbus connector list                # Shows all connectors + sync status
```

### Run a Script File

```bash
nimbus run ./weekly-cleanup.yml
```

```yaml
# weekly-cleanup.yml
name: weekly-cleanup
steps:
  - Find all PDF files in Google Drive not opened in 90 days
  - Summarize them by project folder
  - Move the ones from the Zurich project to /Archive/2025
  - Send me an email with the summary
```

```
Script: weekly-cleanup (4 steps)

  Step 1  Find PDFs not opened in 90 days       READ — no approval needed
  Step 2  Summarize by project folder            READ — no approval needed
  Step 3  Move 12 files to /Archive/2025         ⚠ REQUIRES APPROVAL at runtime
  Step 4  Send summary email                     ⚠ REQUIRES APPROVAL at runtime

Proceed? [y/n]: y

▶ Step 1...
▶ Step 2...
⚠  CONSENT REQUIRED — Move 12 files to /Archive/2025. Proceed? [y/n]: y
▶ Step 3...
⚠  CONSENT REQUIRED — Send email to you@company.com. Proceed? [y/n]: y
▶ Step 4...
✅  Done.
```

### Install a Community Extension

```bash
nimbus extension install @community/nimbus-notion
nimbus extension list
```

### Example Agent Sessions

```
$ nimbus ask "Summarize the Zurich project emails this week and draft a status update for my manager"

🔍 Searching Gmail: "Zurich project" (last 7 days)...
   Found 12 emails across 3 threads.

📝 Summary:
   · Kickoff confirmed: Thursday 14:00 CET
   · Design assets requested by Mira Hoffmann — pending
   · Budget approval from procurement — outstanding

📧 Draft ready.
   To: manager@company.com
   Subject: Zurich Project — Week 23 Status

⚠️  CONSENT REQUIRED — This action will send an email.
   Review draft? [y/n]: y
   [draft displayed]
   Send? [y/n]: y

✅  Sent.
```

```
$ nimbus ask "The payment-service alert just fired — what deployed recently and what changed?"

🔍 Querying PagerDuty: active alerts for payment-service...
   Alert: P1 — Error rate 4.2% (threshold: 1%) — fired 8 minutes ago.

🔍 Querying deployment history (last 2 hours)...
   Last deploy: payment-service v2.14.1 — 23 minutes ago
   Triggered by: Jenkins job #4821 → commit a3f9c12 (branch: main)

🔍 Querying GitHub: diff between v2.14.0 and v2.14.1...
   3 files changed — src/billing/retry.ts most significant.
   PR #312 "Increase retry backoff" — merged by @elena 41 minutes ago.

📝 Incident summary ready.

⚠️  CONSENT REQUIRED — This action will post to #incidents Slack channel.
   Post? [y/n]: y

✅  Posted. Suggested next step: rollback to v2.14.0?

⚠️  CONSENT REQUIRED — This action will trigger a Jenkins rollback job.
   Rollback payment-service to v2.14.0? [y/n]: n

   Aborted. No changes made.
```

---

## Cross-Platform Support

| | Windows 10+ | macOS 13+ | Ubuntu 22.04+ |
|---|---|---|---|
| **Gateway IPC** | Named Pipe | Unix Socket | Unix Socket |
| **Secrets** | DPAPI | Keychain | libsecret |
| **Autostart** | Registry | LaunchAgents | systemd user |
| **Notifications** | Win32 Toast | NSUserNotification | libnotify/D-Bus |
| **Config dir** | `%APPDATA%\Nimbus` | `~/Library/…/Nimbus` | `~/.config/nimbus` |
| **Desktop UI** | WebView2 | WKWebView | WebKitGTK |
| **CI runner** | `windows-2022` | `macos-14` | `ubuntu-22.04` |
| **Release** | `.exe` (signed) | `.dmg` (notarized) | `.deb` + AppImage |

Every PR must pass the full test suite on Ubuntu before merge; after merge, pushes run the same suite on all three CI runners. Platform-specific code is isolated behind the `PlatformServices` interface — business logic is never aware of which OS it runs on. See [`.github/BRANCH_PROTECTION.md`](../.github/BRANCH_PROTECTION.md) for required checks.

---

## Security

Nimbus's security model is structural, not promissory.

**Credentials.** OAuth tokens are stored in the OS-native keystore. There is no code path that writes them to disk in plaintext, logs them, or includes them in IPC responses. The structured logger's `redact` config automatically censors any value matching token or secret patterns.

**Consent gate.** Every delete, send, or move action is blocked at the executor by a frozen whitelist. The agent cannot reason around it, configure around it, or inherit an extension that bypasses it. Approved and rejected decisions are written to the audit log before any action is taken.

**Extensions.** Third-party extensions run as child processes. They receive only the credentials for their declared service, via environment variable injection. They cannot enumerate Vault keys, connect to the IPC socket, or read other connectors' tokens. Their manifest hash is verified on every Gateway startup — a tampered extension is disabled before it can run.

**Prompt injection.** File content, email bodies, and API responses are injected into the agent's context as typed `<tool_output>` data blocks. They are treated as untrusted data, not as instructions.

**Audit log.** Every action the agent takes — including every HITL decision — is recorded in a local SQLite table. You can always reconstruct exactly what Nimbus did on your behalf.

**Shared responsibility.** Nimbus's guarantees hold at the process boundary. What sits below it — OS login strength, screen locking, disk encryption, and endpoint protection — is the user's responsibility. The local-first model returns full control to the user; that control carries the corresponding accountability. See [The Security Compact](./mission.md#the-security-compact) for the full boundary definition.

---

## Extensions

The Nimbus extension system is designed so that writing a new connector takes an afternoon, not a sprint.

**For users:** Install any community extension in one command. The Tauri desktop app includes a local Extension Marketplace where you can browse, install, enable, disable, and update extensions without leaving the UI.

**For developers:** The `@nimbus-dev/sdk` package gives you typed scaffolding, a `MockGateway` for unit testing, and a scaffold command that generates a working MCP server in seconds. The hard infrastructure — OAuth, credential storage, sync scheduling, HITL enforcement — is handled by the Gateway. You write the service integration.

```bash
# Build a new extension
nimbus scaffold extension --name notion --output ./nimbus-notion
cd nimbus-notion && bun install && bun run build

# Test it locally
nimbus extension install .
nimbus ask "search notion for quarterly review"

# Publish
npm publish --access public
```

Extensions declare their permissions in `nimbus.extension.json`. Permissions are validated at install time. Write and delete tools require `hitlRequired` declaration — the Gateway enforces HITL automatically for those tool calls, regardless of how the extension implements them.

---

## Testing

Nimbus uses a five-layer pyramid designed for the Bun/Tauri hybrid stack:

**Layer 1 — Unit (`bun test`):** Engine logic, Vault contracts, HITL invariants, manifest validation, platform path resolution. Co-located with source files. Runs in milliseconds.

**Layer 2 — Integration (`bun test` + real SQLite):** Connector sync handlers, index queries, extension loading and process isolation. Each test gets a fresh temp directory and fresh database — fully parallel-safe.

**Layer 3 — E2E CLI (`bun test` + Gateway subprocess):** Full `nimbus ask`, `nimbus search`, `nimbus connector`, and `nimbus extension` command flows against a real Gateway backed by mock MCP servers. Mock servers implement the wire protocol without making real cloud calls.

**Layer 4 — UI Components (Vitest + Testing Library):** React components in the Tauri WebView — consent dialogs, marketplace cards, connector status panels. Vitest is used here because it integrates with Vite's transform pipeline, which Tauri already uses. `bun test` does not support jsdom.

**Layer 5 — E2E Desktop (Playwright + Tauri WebDriver):** Full desktop app flows on all three platforms. Runs on push to `main` and on release tags — not on every PR, due to native runner requirements.

**Security scans:** `bun audit`, `trivy`, and CodeQL on PRs and scheduled runs; Dependabot opens update PRs. HIGH/CRITICAL issues from configured tools block merges when checks are required.

---

## Roadmap

> See [`roadmap.md`](./roadmap.md) for the full roadmap — acceptance criteria, inter-phase dependencies, and the reasoning behind sequencing decisions.

Nimbus uses **phases**, not calendar quarters. A phase completes when its acceptance criteria pass, not at a date boundary. Phases may overlap when deliverables are independent.

### Phase 1 — Foundation ✅

**Goal:** Make the Gateway real and the security model provable.

- Bun workspace monorepo + CI (`pr-quality` on PRs; 3-platform matrix on push)
- Nimbus Gateway process with JSON-RPC 2.0 IPC
- Platform Abstraction Layer — `PlatformServices` interface + all three implementations
- Secure Vault — DPAPI, Keychain, libsecret
- Local Filesystem MCP connector + SQLite metadata schema
- HITL executor — frozen whitelist, structural enforcement, audit log
- `nimbus` CLI: `start`, `stop`, `status`, `ask`, `search`, `vault`
- Full unit + integration test suite gated in CI; `bun audit` + `trivy` security scanning

**Milestone:** `nimbus ask "find all markdown files modified this week"` executes end-to-end on all three platforms, with HITL firing correctly for any destructive follow-up.

---

### Phase 2 — The Bridge ✅

**Goal:** Connect every surface a developer works across and unify them in the local index.

**15 first-party MCP connectors** — Google Drive, Gmail, Google Photos, OneDrive, Outlook, Microsoft Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord (opt-in)

**Infrastructure** — delta sync scheduler, unified `item`/`person` schema (v5), cross-service people graph, context ranker, `nimbus connector` CLI, E2E test suite, Linux headless installers

**Milestone:** `nimbus ask "find everything I've touched across Drive, GitHub, Slack, and Linear this sprint"` returns merged, ranked results in under 200ms. Cross-service identity resolves without a network call.

---

### Phase 3 — Intelligence

**Goal:** Make Nimbus semantically aware and proactively useful. Extend into CI/CD, cloud infrastructure, and agentic automation.

**Status:** Active.

**Semantic layer** — embedding pipeline (`sqlite-vec`, `@xenova/transformers`), hybrid BM25 + vector search, RAG conversational memory

**Extension ecosystem** — Extension Registry v1, `@nimbus-dev/sdk`, `nimbus scaffold extension`, extension sandbox

**CI/CD & infrastructure connectors** — Jenkins, GitHub Actions, CircleCI, GitLab CI, AWS, Azure, GCP, IaC (Terraform/CloudFormation/Pulumi), Kubernetes, Datadog, Grafana, Sentry, PagerDuty, New Relic

**Workflow automation** — workflow pipelines (YAML, HITL-gated), watcher system (event-driven + scheduled), proactive anomaly detection

**Knowledge graph** — local relationship graph, Filesystem connector v2 (git-aware, semantic code search, dependency graph)

**Interaction** — Session CLI (`nimbus` with no args), script files (`nimbus run`), DevOps agent, Research agent

**Milestone:** `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, GitHub PR, Jenkins run, CloudWatch spike, and Slack thread — from the local index — in a single response.

---

### Phase 4 — Presence

**Goal:** Give Nimbus a face, a local AI backbone requiring no cloud API key, and the foundations for a public `v0.1.0` release.

**Desktop application** — Tauri 2.0 (Windows/macOS/Linux): system tray, dashboard, HITL consent dialogs, Extension Marketplace panel, watcher UI, pipeline editor, settings

**Local LLM & multi-agent** — Ollama / llama.cpp, per-task model routing, fully air-gapped operation, coordinator + parallel sub-agent orchestration (all HITL-gated)

**Terminal & voice** — Rich TUI (Ink, SSH-safe), local STT (Whisper.cpp), local TTS, wake word (opt-in)

**Data sovereignty** — `nimbus data export/import`, GDPR deletion, BLAKE3-chained tamper-evident audit log

**Release** — signed/notarized binaries (Gatekeeper, Authenticode, GPG), auto-update via self-hosted server, Plugin API v1

**Milestone:** `v0.1.0` — signed installers for all platforms. Fully local Ollama query in under 30 seconds. Five community extensions in the Marketplace.

---

### Phase 5 — The Extended Surface

**Goal:** Fill every connector gap so wherever a knowledge worker or developer spends time, their data is in the index.

**Browser & reading** — Pocket, Readwise, Raindrop, browser history (local extension, no cloud relay), web clipper

**Email via IMAP/SMTP** — generic IMAP connector (Fastmail, ProtonMail, self-hosted), Fastmail JMAP native, ProtonMail Bridge

**Finance & expenses** — Expensify, Ramp, Mercury, Stripe

**CRM & sales** — HubSpot, Salesforce, Pipedrive

**HR & recruiting** — Greenhouse, Lever, Workday

**Design & creative** — Figma (files, comments, FigJam), Miro, Canva

**Extension Marketplace v2** — ratings, verified publisher badges, paid extensions with revenue sharing, auto-update, dependency resolution

---

### Phase 6 — Team

**Goal:** Make Nimbus a collaborative layer for engineering teams — shared intelligence without surrendering local sovereignty.

**Shared infrastructure** — Nimbus-to-Nimbus federation (E2EE, no relay), Team Vault (shared credentials, RBAC), shared index namespaces, LAN peer discovery

**Identity & access** — SSO/OIDC/SAML, SCIM provisioning, role-based access control, multi-user HITL (approval delegation)

**Shared workflows & policy** — team-owned workflow pipelines, org-level `nimbus.policy.toml` (connector allowlists, retention, HITL overrides)

**Admin & observability** — local admin console, team audit log (merged view), org-level GDPR purge

---

### Phase 7 — The Autonomous Agent

**Goal:** Transform Nimbus from a reactive tool into a proactive collaborator that watches, learns, and acts — always within the bounds of what you have authorised.

**Standing approvals** — pre-authorise recurring write patterns; approval learning; `nimbus approve` CLI; full audit trail per standing rule

**Schedule-driven tasks** — unattended scheduled workflows, morning briefing, deadline tracking

**Incident correlation engine** — automatic incident assembly on alert fire, incident timeline, HITL-gated remediation proposals

**Agent memory & personalization** — long-term episodic memory, personalization layer, decision pattern recognition, standing rule suggestions

**Local fine-tuning** — LoRA adapter training on user's own data (writing style, code patterns); runs on local NPU/GPU; no data leaves the machine

**Infrastructure-as-Agent** — autonomous drift detection, remediation proposals, cost anomaly alerts, runbook automation

---

### Phase 8 — Sovereign Mesh

**Goal:** Extend Nimbus across the user's own devices, between trusted people, and into the physical world — with no relay server or trusted third party.

**Cross-device sync** — P2P encrypted index sync, vector-clock conflict resolution, selective sync per device, conflict resolution UI

**Mobile companion** — iOS + Android apps; E2EE LAN/WireGuard; read queries, HITL approval queue, watcher notifications; cryptographically signed mobile HITL

**Physical sovereignty** — YubiKey/Ledger hardware vault, air-gapped secret management, Decentralized Identifiers (DIDs)

**Digital Executor** — dead man's switch; Shamir's Secret Sharing across named recipients; tamper-evident handover audit trail

---

### Phase 9 — Enterprise

**Goal:** Institutional-grade deployment for security-conscious organisations. Tied to the commercial license tier.

**Deployment** — official Docker image, Helm chart, air-gapped bundle, HA Gateway clustering, managed update channel

**Policy & compliance** — policy-as-code (`nimbus.policy.toml`), audit log shipping (SIEM/S3/GCS), `nimbus compliance check` JSON report, data residency controls, formal security audit + bug bounty

**Identity & governance** — enterprise SSO (SAML 2.0 + OIDC), SCIM 2.0, privileged access management

**Admin console** — org-wide dashboard, policy editor, credential rotation assistant

**SLA & support** — priority support tier, deployment runbooks, DPA and legal templates

---

## Project Structure

```
nimbus/
├── packages/
│   ├── gateway/              # Core headless Gateway (Bun)
│   │   └── src/
│   │       ├── platform/     # PAL: win32, darwin, linux
│   │       ├── engine/       # Mastra agent, router, planner, HITL executor
│   │       ├── vault/        # DPAPI, Keychain, libsecret
│   │       ├── index/        # SQLite schema + migrations
│   │       ├── connectors/   # Connector registry + sync scheduler
│   │       ├── extensions/   # Extension Registry, manifest validator
│   │       └── ipc/          # JSON-RPC 2.0 server
│   │
│   ├── cli/                  # nimbus CLI
│   ├── ui/                   # Tauri 2.0 desktop app (Q4)
│   │   └── src/
│   │       ├── components/   # ConsentDialog, ExtensionMarketplace, ...
│   │       └── pages/        # Dashboard, Search, Marketplace, Settings
│   │
│   ├── mcp-connectors/       # First-party MCP servers (workspace packages)
│   │   ├── google-drive/
│   │   ├── gmail/
│   │   ├── google-photos/
│   │   ├── onedrive/
│   │   ├── outlook/
│   │   ├── github/
│   │   ├── gitlab/
│   │   ├── bitbucket/
│   │   ├── slack/
│   │   ├── teams/
│   │   ├── linear/
│   │   ├── jira/
│   │   ├── notion/
│   │   └── confluence/
│   │
│   └── sdk/                  # @nimbus-dev/sdk (published to npm)
│
├── architecture.md           # subsystem design (repo root)
├── docs/
│   ├── README.md             # this file (repo overview on GitHub)
│   ├── mission.md
│   ├── SECURITY.md
│   ├── roadmap.md
│   └── sonar-local.md
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # pr-quality (PR) + 3-platform matrix (push)
│   │   ├── security.yml      # bun audit + trivy (PR + nightly)
│   │   ├── codeql.yml        # CodeQL JS/TS
│   │   └── release.yml       # tagged releases → GitHub Releases (Gateway + CLI binaries)
│   ├── dependabot.yml
│   └── BRANCH_PROTECTION.md  # how to require checks in GitHub settings
│
├── scripts/                  # Bun entrypoints + lib/; OS wrappers in linux/*.sh, windows/*.ps1
├── bunfig.toml
└── package.json              # Bun workspace root
```

---

## Contributing

Nimbus is in active early development. Architecture is stabilizing; not all interfaces are frozen.

Before submitting a PR:

1. Read [`architecture.md`](../architecture.md) — understand the four subsystems and their contracts.
2. Read [`mission.md`](./mission.md) — understand what Nimbus is and what it is not.
3. Check issues tagged `good-first-issue`.
4. Open a discussion before large PRs.

**The non-negotiables.** Any contribution that violates these will not be merged:

- Local-first: no credentials or user data leaving the machine without explicit user action
- HITL is structural: consent gate lives in the executor, not the prompt
- No plaintext credentials: Vault only
- Platform equality: all three platforms, always
- MCP as the connector standard: no direct API calls from the Engine
- License integrity: contributions to core packages must be compatible with AGPL-3.0

---

## License

**AGPL-3.0** — see [LICENSE](../LICENSE).

The license choice is deliberate and consistent with the project's mission. MIT would allow any vendor to take the Gateway, close it up, strip the privacy guarantees, and ship a hosted "Nimbus Cloud" service — extracting value from a project that exists precisely to resist that pattern.

AGPL-3.0 closes the network service loophole: anyone who runs Nimbus as a service must publish their modifications under the same terms. This applies to the Gateway and all first-party packages. The `@nimbus-dev/sdk` extension SDK is licensed separately under MIT so that extension authors are not burdened by copyleft obligations.

If you want to embed Nimbus in a commercial product without AGPL obligations, a commercial license is available — contact the maintainers.

---

<div align="center">

*Built for the person who wants to own their digital life, not rent it.*

**[Mission](./mission.md) · [Architecture](../architecture.md) · [Roadmap](./roadmap.md) · [Changelog](../CHANGELOG.md)**

</div>
