# Q2 §7.8 Security hardening — status

This document tracks the **Security Hardening Checklist** in `docs/q2-2026-plan.md` §7.8. Items marked **Automated** run in CI; **Manual** require human sign-off before a release.

| Item | Status | Evidence |
|------|--------|----------|
| `bun audit --audit-level high` clean | **Automated** | `.github/workflows/security.yml` job `audit` |
| Trivy on dependency / config surface | **Automated** | `security.yml` job `trivy-scan` (filesystem scan of repo root; includes all workspace `package.json` and lockfiles) |
| CodeQL JavaScript/TypeScript | **Automated** | `.github/workflows/codeql.yml` (entire monorepo, including MCP connector packages) |
| `pkce.ts` — no secrets in exchange-failure exceptions | **Automated** | `packages/gateway/src/auth/pkce.test.ts` (Google + Microsoft invalid_grant paths) |
| `pkce.ts` / IPC / logs — full manual pass | **Manual** | Spot-check on material PKCE or IPC changes |
| Connector layout — no per-connector `auth.ts` | **Automated** | `packages/gateway/test/e2e/scenarios/mcp-connector-structure.contract.test.ts` |
| Connector credential flow ends in Vault + env only | **Manual** | Review `connector-rpc-handlers.ts`, lazy mesh env injection, each `packages/mcp-connectors/*/src/server.ts` when those files change |
| `connector.remove` resilience (SQLite index in WAL + transaction; Vault rollback on failure) | **Partially automated** | Index deletes run in `LocalIndex.removeConnectorIndexData` (`db.transaction`); `handleConnectorRemove` restores `google.oauth` / `microsoft.oauth` from backup on Vault errors — see `packages/gateway/test/integration/connector-remove-oauth-restore.integration.test.ts`. True power-cut across separate stores cannot be fully simulated in CI. |
| Discord off by default | **Automated / product** | Lazy mesh + vault keys; see plan acceptance checklist |
| Minimum-scope Outlook (`Calendars.Read` only) | **Automated + manual** | Policy: `packages/mcp-connectors/outlook/src/tool-scope-policy.ts` + `tool-scope-policy.test.ts`; Gateway passes vault `scopes` via `readMicrosoftOAuthScopesForOutlookEnv` → `MICROSOFT_OAUTH_SCOPES` (`oauth-vault-scopes.test.ts`). **Manual:** smoke in a real tenant after auth. |
| No credential fragments in audit payloads | **Automated** | `packages/gateway/src/engine/audit-payload-safety.test.ts` (regex scan of HITL / consent-related JSON). **Note:** Q2 HITL audit rows live in SQLite `audit_log`; file-based `{logDir}/audit.jsonl` for expanded events is planned — extend the same checks when that lands. |

## Maintainer workflow

1. Before tagging: confirm **Manual** rows above for the delta since last release.
2. On PRs: ensure **Security** and **CodeQL** workflows are required checks where branch protection applies (see `.github/BRANCH_PROTECTION.md`).
