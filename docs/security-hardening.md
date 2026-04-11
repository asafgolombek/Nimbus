# Q2 §7.8 Security hardening — status

This document tracks the **Security Hardening Checklist** in `docs/q2-2026-plan.md` §7.8. Items marked **Automated** run in CI; **Manual** require human sign-off before a release.

| Item | Status | Evidence |
|------|--------|----------|
| `bun audit --audit-level high` clean | **Automated** | `.github/workflows/security.yml` job `audit` |
| Trivy on dependency / config surface | **Automated** | `security.yml` job `trivy-scan` (filesystem scan of repo root; includes all workspace `package.json` and lockfiles) |
| CodeQL JavaScript/TypeScript | **Automated** | `.github/workflows/codeql.yml` (entire monorepo, including MCP connector packages) |
| Manual review: `packages/gateway/src/auth/pkce.ts` — no token values in logs, IPC, or exception messages | **Manual** | Contract tests in `pkce.test.ts` assert exchange failures do not echo secrets; reviewers re-verify on material changes |
| Manual review: connector credential flow ends in Vault only | **Manual** | MCP servers receive credentials via env from Gateway (`CLAUDE.md` / architecture); there is no per-connector `auth.ts` tree — review `connector-rpc-handlers.ts`, lazy mesh env injection, and each `packages/mcp-connectors/*/src/server.ts` for accidental logging |
| `connector.remove` resilience (SQLite index in WAL + transaction; Vault rollback on failure) | **Partially automated** | Index deletes run in `LocalIndex.removeConnectorIndexData` (`db.transaction`); `handleConnectorRemove` restores `google.oauth` / `microsoft.oauth` from backup on Vault errors — see `packages/gateway/test/integration/connector-remove-oauth-restore.integration.test.ts`. True power-cut across separate stores cannot be fully simulated in CI. |
| Discord off by default | **Automated / product** | Lazy mesh + vault keys; see plan acceptance checklist |
| Minimum-scope Outlook (`Calendars.Read` only) | **Manual** | Run `nimbus connector auth outlook --scopes Calendars.Read` and confirm tool gating in a real tenant |
| No credential fragments in audit payloads | **Automated** | `packages/gateway/src/engine/audit-payload-safety.test.ts` (regex scan of HITL / consent-related JSON). **Note:** Q2 HITL audit rows live in SQLite `audit_log`; file-based `{logDir}/audit.jsonl` for expanded events is planned — extend the same checks when that lands. |

## Maintainer workflow

1. Before tagging: confirm **Manual** rows above for the delta since last release.
2. On PRs: ensure **Security** and **CodeQL** workflows are required checks where branch protection applies (see `.github/BRANCH_PROTECTION.md`).
