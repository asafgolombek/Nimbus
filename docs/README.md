<div align="center">

# ☁️ Nimbus

### Local-First AI Orchestration Across Your Entire Stack.

*One agent. Every service. Your machine stays the source of truth.*

[![Built with Bun](https://img.shields.io/badge/runtime-Bun_1.2+-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript_6.x-3178C6?logo=typescript)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/protocol-MCP-purple)](https://modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/platforms-Windows_%7C_macOS_%7C_Linux-blue)]()
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](../LICENSE)
[![Status: Alpha](https://img.shields.io/badge/status-Alpha-orange)]()

</div>

---

Nimbus is an open-source, local-first AI agent framework. A headless **Nimbus Gateway** runs on your machine, maintains a private SQLite index of metadata across your connected services, and executes multi-step tasks on your behalf. Every destructive or outgoing action requires your explicit approval before it runs.

**Your credentials never leave your machine. There is no Nimbus server.**

---

## What It Does

```bash
# Search across every connected service — answered from the local index
nimbus ask "Find all PDFs I received by email last month that I haven't opened"

# Cross-service developer queries
nimbus ask "Which of my open PRs mention payment-service and have failing CI?"
nimbus ask "What caused the payment-service alert — what deployed recently?"

# Run a multi-step script — with a full preview before anything executes
nimbus run ./weekly-cleanup.yml
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

---

## Why Nimbus

### Fast — Most Queries Never Hit the Network

Nimbus maintains a local SQLite metadata index. Searching across 50,000 indexed items across five services takes under 100ms.

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

**Phase 1–2 (shipped):** Local Filesystem, Google Drive, Gmail, Google Photos, OneDrive, Outlook, Microsoft Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord (opt-in)

**Phase 3 (shipped):** Jenkins, GitHub Actions, CircleCI, GitLab CI, AWS, Azure, GCP, Kubernetes, Terraform/Pulumi/CloudFormation, Datadog, Grafana, Sentry, PagerDuty, New Relic

See the [roadmap](./roadmap.md) for depth and remaining gaps per connector.

---

## Quick Start

### Prerequisites

- **From source:** [Bun v1.2+](https://bun.sh/docs/installation)
- **Pre-built binaries:** No Bun required — releases are self-contained executables

### Option A — Pre-built Binaries

Download from [GitHub Releases](https://github.com/your-org/nimbus/releases):

| Asset | Purpose |
|---|---|
| `nimbus-gateway-{os}-x64` | Headless Gateway process |
| `nimbus-cli-{os}-x64` | `nimbus` terminal command |

Linux/macOS: `chmod +x nimbus-gateway-* nimbus-cli-*`. Optionally rename the CLI to `nimbus` and add to `PATH`.

### Option B — Build from Source

```bash
git clone https://github.com/your-org/nimbus.git
cd nimbus
bun install          # NOT "bun run install" — that looks for a script and fails
bun run build
```

Built CLI location:

| OS | Path |
|---|---|
| Windows | `packages\cli\dist\nimbus.exe` |
| macOS / Linux | `./packages/cli/dist/nimbus` |

Add `packages/cli/dist` to your `PATH` or call with a full path.

### Start the Gateway

```bash
nimbus start     # Start Gateway as a background process
nimbus status    # Verify it's running; check connector health
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
| **Testing — Gateway/CLI** | `bun test` |
| **Testing — UI** | Vitest + `@testing-library/react` |
| **Testing — E2E Desktop** | Playwright + Tauri WebDriver |
| **CI** | GitHub Actions — PR: Ubuntu `pr-quality`; Push: full 3-platform matrix |
| **Release** | `bun build --compile` — single signed binary per platform |

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

---

## Security

- **No plaintext credentials** — OAuth tokens live in the OS keystore. There is no code path that writes them elsewhere.
- **Structural HITL gate** — every delete, send, and move is blocked at the executor by a compile-time constant set. The agent cannot reason around a function that doesn't exist.
- **Extension isolation** — third-party extensions run as child processes, receive only their declared service's credentials, and cannot reach the Vault or other connectors. Manifest SHA-256 is verified on every Gateway startup.
- **Full audit log** — every action, including every HITL decision, is recorded in a local SQLite table before the action executes.

> **Note:** Nimbus's guarantees hold at the process boundary. OS login strength, screen locking, and disk encryption are your responsibility. See [SECURITY.md](./SECURITY.md) for the full boundary definition.

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
│   │       ├── index/        # SQLite schema + migrations
│   │       ├── connectors/   # Connector registry + sync scheduler
│   │       ├── extensions/   # Extension Registry, manifest validator
│   │       └── ipc/          # JSON-RPC 2.0 server
│   ├── cli/                  # nimbus CLI
│   ├── ui/                   # Tauri 2.0 desktop app
│   │   └── src/
│   │       ├── components/   # ConsentDialog, ExtensionMarketplace, …
│   │       └── pages/        # Dashboard, Search, Marketplace, Settings
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
│   └── roadmap.md            # acceptance-criteria-driven roadmap
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
| 3 | Intelligence (semantic search, CI/CD, cloud) | 🔵 Active |
| 4 | Presence (Tauri UI, local LLM, v0.1.0 release) | Planned |
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

1. Read [`architecture.md`](../architecture.md) — understand the four subsystems and their contracts.
2. Read [`mission.md`](./mission.md) — understand the non-negotiables.
3. Check issues tagged `good first issue`.
4. Open a discussion before large PRs.

**Non-negotiables** — PRs violating these will not be merged:

- Local-first: no credentials or user data leaving the machine without explicit user action
- HITL is structural: consent gate in the executor, not the prompt
- No plaintext credentials: Vault only
- Platform equality: all three platforms, always
- MCP as connector standard: Engine never calls cloud APIs directly
- License integrity: contributions to core packages must be AGPL-3.0 compatible

---

## License

**Core (Gateway, CLI, connectors):** AGPL-3.0 — see [LICENSE](../LICENSE). Anyone running Nimbus as a network service must publish their modifications under the same terms.

**Extension SDK (`@nimbus-dev/sdk`):** MIT — extension authors are not burdened by copyleft obligations.

Commercial license available for embedding Nimbus in a product without AGPL obligations — contact the maintainers.

---

<div align="center">

**[Mission](./mission.md) · [Architecture](../architecture.md) · [Roadmap](./roadmap.md) · [Security](./SECURITY.md) · [Changelog](../CHANGELOG.md)**

</div>