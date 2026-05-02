<div align="center">

# ☁️ Nimbus

### On-Call Intelligence for DevOps, SecDevOps, and Platform Engineering Teams.

*Cross-service incident context in under 100ms. Consent-gated automation. Your credentials never leave the machine.*

[![Built with Bun](https://img.shields.io/badge/runtime-Bun_1.2+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript_6.x-3178C6?logo=typescript)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/platforms-Windows_%7C_macOS_%7C_Linux-blue)]()
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](../LICENSE)
[![Status: Phase 4](https://img.shields.io/badge/status-Phase_4_Active-blue)]()

</div>

---

Nimbus is an open-source, local-first AI agent built for engineers who run systems in production. A headless **Nimbus Gateway** runs on your machine, maintains a private SQLite index across your entire developer toolchain — source control, CI/CD, cloud infrastructure, monitoring, and incident management — and executes multi-step tasks on your behalf. Every write, send, or delete requires your explicit approval before it runs.

**Your credentials never leave your machine. There is no Nimbus server.**

---

## What It Does

```bash
# Incident response — answered from the local index, no API calls, under 100ms
nimbus ask "The payment-service alert just fired — what changed in the last 2 hours?"

# Release readiness — cross-service without tab-switching
nimbus ask "Which of my open PRs have failing CI and are blocking the release branch?"

# SecDevOps — correlate security signals with your codebase
nimbus ask "Which repos have critical Dependabot alerts with open PRs touching the affected packages?"

# Infrastructure — query state across providers
nimbus ask "What Terraform drift has been detected since last week's deployment?"

# Data lineage — answered from the local index, no warehouse query
nimbus ask "The Q1 revenue dashboard shows zeroes — which upstream model broke?"

# Consent-gated automation — full plan preview before anything executes
nimbus run ./incident-response.yml
```

**Example session:**

```
$ nimbus ask "The payment-service alert just fired — what changed?"

🔍 PagerDuty: P1 — Error rate 4.2% — fired 8 minutes ago
🔍 Last deploy: payment-service v2.14.1 — 23 minutes ago
🔍 GitHub diff v2.14.0 → v2.14.1: 3 files — src/billing/retry.ts most significant
   PR #312 "Increase retry backoff" — merged by @elena 41 minutes ago

⚠  CONSENT REQUIRED — Post incident summary to #incidents?
   Post? [y/n]: y  ✅ Posted.

Suggested next step: rollback to v2.14.0?
⚠  CONSENT REQUIRED — Trigger Jenkins rollback job.
   Rollback? [y/n]: n  Aborted. No changes made.
```

**SecDevOps example:**

```
$ nimbus ask "Critical CVE dropped for lodash — what's our exposure?"

🔍 Scanning local index: 47 repos indexed, 12 have lodash as a direct dependency
🔍 Active PRs touching lodash: 3 open PRs across payment-service, auth-gateway, api-proxy
🔍 Sentry: 2 production errors last 24h in lodash code paths (payment-service)
🔍 Jira: No active tickets for this CVE yet

Suggested next step: Create Jira tickets for affected repos?
⚠  CONSENT REQUIRED — Create 3 Jira tickets and assign to component owners.
   Proceed? [y/n]: y  ✅ Created PLAT-1847, PLAT-1848, PLAT-1849.
```

**Data lineage example:**

```
$ nimbus ask "The Q1 revenue dashboard shows zeroes — which upstream model broke?"

🔍 Tableau: dashboard "Q1 Revenue" — last refresh failed 12 minutes ago
🔍 Upstream Looker view: revenue_daily → dbt model revenue_daily_agg
🔍 dbt Cloud: revenue_daily_agg — last run failed 14 minutes ago
🔍 Airflow: DAG daily_revenue_etl — task load_fact_orders failed with SQL error
🔍 GitHub PR #842 "Rename order_amount → gross_amount" — merged by @priya 28 minutes ago
   No downstream dbt model updated to match the rename.

Suggested next step: Revert PR #842 and rerun the DAG?
⚠  CONSENT REQUIRED — Revert PR #842 and trigger Airflow DAG rerun.
   Proceed? [y/n]: n  Aborted. No changes made.
```

---

## Who It's For

Nimbus is built for engineers and operators who run systems in production. If your on-call rotation spans five monitoring tools and three cloud consoles, Nimbus is the intelligence layer that collapses that context into a single query.

| Role | What Nimbus gives you |
|---|---|
| **On-call / SRE** | Instant incident context — last deploy, triggering commit, CI result, Slack thread — in one query, without seven browser tabs |
| **Platform Engineer** | Drift detection, multi-cloud infra state, deployment correlation, consent-gated IaC apply and rollback |
| **Security Engineer** | Alert-to-commit tracing, CVE-to-PR correlation, full audit log for every agent action, compliance posture queries |
| **Senior Developer** | Cross-repo PR intelligence, release readiness checks, pipeline context, local-only credential storage |
| **Analytics Engineer / Data Scientist** | Cross-stack lineage from dashboard to dbt model to warehouse table to orchestration DAG — one local query instead of five consoles; metadata-only ingestion keeps row data on the warehouse |

This is not a tool for everyone. There is no managed cloud service, no Nimbus account, and no relay server. If that's what you need, look elsewhere.

---

## Why Engineers Choose Nimbus

### Fast — Most Queries Never Hit the Network

Nimbus maintains a local SQLite metadata index. Searching across 50,000 indexed items across five services takes under 100ms — faster than opening a new browser tab.

| Operation | Nimbus (local index) | Typical SaaS |
|---|---|---|
| Search across all services | ~20–80ms | 1,500–4,000ms |
| List recent files from 3 services | ~5ms | 3× API round trips |
| Semantic recall (embeddings) | ~50–200ms | Remote embed + search |
| Gateway cold start | ~80ms | Always-on cloud |

*Measured on a mid-range laptop; 50k item index across 5 connected services.*

### Secure by Architecture

- **Credentials** are stored in your OS-native keystore (Windows DPAPI, macOS Keychain, Linux Secret Service). There is no code path that writes them to disk, logs, or IPC responses.
- **The HITL consent gate** is implemented in the executor, not the prompt. A model that generates a plan to skip confirmation produces a plan that simply does not execute.
- **Extensions** run in sandboxed child processes. They receive only credentials for their declared service and cannot enumerate Vault keys or access other connectors.
- **Prompt injection** is mitigated by injecting file content and API responses as typed `<tool_output>` data blocks, never as instructions.

### True Cross-Platform

Windows, macOS, and Linux are equally supported. Every PR runs a full gate on Ubuntu (typecheck, lint, build, tests). Pushes to `main` run the full three-platform matrix in parallel. Platform-specific code (IPC, secrets, autostart, notifications) lives behind a typed `PlatformServices` abstraction — business logic never knows which OS it's on.

### Extensible

Third-party connectors ship as npm packages. Install in one command; the agent gains a new capability immediately. A local Extension Marketplace in the Tauri app makes community connectors discoverable without leaving the UI.

---

## Connectors

Every tool your on-call rotation depends on, unified in one local index. Cross-service queries are answered without an API call — the data is already there.

**Phase 1–2 (shipped):** Local Filesystem, Google Drive, Gmail, Google Photos, OneDrive, Outlook, Microsoft Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord (opt-in)

**Phase 3 (shipped):** Jenkins, GitHub Actions, CircleCI, GitLab CI, AWS, Azure, GCP, Kubernetes, Terraform/Pulumi/CloudFormation, Datadog, Grafana, Sentry, PagerDuty, New Relic

**Phase 5 (planned):** Databricks, Apache Airflow, Prefect, Dagster, Metabase, Superset, Kibana / Elasticsearch, CloudWatch Logs, GCP Cloud Logging, BigQuery, Athena, dbt Cloud, MLflow, SageMaker, Vertex AI, Great Expectations, and local data-file profiling (Parquet / CSV / JSONL schema — header / footer / line counts only, never cell values)

**Phase 6 (planned, Team tier):** Snowflake, Tableau, Looker, PowerBI, Monte Carlo, Bigeye (SSO-gated warehouse, BI, and data-quality connectors; depends on Team Vault)

See the [roadmap](./roadmap.md) for depth and remaining gaps per connector.

### Phase 3.5 — shipped

Phase 3.5 (Observability & Developer Experience) is ✅ complete. Highlights:

- **`nimbus doctor`** — environment health checks with actionable remediation
- **`nimbus diag`** — full diagnostic snapshot; `slow-queries` subcommand
- **`nimbus query`** — structured index queries with `--sql` guard and `--json` output
- **`nimbus db verify / repair / snapshot / restore / prune`** — data integrity and recovery
- **`nimbus config` / `nimbus profile`** — named config profiles and env-var overrides
- **`nimbus telemetry show / disable`** — opt-in aggregate-only telemetry
- **`nimbus serve`** — read-only local HTTP API on `localhost`
- **`nimbus connector history <name>`** — per-connector health history
- **`@nimbus-dev/client`** — typed IPC wrapper with `MockClient` for extensions and scripts
- **Starlight docs site** — `packages/docs/`; `bun run docs:build`

See [`docs/roadmap.md`](./roadmap.md) for the full Phase 3.5 delivery list and [`docs/cli-reference.md`](./cli-reference.md) for the complete CLI command reference.

---

## Quick Start

### Prerequisites

#### Required on every platform (source build)

- **[Bun v1.2+](https://bun.sh/docs/installation)** — runtime, package manager, test runner. Verify with `bun --version`.
- **Git** — for cloning the repo and the build's git-info embedding.
- **A C++ build toolchain** — needed for the rare native dep that has no prebuilt binary for your platform.
  - Windows: [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) and Visual Studio Build Tools (Desktop development with C++ workload).
  - macOS: `xcode-select --install`.
  - Linux: `build-essential` (Debian/Ubuntu) or `Development Tools` (Fedora/Arch).

#### Required only for the Tauri 2.0 desktop UI (`packages/ui`)

The headless Gateway and CLI build without these. Skip if you only want `nimbus` in the terminal.

- **[Rust toolchain](https://www.rust-lang.org/tools/install)** — install via `rustup`; Tauri needs `cargo` and a stable `rustc` (≥ 1.78 recommended).
- **Platform WebView dependencies:**
  - **Windows 10+** — WebView2 Runtime (preinstalled on Windows 11; install [Evergreen Bootstrapper](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) on older Windows 10 builds).
  - **macOS 13+** — Xcode Command Line Tools (already installed if you ran `xcode-select --install` above).
  - **Linux (Ubuntu/Debian)** — `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`.
  - Other distros: see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/).

#### Required at runtime on Linux only

- **`libsecret`** — backs the Vault on Linux (Windows uses DPAPI; macOS uses Keychain — both built-in).
  - Debian/Ubuntu: `sudo apt install libsecret-1-0 libsecret-tools` (the `-tools` package provides `secret-tool`, which `nimbus doctor` checks for).
  - Fedora/Arch: `sudo dnf install libsecret` / `sudo pacman -S libsecret`.
  - You also need a running Secret Service implementation — `gnome-keyring`, KWallet (kwallet5/6), or `keepassxc` with Secret Service enabled. On a headless Linux server, use `gnome-keyring-daemon --unlock` in your session script.

#### Native dependencies installed by `bun install`

The Gateway's local embedder uses **`@xenova/transformers`**, which depends on **`sharp`** and a platform binary such as **`@img/sharp-win32-x64`**. These are pulled in automatically by `bun install` — you do not install them system-wide. If Sharp fails to download or build, remove `node_modules` and re-run `bun install` with install scripts enabled.

#### Pre-built binaries (no Bun required on the target machine)

Gateway binaries built with `bun build --compile` bundle JavaScript into a single file. Sharp's native `.node` file may not load inside that layout on some platforms. If `nimbus-gateway` exits with a Sharp error, run the Gateway **from source** with `bun` after `bun install` (for example `cd packages/gateway && bun run dev`). Linux `.deb` / tarball artifacts from CI are normal compiled binaries — end users do not run `npm install sharp`; if a packaged binary ever fails the same way, the fix is in build/packaging, not an extra OS package on the user's machine.

#### Optional — only needed if you enable the corresponding feature

| Feature | Requirement | How to install |
|---|---|---|
| **Local LLM (Ollama)** | [Ollama](https://ollama.com/download) running on `localhost:11434`, plus at least one pulled model (e.g. `ollama pull llama3.1:8b`) | Override the host with `OLLAMA_HOST` or `[llm.ollama_host]` in `nimbus.toml`. |
| **Local LLM (llama.cpp)** | A `llama-server` HTTP endpoint reachable from the Gateway | Configure under `[llm.llamacpp]` — see `docs/architecture.md`. |
| **Cloud LLM (Anthropic)** | Anthropic API key | `nimbus config set llm.provider anthropic`; export `ANTHROPIC_API_KEY=…` (or set `[llm].api_key` in `nimbus.toml`). |
| **Cloud LLM (OpenAI)** | OpenAI API key | `nimbus config set llm.provider openai`; export `OPENAI_API_KEY=…`. |
| **Voice — STT (`nimbus voice listen`)** | `whisper-cli` (whisper.cpp) on PATH, plus `ffmpeg` for audio capture | Build whisper.cpp from source or install via `brew install whisper-cpp`; `ffmpeg` via your distro/`brew`. Set `voice.whisper_path` if not on PATH. |
| **Voice — TTS** | macOS: `say` (built-in). Windows: PowerShell SAPI (built-in). Linux: `espeak-ng` (preferred) or `spd-say` | `sudo apt install espeak-ng` / `brew install espeak-ng`. |
| **Wake-word loop** | Same as STT, plus a microphone configured at the OS level | Verify with `nimbus doctor` — voice section appears when `[voice].enabled = true`. |
| **GPU acceleration for embeddings or LLM** | Provider-specific (CUDA, ROCm, Metal). Nimbus serializes GPU access via `GpuArbiter` | Configure your provider's GPU support; Nimbus does not require any extra config. |

Once installed, run **`nimbus doctor`** — it checks every prerequisite above and prints actionable remediation for anything missing.

### Option A — Pre-built Binaries

Download from [GitHub Releases](https://github.com/asafgolombek/Nimbus/releases):

| Asset | Purpose |
|---|---|
| `nimbus-gateway-{os}-x64` | Headless Gateway process |
| `nimbus-cli-{os}-x64` | `nimbus` terminal command |

Linux/macOS: `chmod +x nimbus-gateway-* nimbus-cli-*`. Optionally rename the CLI to `nimbus` and add to `PATH`.

### Option B — Build from Source

```bash
git clone https://github.com/asafgolombek/Nimbus.git
cd Nimbus
bun install          # NOT "bun run install" — that looks for a script and fails
                     # Installs sharp + platform @img/sharp-* for embeddings (via @xenova/transformers)
bun run build
```

Built CLI location:

| OS | Path |
|---|---|
| Windows | `packages\cli\dist\nimbus.exe` |
| macOS / Linux | `./packages/cli/dist/nimbus` |

Add `packages/cli/dist` to your `PATH` or call with a full path.

### First-Run Configuration

The first time the Gateway starts it creates a default `nimbus.toml` in the platform config directory and an empty SQLite index in the data directory:

| Platform | Config (`nimbus.toml`) | Data (`index.db`, `audit.db`, `backups/`, `logs/`) |
|---|---|---|
| Windows | `%APPDATA%\Nimbus\nimbus.toml` | `%LOCALAPPDATA%\Nimbus\data` |
| macOS | `~/Library/Application Support/Nimbus/nimbus.toml` | `~/Library/Application Support/Nimbus/data` |
| Linux | `~/.config/nimbus/nimbus.toml` | `~/.local/share/nimbus` |

Override either with `NIMBUS_CONFIG_DIR` / `NIMBUS_DATA_DIR` if you need separate trees per profile or per environment. All keys can be overridden with `NIMBUS_`-prefixed env vars (e.g. `NIMBUS_LLM_PROVIDER`, `NIMBUS_SYNC_INTERVAL_SECONDS`).

Pick an LLM provider before running your first `nimbus ask` — without one, the agent has no reasoning surface:

```bash
# Cloud (default — fastest path to a working install)
export ANTHROPIC_API_KEY=sk-ant-…
nimbus config set llm.provider anthropic
nimbus config set llm.model claude-sonnet-4-6

# OR fully local (no network calls; requires Ollama running)
ollama pull llama3.1:8b
nimbus config set llm.provider ollama
nimbus config set llm.model llama3.1:8b
```

See [`docs/cli-reference.md`](./cli-reference.md#configuration-file) for the full `nimbus.toml` schema.

### Start the Gateway

```bash
nimbus start     # Start Gateway as a background process
nimbus status    # Verify it's running; check connector health
nimbus doctor    # Re-run any time something seems off — checks Bun, Vault, Gateway, index, voice, …
```

### Authenticate Services

```bash
# Cloud storage & communication
nimbus connector auth google       # OAuth PKCE — opens browser
nimbus connector auth microsoft

# Developer services
nimbus connector auth github       # PAT — stored in OS keystore
nimbus connector auth gitlab
nimbus connector auth linear
nimbus connector auth jira
nimbus connector auth slack

nimbus connector list              # All connectors + sync status
```

### Query

```bash
nimbus ask "Find all PDFs I received by email last month that I haven't opened"
nimbus ask "Which of my open PRs mention payment-service?"
nimbus ask "What Linear issues am I assigned this week?"
nimbus search --service google_drive --type pdf --since 30d
nimbus sync all
```

### Observe and Debug

> **First debugging step:** run `nimbus doctor`. It checks your Bun version, vault availability, Gateway connectivity, index health, and connector states — and prints actionable remediation for anything it finds.

```bash
# Environment health check — run this first when something seems wrong
nimbus doctor

# Structured index queries
nimbus query --service github --type pr --since 7d --json
nimbus query --sql "SELECT title FROM items WHERE pinned = 1" --pretty

# Diagnostics and slow queries
nimbus diag
nimbus diag slow-queries --limit 10

# Connector health history
nimbus connector history github

# Re-ingest a connector at a specified depth (prunes existing body/embeddings; writes audit entry)
nimbus connector reindex github --depth metadata_only

# Database integrity
nimbus db verify
nimbus db repair          # --yes to skip confirmation
nimbus db snapshot
```

### Configure

```bash
nimbus config list
nimbus config get sync.intervalSeconds
nimbus config set sync.intervalSeconds 300
nimbus config validate

nimbus profile create work
nimbus profile switch work
nimbus profile list
```

### Run a Script

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

Before executing, Nimbus shows a full plan preview identifying every step that will require consent:

```
Script: weekly-cleanup (4 steps)

  Step 1  Find PDFs not opened in 90 days       READ — no approval needed
  Step 2  Summarize by project folder            READ — no approval needed
  Step 3  Move 12 files to /Archive/2025         ⚠ REQUIRES APPROVAL
  Step 4  Send summary email                     ⚠ REQUIRES APPROVAL

Proceed? [y/n]:
```

### Install a Community Extension

```bash
nimbus extension install @community/nimbus-notion
nimbus extension list
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | [Bun v1.2+](https://bun.sh) — native TypeScript, fast startup, built-in SQLite |
| **Language** | TypeScript 6.x strict mode |
| **Agent Framework** | [Mastra](https://mastra.ai) — structured agents, tool registration, workflow orchestration |
| **Integration Protocol** | [Model Context Protocol](https://modelcontextprotocol.io) — all connectors speak MCP; Engine never calls cloud APIs directly |
| **Local Database** | `bun:sqlite` + [sqlite-vec](https://github.com/asg017/sqlite-vec) — metadata index + vector search |
| **Secrets — Windows** | Windows DPAPI |
| **Secrets — macOS** | Keychain Services |
| **Secrets — Linux** | Secret Service API via `libsecret` |
| **IPC** | JSON-RPC 2.0 over Domain Socket / Named Pipe — local-only, no TCP surface |
| **CLI** | Bun + [@clack/prompts](https://github.com/natemoo-re/clack) |
| **Desktop UI** | [Tauri 2.0](https://tauri.app) + React 19 (~5MB native shell) |
| **LLM** | Anthropic Claude (default) / configurable via Mastra model abstraction |
| **Embeddings** | `@xenova/transformers` (local, no API key) / OpenAI (opt-in) |
| **Extension SDK** | `@nimbus-dev/sdk` (MIT-licensed npm package) |
| **Client Library** | `@nimbus-dev/client` (MIT-licensed npm package) — typed IPC wrapper; `MockClient` for scripts and extensions |
| **Testing — Gateway/CLI** | `bun test` |
| **Testing — UI** | Vitest + `@testing-library/react` |
| **Testing — E2E Desktop** | Playwright + Tauri WebDriver |
| **CI** | GitHub Actions — PR: Ubuntu `pr-quality`; Push: full 3-platform matrix |
| **Release** | `bun build --compile` — single signed binary per platform |

---

## Cross-Platform Support

| | Windows 10+ | macOS 13+ | Ubuntu 22.04+ † |
|---|---|---|---|
| **Gateway IPC** | Named Pipe | Unix Socket | Unix Socket |
| **Secrets** | DPAPI | Keychain | libsecret |
| **Autostart** | Registry | LaunchAgents | systemd user |
| **Notifications** | Win32 Toast | NSUserNotification | libnotify/D-Bus |
| **Config dir** | `%APPDATA%\Nimbus` | `~/Library/…/Nimbus` | `~/.config/nimbus` |
| **Desktop UI** | WebView2 | WKWebView | WebKitGTK |
| **CI runner** | `windows-2025` | `macos-15` | `ubuntu-24.04` |
| **Release** | `.exe` (signed) | `.dmg` (notarized) | `.deb` + AppImage |

† **Ubuntu 22.04 is supported for source builds only.** Pre-built Linux binaries are compiled on Ubuntu 24.04 and require **glibc ≥ 2.39** at runtime — Ubuntu 22.04 LTS, Debian 12, and RHEL 9 (and derivatives) will fail with `GLIBC_2.39 not found`. See [SECURITY.md](./SECURITY.md#linux-runtime-support--glibc-floor).

---

## Security

- **No plaintext credentials** — OAuth tokens live in the OS keystore. There is no code path that writes them elsewhere.
- **Structural HITL gate** — every delete, send, and move is blocked at the executor by a compile-time constant set. The agent cannot reason around a function that doesn't exist.
- **Extension isolation** — third-party extensions run as child processes, receive only their declared service's credentials, and cannot reach the Vault or other connectors. Manifest SHA-256 is verified on every Gateway startup.
- **Full audit log** — every action, including every HITL decision, is recorded in a local SQLite table before the action executes.
- **Internal security audit (B1, 2026-04-25)** — 8 trust surfaces reviewed; 78 unique findings filed (0 Critical); all High and Medium items closed pre-`v0.1.0`. Three Low items remain as Phase 4 polish; see [SECURITY.md](./SECURITY.md#security-audits) for the full record. A formal third-party penetration test is scheduled for Phase 9.

> **Note:** Nimbus's guarantees hold at the process boundary. It is not a firewall, antivirus, or VPN application; endpoint protection (AV/EDR), network security (VPN/Firewall), and OS-level hardening are your responsibility. See [SECURITY.md](./SECURITY.md) for the full boundary definition.

---

## Extensions

Writing a new connector takes an afternoon, not a sprint. The `@nimbus-dev/sdk` handles scaffolding; the Gateway handles OAuth, credential storage, sync scheduling, and HITL enforcement. You write the service API integration.

```bash
nimbus scaffold extension --name my-connector --output ./nimbus-my-connector
cd nimbus-my-connector && bun install && bun run build

nimbus extension install .          # Test locally
nimbus ask "search my-connector for quarterly review"

npm publish --access public         # Publish to the community
```

Extensions declare permissions in `nimbus.extension.json`. Write and delete tools must declare `hitlRequired` — the Gateway enforces HITL automatically for those tool calls regardless of how the extension implements them.

---

## Testing

Five-layer pyramid:

1. **Unit (`bun test`)** — Engine logic, Vault contracts, HITL invariants, manifest validation. Co-located with source. Runs in milliseconds.
2. **Integration (`bun test` + real SQLite)** — connector sync, index queries, extension loading and isolation. Each test gets a fresh temp dir + fresh DB.
3. **E2E CLI (`bun test` + Gateway subprocess)** — full CLI command flows against a real Gateway backed by mock MCP servers.
4. **UI Components (Vitest + Testing Library)** — React components in the Tauri WebView. Vitest is used here because `bun test` does not support jsdom.
5. **E2E Desktop (Playwright + Tauri WebDriver)** — full desktop flows on all three platforms. Runs on push to `main` and release tags.

Security scans: `bun audit`, `trivy`, CodeQL on every PR; Dependabot for dependency updates. HIGH/CRITICAL findings block merges.

---

## Project Structure

```
nimbus/
├── packages/
│   ├── gateway/              # Core headless Gateway (Bun)
│   │   └── src/
│   │       ├── platform/     # PAL: win32, darwin, linux implementations
│   │       ├── engine/       # Mastra agent, router, planner, HITL executor
│   │       ├── vault/        # DPAPI, Keychain, libsecret
│   │       ├── db/           # verify, repair, snapshot, health, metrics, latency ring buffer
│   │       ├── connectors/   # Connector registry, lazy mesh, health model
│   │       ├── sync/         # Delta sync scheduler, connectivity probe
│   │       ├── extensions/   # Extension Registry, manifest validator
│   │       ├── telemetry/    # Opt-in aggregate telemetry collector
│   │       ├── config/       # Config loader, profiles, env-var overrides
│   │       ├── llm/          # Ollama + llama.cpp providers, router, registry, GPU arbiter
│   │       ├── voice/        # STT (whisper-cli), TTS (NativeTtsProvider), wake-word
│   │       └── ipc/          # JSON-RPC 2.0 server, HTTP API, Prometheus endpoint
│   ├── cli/                  # nimbus CLI
│   │   └── src/commands/     # ask, search, query, config, profile, diag, doctor,
│   │                         # db, telemetry, connector, extension, workflow, status
│   ├── client/               # @nimbus-dev/client (published to npm, MIT)
│   ├── ui/                   # Tauri 2.0 desktop app (Phase 4)
│   │   └── src/
│   │       ├── components/   # ConsentDialog, ExtensionMarketplace, …
│   │       └── pages/        # Dashboard, Search, Marketplace, Settings
│   ├── docs/                 # Astro Starlight documentation site
│   ├── mcp-connectors/       # First-party MCP servers
│   │   ├── google-drive/
│   │   ├── gmail/
│   │   ├── github/
│   │   └── …                 # (all 15+ shipped connectors)
│   └── sdk/                  # @nimbus-dev/sdk (published to npm, MIT)
├── docs/
│   ├── README.md             # this file
│   ├── architecture.md       # subsystem design
│   ├── mission.md            # design philosophy and principles
│   ├── SECURITY.md           # security model + vulnerability reporting
│   ├── roadmap.md            # acceptance-criteria-driven roadmap
│   ├── CONTRIBUTING.md       # contributor workflow and constraints
│   ├── CODE_OF_CONDUCT.md    # community standards
│   ├── phase-4-plan.md       # Phase 4 implementation plan
│   ├── templates/            # copy-paste CI (e.g. extension authors)
│   └── contributors/         # author walkthroughs
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # pr-quality + 3-platform matrix
│   │   ├── security.yml      # bun audit + trivy
│   │   ├── codeql.yml
│   │   └── release.yml       # signed binaries → GitHub Releases
│   └── BRANCH_PROTECTION.md
├── bunfig.toml
└── package.json              # Bun workspace root
```

---

## Roadmap

Nimbus uses phases, not calendar dates. A phase completes when its acceptance criteria pass.

| Phase | Theme | Status |
|---|---|---|
| 1 | Foundation | ✅ Complete |
| 2 | The Bridge (15 connectors) | ✅ Complete |
| 3 | Intelligence (semantic search, CI/CD, cloud) | ✅ Complete |
| 3.5 | Observability (health model, query API, recovery, telemetry, docs) | ✅ Complete |
| 4 | Presence (Tauri UI, local LLM, v0.1.0 release) | 🔵 Active |
| 5–9 | Extended Surface → Enterprise | Planned |

See [`roadmap.md`](./roadmap.md) for full acceptance criteria and sequencing.

---

## Publishing Releases

```bash
git tag v0.1.0
git push origin v0.1.0
# → release.yml compiles Gateway + CLI for Linux, macOS, Windows
# → creates GitHub Release with signed binaries attached
```

---

## Contributing

Architecture is stabilizing; not all interfaces are frozen.

1. Read [`architecture.md`](./architecture.md) — understand the four subsystems and their contracts.
2. Read [`mission.md`](./mission.md) — understand the non-negotiables.
3. Check issues tagged `good first issue`.
4. Open a discussion before large PRs.

For workflow, verification commands, and PR expectations, see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Community standards are in [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

**Non-negotiables** — PRs violating these will not be merged:

- Local-first: no credentials or user data leaving the machine without explicit user action
- HITL is structural: consent gate in the executor, not the prompt
- No plaintext credentials: Vault only
- Platform equality: all three platforms, always
- MCP as connector standard: Engine never calls cloud APIs directly
- License integrity: contributions to core packages must be AGPL-3.0 compatible

---

## Pricing

| Tier | For | Status |
|---|---|---|
| **Open Source** | Individual engineers — AGPL-3.0, full feature set for single-user deployments | Available now |
| **Team** | Shared index namespaces, Team Vault, multi-user HITL, LAN federation — Phase 6 | Planned |
| **Enterprise** | SSO/SCIM, compliance tooling, audit log shipping, Helm/Docker, SLA support — Phase 9 | Planned |

The Extension SDK (`@nimbus-dev/sdk`) is MIT-licensed — extension authors have no copyleft obligation.

Commercial license for embedding Nimbus in a product without AGPL obligations, or for organizations that need Team/Enterprise features before those phases ship: contact the maintainers.

---

## License

**Core (Gateway, CLI, connectors):** AGPL-3.0 — see [LICENSE](../LICENSE). Anyone running Nimbus as a network service must publish their modifications under the same terms. This is intentional: the AGPL protects users by preventing vendors from stripping the privacy guarantees and offering a hosted "Nimbus Cloud."

**Extension SDK (`@nimbus-dev/sdk`):** MIT — extension authors are not burdened by copyleft obligations.

---

<div align="center">

**[Mission](./mission.md) · [Architecture](./architecture.md) · [Roadmap](./roadmap.md) · [Security](./SECURITY.md) · [Changelog](../CHANGELOG.md)**

</div>