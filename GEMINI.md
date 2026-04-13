# Nimbus — Gemini CLI Context

Nimbus is a **local-first AI agent framework** — a headless Bun Gateway process that maintains a private SQLite index of the user's data across cloud services (Google Drive, Gmail, OneDrive, Outlook, Google Photos, Microsoft Teams, GitHub, GitLab, Bitbucket, Slack, Linear, Jira, Notion, Confluence, Discord opt-in, Jenkins, GitHub Actions, CircleCI, GitLab CI, PagerDuty, Kubernetes, AWS, Azure, GCP, IaC CLIs, Grafana, Sentry, New Relic, Datadog, optional filesystem roots, and other first-party MCP connectors) and executes multi-step agentic workflows on their behalf. Clients (CLI and Tauri 2.0 desktop app) communicate with the Gateway exclusively over JSON-RPC 2.0 IPC.

**Runtime:** Bun v1.2+ / TypeScript 6.x strict  
**Linter:** Biome  
**License:** AGPL-3.0 (gateway/cli/mcp-connectors) + MIT (sdk)  
**Status:** Phase 3 — Intelligence ✅ complete; **Phase 3.5** is the next roadmap focus

Companion context for other agents: [`CLAUDE.md`](./CLAUDE.md) (same project facts; keep both files aligned when changing commands, roadmap rows, or non-negotiables).

---

## Non-Negotiables

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
| `packages/gateway/src/engine/executor.ts` | HITL gate — `HITL_REQUIRED`; most security-critical file |
| `packages/gateway/src/platform/index.ts` | PAL — `createPlatformServices()` dispatch |
| `packages/gateway/src/platform/win32.ts` | Windows platform implementation |
| `packages/gateway/src/platform/darwin.ts` | macOS platform implementation |
| `packages/gateway/src/platform/linux.ts` | Linux platform implementation |
| `packages/gateway/src/vault/index.ts` | `NimbusVault` interface |
| `packages/gateway/src/connectors/` | MCP connector mesh (`lazy-mesh.ts` — Phase 3 bundle for infra/obs MCPs when vault keys exist) |
| `packages/gateway/src/ipc/` | JSON-RPC 2.0 IPC server |
| `packages/cli/src/index.ts` | CLI entry point |
| `packages/cli/src/ipc-client/` | IPC client + consent channel |
| `packages/sdk/src/index.ts` | `@nimbus-dev/sdk` public API |
| `architecture.md` | Full subsystem design — read before modifying any subsystem |
| `docs/mission.md` | Project principles — read before adding features |
| `docs/roadmap.md` | Phases, acceptance criteria, Phase 3 delivered summary |

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
bun run test:coverage:engine   # ≥85% threshold (engine)
bun run test:coverage:vault    # ≥90% threshold (vault)
bun run test:coverage:embedding # ≥80% threshold (embedding)
bun run test:coverage:workflow  # ≥80% threshold (workflow runner + store)
bun run test:coverage:watcher   # ≥80% threshold (watcher engine + store + anomaly stub)
bun run test:coverage:extensions # ≥85% threshold (extension registry + manifest + verify)

# Integration tests
bun run test:integration

# E2E CLI tests
bun run test:e2e:cli

# UI component tests (Vitest — separate from bun test)
cd packages/ui && bunx vitest run

# Build all packages
bun run build

# Clean all build outputs
bun run clean

# Security audit
bun audit --audit-level high

# Headless binary bundle + Linux .deb / tarball (after compiling gateway + CLI to dist/)
# Optional: NIMBUS_EMBEDDING_MODEL_DIR or bun run package:headless -- --embedding-model-dir <path>
bun run package:headless
bun run package:installers:linux -- --version 0.1.0
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
  ├── Secure Vault  (NimbusVault → PAL)
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

---

## Testing Philosophy

- **HITL tests** — consent before connector dispatch; rejected consent → no connector call; audit with `hitlStatus: "rejected"`
- **Vault tests** — `get()` returns `null` for missing keys; secrets never in errors; `listKeys()` returns names only
- **Integration tests** — real SQLite, real Bun subprocesses, fresh temp dirs
- **E2E CLI tests** — real Gateway subprocess + mock MCP wire protocol
- **Coverage gates** — Engine ≥85%, Vault ≥90%, Embedding ≥80% (see `_test-suite.yml` for full matrix)

---

## Roadmap Context

> Full roadmap: [`docs/roadmap.md`](./docs/roadmap.md)

| Phase | Theme | Status |
|---|---|---|
| Phase 1 | Foundation — Gateway, PAL, Vault, filesystem connector, HITL, CLI, CI | ✅ Complete |
| Phase 2 | The Bridge — 15 MCP connectors, unified index, people graph, context ranker, installers | ✅ Complete |
| Phase 3 | Intelligence — Semantic layer, extensions, CI/CD + cloud MCPs, workflows, watchers | ✅ Complete |
| Phase 3.5 | Observability — Health model, `nimbus query`, `diag`, recovery, telemetry, docs site | 🔵 Current focus |
| Phase 4 | Presence — Tauri UI, VS Code ext, local LLM (Ollama), multi-agent, data portability | Planned |
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
