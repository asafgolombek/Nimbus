# Nimbus: Local-First AI Agent Framework

Nimbus is a local-first AI agent framework designed to provide a secure, private, and powerful assistant that lives on your machine. It consists of a headless Gateway process that maintains a private SQLite index of your data across various services and executes multi-step agentic workflows on your behalf.

**Active quarter:** Q2 2026 — The Bridge. See [`docs/q2-2026-plan.md`](docs/q2-2026-plan.md) for the implementation plan and [`docs/roadmap.md`](docs/roadmap.md) for the full-year roadmap.

## Project Overview

- **Architecture:** A monorepo featuring a headless **Nimbus Gateway** that hosts the core intelligence, and multiple clients (CLI, Tauri Desktop App) that communicate via JSON-RPC 2.0 over local IPC (Domain Sockets or Named Pipes).
- **Core Runtime:** Bun v1.2+ with TypeScript 6.x (strict mode).
- **Agent Engine:** Powered by [Mastra](https://mastra.ai) for intent routing, planning, and execution.
- **Integration:** Uses the **Model Context Protocol (MCP)** as the standard for all service connectors (files, email, calendar, cloud services).
- **Security:** Implements a **Secure Vault** using OS-native credential storage (DPAPI on Windows, Keychain on macOS, libsecret on Linux) to ensure no plaintext credentials ever touch the disk or logs.
- **Control:** A structural **Human-In-The-Loop (HITL)** consent gate is enforced in the executor for all destructive or outgoing actions, ensuring the agent never acts without explicit permission where required.

## Subsystems

- `packages/gateway`: The core process hosting the Engine, MCP Mesh, Vault, and Extension Registry.
- `packages/cli`: Terminal client for interacting with the Gateway.
- `packages/ui`: Tauri 2.0 desktop application (React WebView).
- `packages/sdk`: The `@nimbus-dev/sdk` for building third-party MCP-native extensions.
- `packages/mcp-connectors/`: First-party connectors for services like OneDrive, Outlook, and Google Photos.

## Development Workflows

### Prerequisites
- **Bun:** v1.2 or higher.
- **Rust:** Required for building the Tauri-based UI (`packages/ui/src-tauri`).

### Key Commands
- `bun install`: Install all dependencies.
- `bun dev`: Start the Gateway and CLI in development mode.
- `bun run build`: Build all packages in the monorepo.
- `bun run typecheck`: Run TypeScript type checking across all packages.
- `bun run lint`: Run Biome for linting and formatting checks.
- `bun run lint:fix`: Automatically fix linting and formatting issues.

### Testing
Nimbus maintains a rigorous testing strategy with strict coverage gates enforced in CI.
- `bun test`: Run all unit tests.
- `bun run test:coverage`: Run tests with coverage reporting.
- `bun run test:integration`: Run integration tests (requires real SQLite and subprocesses).
- `bun run test:e2e:cli`: Run end-to-end tests for the CLI.
- `bun run test:coverage:engine`: Verify Engine coverage (threshold: ≥85%).
- `bun run test:coverage:vault`: Verify Vault coverage (threshold: ≥90%).

## Development Conventions

- **Strict Typing:** No `any` allowed. Use `unknown` for external data.
- **Platform Abstraction Layer (PAL):** All OS-specific logic (paths, secrets, IPC) must live in `packages/gateway/src/platform/` and be accessed via dependency injection.
- **HITL is Structural:** The HITL gate is a hard-coded whitelist in the executor (`packages/gateway/src/engine/executor.ts`); it cannot be bypassed by LLM prompting or configuration.
- **Dependency Rules:**
    - Gateway cannot import from CLI or UI.
    - CLI and UI communicate with Gateway *only* via IPC; no source imports from the Gateway.
    - SDK must remain independent of all other packages.
- **Local-First:** The local machine is the source of truth. Remote APIs are accessed only via MCP connectors when freshness is required.

## Directory Structure Highlights
- `packages/gateway/src/engine/`: Core agent logic (router, planner, executor).
- `packages/gateway/src/platform/`: Platform-specific implementations (win32, darwin, linux).
- `packages/gateway/src/vault/`: Secure credential management.
- `packages/gateway/src/index/`: SQLite schema and local indexing logic.
- `packages/sdk/`: Public SDK for extension developers.
