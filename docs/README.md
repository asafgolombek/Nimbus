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

Nimbus is an open-source, local-first AI agent framework that bridges the gap between your machine and every service you work across. A headless **Nimbus Gateway** runs as a background process, maintaining a private local index of your data across cloud storage (Google Drive, OneDrive), communication (Gmail, Outlook), source control and CI/CD (GitHub, GitLab, Bitbucket, Jenkins, GitHub Actions), cloud infrastructure (AWS, Azure, GCP), monitoring (Datadog, Grafana, PagerDuty), and your local filesystem. The Nimbus agent — powered by [Mastra](https://mastra.ai) and Claude — reasons over this unified index and executes multi-step workflows on your behalf. Every destructive or outgoing action is gated by an explicit Human-in-the-Loop consent step.

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

Your pull request, its CI pipeline, its deployment, and the monitoring alert it triggered all live in different systems. Nimbus indexes them all locally and lets you query across them in plain English: *"Which of my open PRs have failing CI?"*, *"What changed between the image running in prod and the one in staging?"*, *"Which Lambda functions started erroring after yesterday's deploy?"*

Write operations — merging a PR, triggering a Jenkins build, applying a Terraform plan, acknowledging a PagerDuty alert — go through the same consent-gated executor as every other Nimbus action. The agent proposes; you approve. No silent infrastructure mutations.

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

# Developer and DevOps queries
nimbus ask "Which of my open PRs have failing CI?"
nimbus ask "What changed between the image running in prod and the one in staging?"
nimbus ask "Show me all Jenkins jobs that failed after yesterday's deploy"
nimbus ask "Which Lambda functions started erroring in the last hour?"
```

### Authenticate DevOps Services

```bash
nimbus connector auth github         # GitHub PAT via OAuth — stored in OS keystore
nimbus connector auth gitlab         # GitLab PAT
nimbus connector auth aws            # AWS credentials — stored in OS keystore, never in ~/.aws in plaintext
nimbus connector list                # Shows all connectors + sync status
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

## 2026 Roadmap

> See [`roadmap.md`](./roadmap.md) for the full detailed roadmap including milestones, dependencies, and acceptance criteria.

**Current quarter (Q2 2026) — detailed implementation plan:** [`q2-2026-plan.md`](./q2-2026-plan.md)

### Q1 2026 — Foundation ✅

**Goal:** Make the Gateway real and the security model provable.

- Bun workspace monorepo + CI (`pr-quality` on PRs; 3-platform matrix on push)
- Nimbus Gateway process with JSON-RPC 2.0 IPC
- Platform Abstraction Layer — `PlatformServices` interface + all three implementations
- Secure Vault — DPAPI, Keychain, libsecret
- Local Filesystem MCP connector + SQLite metadata schema
- HITL executor — frozen whitelist, structural enforcement, audit log
- `nimbus` CLI: `start`, `stop`, `status`, `ask`, `search`, `vault`
- Full unit + integration test suite gated in CI
- `bun audit` + `trivy` security scanning in CI

**Milestone:** `nimbus ask "find all markdown files modified this week"` executes end-to-end on all three platforms, with HITL firing correctly for any destructive follow-up.

---

### Q2 2026 — The Bridge

**Goal:** Connect the cloud, developer tooling, and the communication + collaboration surface every engineer lives in. Unify the index.

**Cloud storage & email**
- Google Drive, Gmail, Google Photos MCP connectors (OAuth PKCE)
- OneDrive, Outlook MCP connectors (Microsoft Graph, first-party)

**Source control & code review**
- **GitHub, GitLab, Bitbucket MCP connectors** — repositories, pull requests, issues, CI status

**Communication**
- **Slack MCP connector** — messages, channels, threads, DMs, search
- **Microsoft Teams MCP connector** — chats, channels, meetings
- **Discord MCP connector** (opt-in) — servers, channels, threads

**Project & issue tracking**
- **Linear MCP connector** — issues, projects, cycles, roadmap items
- **Jira MCP connector** — issues, sprints, boards, epics, comments

**Knowledge bases**
- **Notion MCP connector** — pages, databases, comments, linked mentions
- **Confluence MCP connector** — spaces, pages, blog posts, inline comments

**Infrastructure**
- Delta sync scheduler — configurable per-connector intervals
- Unified metadata index across all services (documents, emails, messages, PRs, issues, pages)
- Cross-service people graph — links email contacts to PR authors to Slack handles to Linear assignees
- `nimbus connector` CLI: `auth`, `list`, `sync`, `pause`, `status`
- E2E CLI test suite with mock MCP servers

**Milestone:** `nimbus ask "find everything I've touched across Drive, GitHub, Slack, and Linear this sprint"` returns merged, ranked results from all services in under 200ms using the local index. `nimbus ask "who is the most active reviewer on the payment-service repo and what are they working on in Linear?"` resolves a cross-service identity link without a network call.

---

### Q3 2026 — Intelligence

**Goal:** Make Nimbus proactive and semantically aware. Extend into CI/CD, cloud infrastructure, and agentic automation.

**Semantic layer**
- Embedding pipeline: chunk → embed → `sqlite-vec` (`@xenova/transformers`, local)
- Hybrid search: BM25 keyword + vector reranking
- RAG-based conversational memory across sessions

**Extension ecosystem**
- **Extension Registry v1** — `@nimbus-dev/sdk`, manifest schema, `nimbus scaffold`
- `nimbus extension install/list/disable/remove` CLI commands

**CI/CD & infrastructure connectors**
- **CI/CD connectors** — Jenkins, GitHub Actions, CircleCI, GitLab CI: pipeline runs, job status, artefacts, failure summaries
- **Cloud infrastructure connectors** — AWS (CloudWatch, ECS, Lambda, EC2, S3, Cost Explorer), Azure (Monitor, App Service, AKS), GCP (Cloud Run, GKE, Cloud Monitoring)
- **IaC awareness** — Terraform state, CloudFormation stacks, Pulumi outputs: indexed resource state + drift detection
- **IaC write operations** — `terraform plan` → HITL review → `apply`; rollback tracking via audit log
- **Kubernetes connector** — pod status, events, recent restarts, rollout history (kubectl-compatible clusters)
- **Monitoring & incident connectors** — Datadog, Grafana, Sentry, PagerDuty, New Relic: alert indexing, cross-service incident correlation

**Workflow automation**
- **Workflow pipelines** — named, repeatable multi-step workflows defined in natural language; versioned as files; shareable; all write steps HITL-gated
- **Watcher system** — ambient monitors that fire on conditions:
  - "Alert me when I receive an email matching this pattern"
  - "Summarize new files added to this Drive folder"
  - "Notify me if the Zurich project folder hasn't changed in 3 days"
  - "Alert me when a production deployment fails CI"
  - "Summarize all failing Jenkins jobs every morning at 09:00"
- `nimbus watch` CLI: `create`, `list`, `pause`, `delete`
- `nimbus workflow` CLI: `run`, `list`, `edit`, `delete`

**Knowledge graph & filesystem intelligence**
- **Local relationship graph** — SQLite-backed knowledge graph linking people → projects → documents → incidents → PRs across all indexed services; queryable in natural language
- **Filesystem connector v2** — git-aware: commit history, blame, diff summarization; semantic code search; dependency graph indexing (imports, packages)

**Agent specialization**
- **DevOps agent** — domain-tuned for CI/CD, infrastructure, and incident correlation; pre-built tool set, memory scope
- **Research agent** — optimized for document synthesis and cross-service knowledge retrieval

**Milestone:** `nimbus ask "what caused the payment-service incident last night?"` correlates the PagerDuty alert, the GitHub PR, the Jenkins run, the CloudWatch error spike, and the Slack incident thread into a single local answer — without leaving the terminal. A community developer publishes a working Nimbus extension in under a day using the SDK scaffold.

---

### Q4 2026 — Presence

**Goal:** Give Nimbus a face, an ecosystem, and the option to run without any cloud AI dependency.

**Desktop application**
- **Tauri 2.0 desktop application** — Windows + macOS + Linux
  - System tray with quick-query popup
  - Dashboard: connector health, index stats, recent actions, sync log
  - **Extension Marketplace panel** — browse, install, update, manage community extensions; verified publisher badges; ratings
  - HITL consent dialogs with full action preview and diff view
  - Watcher management UI
  - Workflow pipeline editor
  - Settings: model config, sync intervals, Vault management, audit log viewer

**Local LLM & multi-agent**
- **Local LLM support** — Ollama / llama.cpp integration; model selection per-task (fast local for intent routing, remote for complex reasoning); no API key required for basic use; fully air-gapped operation possible
- **Multi-agent orchestration** — Nimbus decomposes complex tasks into parallel sub-agents; coordinator agent aggregates results; all write operations remain HITL-gated regardless of which sub-agent initiates them

**Terminal power users**
- **Rich TUI** — full keyboard-driven terminal UI (Ink) with panes: query, results, connector health, active watchers; no mouse required; works over SSH

**Voice interface**
- **Voice interface** — local Whisper-based speech-to-text in the desktop app; voice queries + spoken result summaries via local TTS; no audio leaves the machine

**Data sovereignty**
- **Data portability** — full export: SQLite snapshot + vault credential manifest (re-encrypted for import); full import on new machine in one command; GDPR-compatible deletion with audit trail; tamper-evident audit log signing

**Release infrastructure**
- Signed + notarized release binaries for all platforms
- Auto-update via self-hosted `tauri-update-server`
- Plugin API v1 — third-party connector registration stable API
- Optional encrypted LAN remote access (E2E encrypted, no relay server)

**Milestone:** First tagged release `v0.1.0` — signed installers for Windows, macOS, and Linux distributed via GitHub Releases. `nimbus ask "summarize everything that happened across my projects this week"` runs fully locally via Ollama with no API key. Five community extensions available in the marketplace at launch.

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
│   ├── mcp-connectors/       # First-party MCP servers
│   │   ├── onedrive/
│   │   ├── outlook/
│   │   └── google-photos/
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
