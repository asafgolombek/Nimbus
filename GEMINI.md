# Nimbus — Gemini CLI Context

Nimbus is a **local-first AI agent framework** — a headless Bun Gateway process that maintains a private SQLite index of the user's data across cloud services (Google Drive, Gmail, OneDrive, Outlook, Google Photos, and other first-party MCP connectors) and executes multi-step agentic workflows on their behalf. Clients (CLI and Tauri 2.0 desktop app) communicate with the Gateway exclusively over JSON-RPC 2.0 IPC.

**Runtime:** Bun v1.2+ / TypeScript 6.x strict  
**Linter:** Biome  
**License:** AGPL-3.0 (gateway/cli/mcp-connectors) + MIT (sdk)  
**Status:** Q2 2026 — The Bridge (active)

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
| `packages/gateway/src/connectors/` | MCP connector mesh |
| `packages/gateway/src/ipc/` | JSON-RPC 2.0 IPC server |
| `packages/cli/src/index.ts` | CLI entry point |
| `packages/cli/src/ipc-client/` | IPC client + consent channel |
| `packages/sdk/src/index.ts` | `@nimbus-dev/sdk` public API |
| `architecture.md` | Full subsystem design — read before modifying any subsystem |
| `docs/mission.md` | Project principles — read before adding features |

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
- **Coverage gates** — Engine ≥85%, Vault ≥90%

---

## Roadmap Context

> Full roadmap: [`docs/roadmap.md`](./docs/roadmap.md)  
> Q2 execution plan (tasks + living implementation status): [`docs/q2-2026-plan.md`](./docs/q2-2026-plan.md)

| Quarter | Theme | Status |
|---|---|---|
| Q1 2026 | Foundation — Gateway, PAL, Vault, filesystem connector, HITL, CLI, CI | **Complete** |
| Q2 2026 | The Bridge — Cloud storage, email, source control, communication (Slack/Teams), project tracking (Linear/Jira), knowledge bases (Notion/Confluence), people graph | **Active** |
| Q3 2026 | Intelligence — Embeddings, hybrid search, Extension Registry v1, CI/CD + cloud infra connectors, IaC write ops, workflow pipelines, watchers, relationship graph, filesystem v2, agent specialization | Planned |
| Q4 2026 | Presence — Tauri 2.0 desktop, local LLM (Ollama), multi-agent orchestration, Rich TUI, voice interface, data portability, signed releases | Planned |

When implementing, focus only on the current quarter. Do not add Q(n+1) features in Q(n) code.

---

## Subsystems (monorepo)

- `packages/gateway` — Engine, MCP mesh, Vault, local index, IPC
- `packages/cli` — Terminal client
- `packages/ui` — Tauri 2.0 + React (desktop)
- `packages/sdk` — `@nimbus-dev/sdk` for extensions (MIT)
- `packages/mcp-connectors/*` — First-party MCP servers (AGPL)

**PAL:** All OS-specific logic lives under `packages/gateway/src/platform/` and is accessed via `PlatformServices` — never import `win32` / `darwin` / `linux` from business logic.

**Prerequisites:** Bun v1.2+; Rust for building the Tauri UI (`packages/ui/src-tauri`).
