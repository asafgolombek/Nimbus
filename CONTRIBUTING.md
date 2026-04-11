# Contributing to Nimbus

Thank you for your interest in contributing. Nimbus is in active early development (Phase 3 — Intelligence). Architecture is stabilising but not all interfaces are frozen.

Before writing any code, read the documents that define what Nimbus is and what we are building this quarter:

- [`architecture.md`](./architecture.md) — subsystem contracts, package dependency rules, and the data flow
- [`docs/mission.md`](./docs/mission.md) — the principles behind every design decision
- [`docs/roadmap.md`](./docs/roadmap.md) — quarterly scope, acceptance criteria, and inter-quarter dependencies

---

## Non-Negotiables

These are architectural constraints, not preferences. Contributions that violate them will not be merged, regardless of quality:

| # | Constraint | What it means in practice |
|---|---|---|
| 1 | **Local-first** | No user data or credentials leave the machine without an explicit user action |
| 2 | **HITL is structural** | The consent gate lives in the executor (`executor.ts`), not in a prompt or config. It cannot be bypassed or made optional |
| 3 | **No plaintext credentials** | Vault only — never in logs, IPC responses, config files, or environment variables |
| 4 | **MCP as connector standard** | The Engine never calls cloud APIs directly; all external I/O goes through MCP connectors |
| 5 | **Platform equality** | Windows, macOS, and Linux must work identically. All three CI runners must pass |
| 6 | **No `any`** | Use `unknown` for external data; TypeScript strict mode is non-negotiable |
| 7 | **License integrity** | Core package contributions must be AGPL-3.0-compatible; SDK contributions must be MIT-compatible |

---

## Getting Started

### 1. Set Up

```bash
# Requires Bun v1.2+
git clone https://github.com/your-org/nimbus.git
cd nimbus
bun install
```

### 2. Verify Your Environment

```bash
bun run typecheck     # Must pass with zero errors
bun run lint          # Biome — format + lint
bun test              # All unit tests
```

### 3. Find Something to Work On

- Issues tagged [`good-first-issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3Agood-first-issue) are the best starting point
- Issues tagged [`help-wanted`](../../issues?q=is%3Aissue+is%3Aopen+label%3Ahelp-wanted) are open for contributors
- **Open a discussion before starting any large PR.** Architecture decisions belong in a discussion, not in a surprise diff

---

## Development Workflow

### Branch Naming

```
feat/short-description       # new capability
fix/short-description        # bug fix
refactor/short-description   # internal restructure, no behaviour change
test/short-description       # test-only changes
docs/short-description       # documentation only
```

### Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(vault): add libsecret backend for Linux
fix(executor): prevent HITL bypass when tool name includes whitespace
test(engine): add coverage for intent router edge cases
docs(contributing): clarify platform equality requirement
```

Keep commits focused. One logical change per commit.

### Running Tests

```bash
bun test                          # all unit tests
bun run test:integration          # integration tests (real SQLite, real subprocesses)
bun run test:e2e:cli              # E2E CLI tests (real Gateway + mock MCP servers)
cd packages/ui && bunx vitest run # UI component tests

# Coverage gates (enforced in CI — must pass before merge)
bun run test:coverage:engine      # Engine ≥85%
bun run test:coverage:vault       # Vault ≥90%
```

### Before Opening a PR

- [ ] `bun run typecheck` passes with zero errors
- [ ] `bun run lint` passes (or `bun run lint:fix` was run)
- [ ] All existing tests pass
- [ ] New behaviour is covered by tests
- [ ] Coverage gates still pass if you touched `engine/` or `vault/`
- [ ] You have not introduced any `any` types
- [ ] Platform-specific code is behind the `PlatformServices` abstraction
- [ ] No credentials, tokens, or secret values appear in any log, IPC message, or config

---

## Adding a New MCP Connector

Connectors live in `packages/mcp-connectors/`. They depend only on `@nimbus-dev/sdk`.

1. Scaffold a new connector:
   ```bash
   nimbus scaffold extension --name your-service --output packages/mcp-connectors/your-service
   ```
2. Implement the MCP server against the service's API
3. Declare write/delete tools with `hitlRequired: true` in the manifest — the Gateway enforces HITL automatically
4. Add integration tests using `MockGateway` from the SDK
5. Register the connector in `packages/gateway/src/connectors/`

See the [architecture](./architecture.md) for connector mesh details.

---

## Package Dependency Rules

```
gateway    ← must not import from cli or ui
cli        ← IPC-only communication with gateway (no source imports)
ui         ← IPC-only communication with gateway (no source imports)
sdk        ← must not import from gateway, cli, or ui
mcp-connectors/*  ← depend on @nimbus-dev/sdk only
```

Circular dependencies are forbidden. The linter will catch cross-package source imports.

---

## Pull Request Process

1. Open an issue or discussion first for anything non-trivial
2. Fill in the pull request template completely — incomplete PRs will be returned
3. All CI checks must be green: `pr-quality` (Ubuntu) must pass before review begins
4. At least one maintainer approval is required before merge
5. Squash-merge is preferred for feature branches; merge commits for release branches

---

## Reporting Bugs

Use the **Bug Report** issue template. Include:

- OS and version
- Bun version (`bun --version`)
- Exact command run and full output
- Whether it is platform-specific (does it reproduce on another OS?)

For security vulnerabilities, **do not open a public issue** — see [`docs/SECURITY.md`](./docs/SECURITY.md).

---

## Questions

Open a [GitHub Discussion](../../discussions) rather than an issue. Issues are for confirmed bugs and accepted feature requests.
